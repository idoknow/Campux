import { Buffer } from "node:buffer";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { CampuxConfig } from "@campux/config";
import { TransactionIsolationLevel, isPrismaKnownRequestError } from "@campux/db";
import { getStorageDriver } from "@campux/integrations";
import { renderPostCard } from "@campux/render";
import { hasTenantRole, requireReadyTenant, requireTenantContext } from "../lib/auth";
import { toPostListItem } from "../lib/posts";
import { buildPublishedFeed, type BatchFeedInput, type RawFeedPost, type SingleFeedInput } from "../lib/published-feed";
import { prisma } from "../lib/prisma";
import { readTenantPendingPostLimit, readTenantImageCompression } from "../lib/tenant-metadata";
import { writeAuditLog } from "../lib/audit";
import { compressImageBuffer, uploadAttachmentBytes, deleteAttachmentObjects, type PostAttachment } from "../lib/attachments";
import { detectPostInjection, validateRemoteGifUrls, createAutoBan } from "../lib/sanitize";
import { readSvgAvatarDataUrl } from "../lib/svg-avatars";
import { formatBanNotify } from "../lib/bot-messages";
import type { RuntimeQueue } from "../runtime/queue";
import type { OneBotRuntime } from "../runtime/onebot";

const fileQuerySchema = z.object({
  key: z.string().min(1),
});

const postParamsSchema = z.object({
  id: z.string().min(1),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

const recallRequestSchema = z.object({
  reason: z.string().trim().min(1, "请填写撤回理由").max(500),
});

class PendingPostLimitError extends Error {
  constructor(
    readonly pendingCount: number,
    readonly limit: number,
  ) {
    super("pending post limit exceeded");
  }
}

export function sanitizeUploadExtension(fileName: string | undefined): string {
  const raw = fileName?.split(".").pop();
  if (!raw) {
    return "bin";
  }
  return raw.replace(/[^a-zA-Z0-9]/g, "").toLowerCase() || "bin";
}

const IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/bmp",
  "image/tiff",
  "image/svg+xml",
]);

const VIDEO_CONVERT_MIME_TYPES = new Set([
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-msvideo",
  "video/x-matroska",
  "video/3gpp",
]);

function isAllowedImageType(contentType: string): boolean {
  return IMAGE_MIME_TYPES.has(contentType);
}

function isConvertibleVideoType(contentType: string): boolean {
  return VIDEO_CONVERT_MIME_TYPES.has(contentType);
}

const IMAGE_SIZE_CAP = 10 * 1024 * 1024; // 10MB
const VIDEO_SIZE_CAP = 100 * 1024 * 1024; // 100MB
const MAX_VIDEO_DURATION_SEC = 60;

/**
 * Convert video buffer to GIF using ffmpeg.
 * Uses original resolution and framerate with full 256-color palette
 * for maximum quality (every frame, original dimensions).
 *
 * Note: The web frontend now converts videos to GIF in-browser, so this
 * server-side path is only hit by API clients. If ffmpeg is not available,
 * a clear error is thrown.
 */
async function convertVideoToGif(videoBuffer: Buffer, originalName: string): Promise<{ buffer: Buffer }> {
  const { spawn } = await import("node:child_process");
  const { mkdtempSync, writeFileSync, readFileSync, rmSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");

  const tmpDir = mkdtempSync(join(tmpdir(), "campux-video-"));
  const inputPath = join(tmpDir, "input.mp4");
  const outputPath = join(tmpDir, "output.gif");

  try {
    writeFileSync(inputPath, videoBuffer);

    // Check duration
    const duration = await new Promise<number>((resolve, reject) => {
      const proc = spawn("ffprobe", [
        "-v", "quiet", "-print_format", "json", "-show_format", inputPath,
      ], { timeout: 10000 });
      let stdout = "";
      proc.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
      proc.on("close", (code) => {
        if (code !== 0) { reject(new Error("无法解析视频信息")); return; }
        try {
          const info = JSON.parse(stdout);
          resolve(parseFloat(info.format?.duration || "0"));
        } catch { reject(new Error("无法解析视频时长")); }
      });
      proc.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "ENOENT") {
          reject(new Error("服务端未安装 ffprobe，请使用 Web 前端投稿"));
        } else {
          reject(err);
        }
      });
    });

    if (duration > MAX_VIDEO_DURATION_SEC) {
      throw new Error(`视频时长 ${Math.round(duration)}s 超过限制 (${MAX_VIDEO_DURATION_SEC}s)`);
    }

    // Convert to GIF: original resolution & framerate, full 256-color palette
    await new Promise<void>((resolve, reject) => {
      const ffmpeg = spawn("ffmpeg", [
        "-y", "-i", inputPath,
        "-vf", "fps=source,split[s0][s1];[s0]palettegen=stats_mode=full:max_colors=256[p];[s1][p]paletteuse=dither=floyd_steinberg",
        "-loop", "0", outputPath,
      ], { timeout: 60000 });
      let stderr = "";
      ffmpeg.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
      ffmpeg.on("close", (code) => {
        if (code !== 0) { reject(new Error(`ffmpeg 转换失败: ${stderr.slice(-200)}`)); return; }
        resolve();
      });
      ffmpeg.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "ENOENT") {
          reject(new Error("服务端未安装 ffmpeg，请使用 Web 前端投稿"));
        } else {
          reject(err);
        }
      });
    });

    return { buffer: readFileSync(outputPath) };
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

function headerIncludes(value: string | string[] | undefined, expected: string): boolean {
  return Array.isArray(value) ? value.some((item) => item.includes(expected)) : Boolean(value?.includes(expected));
}

function isUploadTooLargeError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }
  const code = "code" in error ? String(error.code) : "";
  return code === "FST_REQ_FILE_TOO_LARGE" || error.message.includes("size limit exceeded") || error.message.includes("File size limit exceeded");
}

function isTransactionSerializationFailure(value: unknown) {
  return isPrismaKnownRequestError(value) && value.code === "P2034";
}

export function registerPostRoutes(app: FastifyInstance, config: CampuxConfig, _queue: RuntimeQueue, oneBot?: OneBotRuntime) {
  app.get("/api/uploads/post-image", async (request, reply) => {
    const context = await requireTenantContext(request, reply);
    const query = fileQuerySchema.parse(request.query);
    const allowedPrefixes = [
      `tenants/${context.selectedTenant.id}/uploads/`,
      `tenants/${context.selectedTenant.id}/legacy/`,
    ];
    if (!allowedPrefixes.some((prefix) => query.key.startsWith(prefix))) {
      return reply.code(403).send({ message: "没有访问该图片的权限" });
    }

    const storage = getStorageDriver(config);
    const object = await storage.getBytes(query.key);
    if (!object) {
      return reply.code(404).send({ message: "图片不存在" });
    }

    if (object.contentType) {
      reply.header("Content-Type", object.contentType);
    }
    reply.header("Cache-Control", "private, max-age=3600");
    return reply.send(Buffer.from(object.bytes));
  });

  app.post("/api/posts", async (request, reply) => {
    const context = await requireReadyTenant(request, reply, "submitter");
    const compression = await readTenantImageCompression(prisma, context.selectedTenant.id);

    // Check ban first
    const activeBan = await prisma.banRecord.findFirst({
      where: {
        tenantId: context.selectedTenant.id,
        userId: context.user.id,
        endsAt: {
          gt: new Date(),
        },
      },
      orderBy: {
        endsAt: "desc",
      },
    });
    if (activeBan) {
      return reply.code(403).send({ message: `账号已被封禁：${activeBan.comment}` });
    }

    const uploadedKeys: string[] = [];
    let text = "";
    let anonymous = false;
    let anonymousAvatar: string | null = null;
    let bgColor: string | null = null;
    let textColor: string | null = null;
    let font: string | null = null;
    const staged: PostAttachment[] = [];
    const remoteGifUrls: string[] = [];

    try {
      let fileIndex = 0;
      for await (const part of request.parts()) {
        if (part.type === "field") {
          if (part.fieldname === "text") {
            text = String(part.value ?? "");
          } else if (part.fieldname === "anonymous") {
            anonymous = part.value === "true" || part.value === true;
          } else if (part.fieldname === "anonymousAvatar") {
            anonymousAvatar = String(part.value ?? "") || null;
          } else if (part.fieldname === "bgColor") {
            bgColor = String(part.value ?? "") || null;
          } else if (part.fieldname === "textColor") {
            textColor = String(part.value ?? "") || null;
          } else if (part.fieldname === "font") {
            font = String(part.value ?? "") || null;
          } else if (part.fieldname === "remoteGifUrls") {
            // Accept JSON array of GIF URLs from 失控图床 API conversion
            try {
              const parsed = JSON.parse(String(part.value ?? "[]"));
              if (Array.isArray(parsed)) {
                remoteGifUrls.push(...parsed.filter((u): u is string => typeof u === "string" && u.length > 0));
              }
            } catch {
              // ignore malformed JSON
            }
          }
          continue;
        }

        const isImage = part.fieldname === "images";
        if (!isImage) {
          part.file.destroy();
          continue;
        }

        if (staged.length >= 9) {
          part.file.destroy();
          throw {
            status: 400,
            message: "最多 9 个文件",
            fileIndex,
          };
        }

        const mime = part.mimetype || "application/octet-stream";

        if (!isAllowedImageType(mime) && !isConvertibleVideoType(mime)) {
          part.file.destroy();
          throw {
            status: 415,
            message: "仅支持图片和视频格式",
            fileIndex,
          };
        }

        const isVideo = isConvertibleVideoType(mime);
        const cap = isVideo ? VIDEO_SIZE_CAP : IMAGE_SIZE_CAP;

        // Read file with size cap using Transform
        const buf = await readPartCapped(part.file, cap, fileIndex);

        let finalBuf: Buffer;
        let finalMime: string;
        let finalFileName: string;

        if (isVideo) {
          // Convert video to GIF
          try {
            const converted = await convertVideoToGif(buf, part.filename || "video");
            finalBuf = converted.buffer;
            finalMime = "image/gif";
            finalFileName = (part.filename || "video").replace(/\.[^.]+$/, ".gif");
          } catch (convErr) {
            throw {
              status: 400,
              message: `视频转换失败：${convErr instanceof Error ? convErr.message : "未知错误"}`,
              fileIndex,
            };
          }
        } else {
          finalBuf = await compressImageBuffer(buf, mime, compression);
          finalMime = mime;
          finalFileName = part.filename || "attachment.jpg";
        }

        // Upload to S3
        const att = await uploadAttachmentBytes({
          config,
          tenantId: context.selectedTenant.id,
          kind: "image",
          contentType: finalMime,
          fileName: finalFileName,
          body: finalBuf,
        });
        uploadedKeys.push(att.key);
        staged.push(att);
        fileIndex += 1;
      }

      // 检查远程 GIF URL 的 SSRF 风险
      const urlValidation = validateRemoteGifUrls(remoteGifUrls);
      if (!urlValidation.valid) {
        throw {
          status: 400,
          message: urlValidation.reason,
        };
      }

      // Process remote GIF URLs (from 失控图床 API conversion)
      for (const gifUrl of remoteGifUrls) {
        if (staged.length >= 9) {
          break;
        }
        try {
          const response = await fetch(gifUrl);
          if (!response.ok) {
            app.log.warn({ url: gifUrl, status: response.status }, "failed to fetch remote GIF");
            continue;
          }
          const arrayBuffer = await response.arrayBuffer();
          const buf = Buffer.from(arrayBuffer);

          const att = await uploadAttachmentBytes({
            config,
            tenantId: context.selectedTenant.id,
            kind: "image",
            contentType: "image/gif",
            fileName: "video.gif",
            body: buf,
          });
          uploadedKeys.push(att.key);
          staged.push(att);
        } catch (fetchErr) {
          app.log.warn({ error: fetchErr, url: gifUrl }, "failed to process remote GIF");
          // Skip failed URLs rather than failing the entire post
        }
      }

      // Validate text
      if (text.trim().length === 0) {
        throw {
          status: 400,
          message: "正文不能为空",
        };
      }
      if (text.length > 1000) {
        throw {
          status: 400,
          message: "正文最多 1000 字",
        };
      }

      // 注入检测：XSS、CSS、代码、CQ 码
      const injectionResult = detectPostInjection({ text, bgColor, textColor, font });
      if (injectionResult.detected) {
        // 自动封禁一天
        await createAutoBan({
          tenantId: context.selectedTenant.id,
          userId: context.user.id,
          operatorId: context.user.id,
          reason: injectionResult.reason,
          onBan: async (userId) => {
            const user = await prisma.user.findUnique({ where: { id: userId } });
            if (!user) return;
            const qqUin = user.qqUin.toString();
            const endsAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
            oneBot?.sendPrivateMessageViaTenantBots(context.selectedTenant.id, qqUin, formatBanNotify(context.selectedTenant.name, injectionResult.reason, endsAt)).catch((notifyErr) => {
              app.log.warn({ error: notifyErr }, "failed to send ban notification");
            });
          },
        }).catch((banErr) => {
          app.log.warn({ error: banErr }, "failed to create auto ban");
        });

        throw {
          status: 403,
          message: `投稿包含不安全内容，账号已被封禁 24 小时：${injectionResult.reason}`,
        };
      }

      const initialStatus: "pending_approval" = "pending_approval";
      const logComment = "投稿创建";

      // Create post in transaction with retry logic
      let post: Awaited<ReturnType<typeof prisma.post.create>> | null = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          post = await prisma.$transaction(
            async (tx) => {
              // 只有待审核状态才受待审核数量限制
              if (initialStatus === "pending_approval") {
                const pendingPostLimit = await readTenantPendingPostLimit(tx, context.selectedTenant.id);
                if (pendingPostLimit > 0) {
                  const pendingCount = await tx.post.count({
                    where: {
                      tenantId: context.selectedTenant.id,
                      authorId: context.user.id,
                      status: "pending_approval",
                    },
                  });
                  if (pendingCount >= pendingPostLimit) {
                    throw new PendingPostLimitError(pendingCount, pendingPostLimit);
                  }
                }
              }

              const tenant = await tx.tenant.update({
                where: {
                  id: context.selectedTenant.id,
                },
                data: {
                  nextPostDisplayId: {
                    increment: 1,
                  },
                },
                select: {
                  nextPostDisplayId: true,
                },
              });
              const displayId = tenant.nextPostDisplayId - 1;

              return tx.post.create({
                data: {
                  tenantId: context.selectedTenant.id,
                  authorId: context.user.id,
                  displayId,
                  text,
                  anonymous,
                  anonymousAvatar,
                  bgColor,
                  textColor,
                  font: font || null,
                  attachments: staged,
                  status: initialStatus,
                  logs: {
                    create: {
                      tenantId: context.selectedTenant.id,
                      actorId: context.user.id,
                      newStatus: initialStatus,
                      comment: logComment,
                    },
                  },
                },
              });
            },
            { isolationLevel: TransactionIsolationLevel.Serializable },
          );
          break;
        } catch (caught) {
          if (caught instanceof PendingPostLimitError) {
            throw caught;
          }
          if (isTransactionSerializationFailure(caught) && attempt < 2) {
            continue;
          }
          throw caught;
        }
      }

      if (!post) {
        throw {
          status: 503,
          message: "投稿人数较多，请稍后再试",
        };
      }

      oneBot?.notifyNewPost(post.id).catch((error) => {
        app.log.warn({ error, postId: post.id }, "failed to notify review group");
      });

      return {
        post: toPostListItem(post),
      };
    } catch (err) {
      // Cleanup uploaded files on error
      await deleteAttachmentObjects(config, uploadedKeys).catch((cleanupErr) => {
        app.log.warn({ error: cleanupErr }, "failed to cleanup uploaded attachments");
      });

      // Handle errors
      if (err instanceof PendingPostLimitError) {
        return reply.code(409).send({
          message: `你还有 ${err.pendingCount} 条稿件待审核，当前校园墙最多同时保留 ${err.limit} 条待审核稿件。`,
        });
      }

      if (typeof err === "object" && err !== null && "status" in err && "message" in err) {
        const errorObj = err as { status: number; message: string; fileIndex?: number };
        return reply.code(errorObj.status).send({
          message: errorObj.message,
          ...(errorObj.fileIndex !== undefined ? { fileIndex: errorObj.fileIndex } : {}),
        });
      }

      throw err;
    }
  });

  /**
   * Read from a readable stream with size cap enforcement.
   */
  async function readPartCapped(
    sourceStream: NodeJS.ReadableStream,
    cap: number,
    fileIndex: number,
  ): Promise<Buffer> {
    let transferredBytes = 0;
    const chunks: Buffer[] = [];

    const limitedStream = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        transferredBytes += chunk.length;
        if (transferredBytes > cap) {
          callback(new Error("size limit exceeded"));
          return;
        }
        chunks.push(chunk);
        callback();
      },
    });

    try {
      await pipeline(sourceStream, limitedStream);
      return Buffer.concat(chunks);
    } catch (error) {
      if (!limitedStream.destroyed) {
        limitedStream.destroy();
      }
      if (error instanceof Error && (error.message === "size limit exceeded" || error.message.includes("size limit exceeded"))) {
        throw {
          status: 413,
          message: "文件过大，请检查文件大小限制",
          fileIndex,
        };
      }
      throw error;
    }
  }


  app.get("/api/posts/mine", async (request, reply) => {
    const context = await requireTenantContext(request, reply);
    const query = listQuerySchema.parse(request.query);
    const where = {
      tenantId: context.selectedTenant.id,
      authorId: context.user.id,
    };
    const [total, posts] = await Promise.all([
      prisma.post.count({ where }),
      prisma.post.findMany({
        where,
        include: {
          logs: {
            orderBy: {
              createdAt: "asc",
            },
          },
          follows: {
            where: {
              userId: context.user.id,
            },
            select: {
              id: true,
            },
            take: 1,
          },
          qzonePostMetrics: {
            include: {
              publishAttempt: {
                select: {
                  publishTarget: {
                    select: {
                      displayName: true,
                      botAccount: {
                        select: {
                          displayName: true,
                          qqUin: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          batchItem: {
            select: {
              batch: {
                select: {
                  status: true,
                  items: {
                    select: { post: { select: { displayId: true } } },
                  },
                },
              },
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);

    return {
      posts: posts.map(toPostListItem),
      pagination: toPagination(query.page, query.limit, total),
    };
  });

  function toPagination(page: number, limit: number, total: number) {
    return {
      page,
      limit,
      total,
      pageCount: Math.max(1, Math.ceil(total / limit)),
    };
  }

  // 「已发布」聚合 feed：按说说为单位返回已发布稿件（独立发布 + 批量发布），
  // 互动数据按说说聚合，匿名作者按调用者角色脱敏（审核员可见真实身份）。
  // 面向本墙任意登录成员公开。
  app.get("/api/posts/published", async (request, reply) => {
    const context = await requireReadyTenant(request, reply, "submitter");
    const query = listQuerySchema.parse(request.query);
    const tenantId = context.selectedTenant.id;
    const viewerIsReviewer = hasTenantRole(context.selectedMembership.role, "reviewer");

    const metricInclude = {
      include: {
        publishAttempt: {
          select: {
            publishTarget: {
              select: {
                displayName: true,
                botAccount: {
                  select: {
                    displayName: true,
                    qqUin: true,
                  },
                },
              },
            },
          },
        },
      },
    } as const;

    const authorSelect = { select: { displayName: true, qqUin: true } } as const;

    const [singlePosts, batches] = await Promise.all([
      // A) 独立发布稿件：已发布且不属于任何批次
      prisma.post.findMany({
        where: {
          tenantId,
          status: "published",
          batchItem: { is: null },
        },
        include: {
          author: authorSelect,
          qzonePostMetrics: metricInclude,
        },
        orderBy: { updatedAt: "desc" },
      }),
      // B) 已发布批次（批量）
      prisma.publishBatch.findMany({
        where: { tenantId, status: "published" },
        include: {
          items: {
            orderBy: { position: "asc" },
            include: { post: { include: { author: authorSelect } } },
          },
          attempts: {
            include: { qzonePostMetrics: metricInclude },
          },
        },
        orderBy: { flushedAt: "desc" },
      }),
    ]);

    const toRawPost = (post: {
      id: string;
      displayId: number;
      text: string;
      attachments: unknown;
      anonymous: boolean;
      bgColor: string | null;
      textColor: string | null;
      font: string | null;
      createdAt: Date;
      author: { displayName: string | null; qqUin: bigint } | null;
    }): RawFeedPost => ({
      id: post.id,
      displayId: post.displayId,
      text: post.text,
      attachments: post.attachments,
      anonymous: post.anonymous,
      bgColor: post.bgColor,
      textColor: post.textColor,
      font: post.font,
      author: post.author ? { displayName: post.author.displayName ?? "", qqUin: post.author.qqUin } : null,
      createdAt: post.createdAt,
    });

    const singles: SingleFeedInput[] = singlePosts.map((post) => ({
      post: toRawPost(post),
      publishedAt: post.updatedAt,
      metrics: post.qzonePostMetrics,
    }));

    const batchInputs: BatchFeedInput[] = batches.map((batch) => {
      const metrics = batch.attempts.flatMap((attempt) => attempt.qzonePostMetrics);
      return {
        batchId: batch.id,
        publishedAt: batch.flushedAt ?? batch.updatedAt,
        posts: batch.items.map((item) => toRawPost(item.post)),
        metrics,
      };
    });

    const allItems = buildPublishedFeed({ singles, batches: batchInputs, viewerIsReviewer });
    const total = allItems.length;
    const start = (query.page - 1) * query.limit;
    const items = allItems.slice(start, start + query.limit);

    return {
      items,
      pagination: toPagination(query.page, query.limit, total),
    };
  });

  app.get("/api/posts/:id/render-preview", async (request, reply) => {
    const context = await requireTenantContext(request, reply);
    const params = postParamsSchema.parse(request.params);
    const post = await prisma.post.findFirst({
      where: {
        tenantId: context.selectedTenant.id,
        id: params.id,
      },
      include: {
        author: true,
        tenant: true,
      },
    });

    if (!post) {
      return reply.code(404).send({ message: "稿件不存在" });
    }
    if (post.authorId !== context.user.id && !hasTenantRole(context.selectedMembership.role, "reviewer")) {
      return reply.code(403).send({ message: "没有权限预览该稿件" });
    }

    const previewBot = await prisma.botAccount.findFirst({
      where: {
        tenantId: context.selectedTenant.id,
        enabled: true,
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    const anonymousAvatar = post.anonymous && post.anonymousAvatar
      ? readSvgAvatarDataUrl(post.anonymousAvatar)
      : undefined;

    const bytes = await renderPostCard({
      tenantName: post.tenant.name,
      displayHost: post.tenant.host,
      displayId: post.displayId,
      authorName: post.author.displayName ?? post.author.qqUin.toString(),
      authorQq: post.author.qqUin.toString(),
      cornerQq: previewBot?.qqUin.toString(),
      text: post.text,
      createdAt: post.createdAt,
      anonymous: post.anonymous,
      anonymousAvatar: anonymousAvatar ?? undefined,
      bgColor: post.bgColor ?? null,
      textColor: post.textColor ?? null,
      font: post.font ?? null,
    });

    reply.header("Cache-Control", "private, max-age=60");
    reply.type("image/jpeg");
    return reply.send(Buffer.from(bytes));
  });

  // ── 投稿前字体预览 ──────────────────────────────────────
  // 用户在选择了非默认字体时，提交前先调此接口生成渲染图确认效果。
  const renderPreviewBodySchema = z.object({
    text: z.string().min(1).max(1000),
    font: z.string().optional(),
    bgColor: z.string().optional(),
    textColor: z.string().optional(),
    anonymous: z.boolean().optional(),
  });

  app.post("/api/posts/render-preview", async (request, reply) => {
    const context = await requireTenantContext(request, reply);
    const body = renderPreviewBodySchema.parse(request.body);

    const previewBot = await prisma.botAccount.findFirst({
      where: {
        tenantId: context.selectedTenant.id,
        enabled: true,
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    try {
      const bytes = await renderPostCard({
        tenantName: context.selectedTenant.name,
        displayHost: context.selectedTenant.host,
        authorName: context.user.displayName ?? context.user.qqUin.toString(),
        authorQq: context.user.qqUin.toString(),
        cornerQq: previewBot?.qqUin.toString(),
        text: body.text,
        createdAt: new Date(),
        anonymous: body.anonymous ?? false,
        anonymousAvatar: undefined,
        bgColor: body.bgColor ?? null,
        textColor: body.textColor ?? null,
        font: body.font ?? null,
      });

      reply.header("Cache-Control", "no-store");
      reply.type("image/jpeg");
      return reply.send(Buffer.from(bytes));
    } catch (err) {
      app.log.error({ err, font: body.font }, "render-preview failed");
      return reply.code(500).send({ message: "渲染预览失败，请稍后重试" });
    }
  });

  app.post("/api/posts/:id/cancel", async (request, reply) => {
    const context = await requireReadyTenant(request, reply, "submitter");
    const params = postParamsSchema.parse(request.params);
    const post = await prisma.post.findFirst({
      where: {
        id: params.id,
        tenantId: context.selectedTenant.id,
        authorId: context.user.id,
      },
    });

    if (!post) {
      return reply.code(404).send({ message: "稿件不存在" });
    }
    if (post.status !== "pending_approval") {
      return reply.code(409).send({ message: "只有待审核稿件可以取消" });
    }

    const updated = await prisma.post.update({
      where: {
        id: post.id,
      },
      data: {
        status: "cancelled",
        logs: {
          create: {
            tenantId: context.selectedTenant.id,
            actorId: context.user.id,
            oldStatus: post.status,
            newStatus: "cancelled",
            comment: "用户取消",
          },
        },
      },
    });
    oneBot?.notifyPostCancelled(updated.id).catch((error) => {
      app.log.warn({ error, postId: updated.id }, "failed to notify post cancellation");
    });

    return {
      post: toPostListItem(updated),
    };
  });

  app.post("/api/posts/:id/recall/request", async (request, reply) => {
    const context = await requireReadyTenant(request, reply, "submitter");
    const params = postParamsSchema.parse(request.params);
    const post = await prisma.post.findFirst({
      where: {
        id: params.id,
        tenantId: context.selectedTenant.id,
        authorId: context.user.id,
      },
    });

    if (!post) {
      return reply.code(404).send({ message: "稿件不存在" });
    }
    if (post.status === "pending_recall") {
      return {
        post: toPostListItem(post),
      };
    }
    if (post.status !== "published") {
      return reply.code(409).send({ message: "只有已发表稿件可以申请撤回" });
    }
    const batchItem = await prisma.publishBatchItem.findUnique({
      where: { postId: post.id },
      select: { id: true },
    });
    if (batchItem) {
      return reply.code(409).send({ message: "批量发布的稿件不支持程序撤回，请联系管理员手动到 QQ 空间删除对应说说" });
    }
    const body = recallRequestSchema.parse(request.body ?? {});
    const reason = body.reason.trim();

    const updated = await prisma.post.update({
      where: {
        id: post.id,
      },
      include: {
        logs: {
          where: {
            oldStatus: "published",
            newStatus: "pending_recall",
          },
          orderBy: {
            createdAt: "desc",
          },
          take: 1,
        },
      },
      data: {
        status: "pending_recall",
        recallIgnored: false,
        recallIgnoredAt: null,
        logs: {
          create: {
            tenantId: context.selectedTenant.id,
            actorId: context.user.id,
            oldStatus: post.status,
            newStatus: "pending_recall",
            comment: `用户申请撤回：${reason}`,
          },
        },
      },
    });
    await writeAuditLog({
      tenantId: context.selectedTenant.id,
      actorId: context.user.id,
      action: "post.recall.request",
      targetType: "post",
      targetId: post.id,
      detail: {
        displayId: post.displayId,
        reason,
      },
    });
    oneBot?.notifyPostRecallRequested(updated.id).catch((error) => {
      app.log.warn({ error, postId: updated.id }, "failed to notify post recall request");
    });

    return {
      post: toPostListItem(updated),
    };
  });

  app.post("/api/posts/:id/follow", async (request, reply) => {
    const context = await requireTenantContext(request, reply);
    const params = postParamsSchema.parse(request.params);
    const post = await prisma.post.findFirst({
      where: {
        id: params.id,
        tenantId: context.selectedTenant.id,
        authorId: context.user.id,
      },
      select: {
        id: true,
        qzonePostMetrics: {
          select: {
            commentCount: true,
          },
        },
      },
    });
    if (!post) {
      return reply.code(404).send({ message: "稿件不存在或不是你的稿件" });
    }
    const currentCommentCount = post.qzonePostMetrics.reduce((sum, metric) => sum + (metric.commentCount ?? 0), 0);
    await prisma.postFollow.upsert({
      where: {
        postId_userId: {
          postId: post.id,
          userId: context.user.id,
        },
      },
      create: {
        tenantId: context.selectedTenant.id,
        postId: post.id,
        userId: context.user.id,
        // Seed the baseline at the current comment count so the first scheduled
        // push only reports comments that arrive after the user starts following.
        lastPushedCommentCount: currentCommentCount,
      },
      update: {},
    });
    return { following: true };
  });

  app.delete("/api/posts/:id/follow", async (request, reply) => {
    const context = await requireTenantContext(request, reply);
    const params = postParamsSchema.parse(request.params);
    await prisma.postFollow.deleteMany({
      where: {
        postId: params.id,
        userId: context.user.id,
        tenantId: context.selectedTenant.id,
      },
    });
    return { following: false };
  });
}
