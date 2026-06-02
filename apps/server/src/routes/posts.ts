import { Buffer } from "node:buffer";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { CreateBucketCommand, GetObjectCommand, HeadBucketCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { CampuxConfig } from "@campux/config";
import { Prisma } from "@campux/db";
import { createS3Client } from "@campux/integrations";
import { renderPostCard } from "@campux/render";
import { hasTenantRole, requireReadyTenant, requireTenantContext } from "../lib/auth";
import { toPostListItem } from "../lib/posts";
import { prisma } from "../lib/prisma";
import { readTenantPendingPostLimit, readTenantImageCompression } from "../lib/tenant-metadata";
import { writeAuditLog } from "../lib/audit";
import { compressImageBuffer, uploadAttachmentBytes, deleteAttachmentObjects, type PostAttachment } from "../lib/attachments";
import { enqueueAiAnalyzePost } from "../runtime/campus-modeling";
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

function isAllowedImageType(contentType: string): boolean {
  return IMAGE_MIME_TYPES.has(contentType);
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

async function ensureBucket(config: CampuxConfig) {
  const s3 = createS3Client(config);
  try {
    await s3.send(new HeadBucketCommand({ Bucket: config.s3.bucket }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: config.s3.bucket }));
  }

  return s3;
}

async function uploadImageBytes({
  config,
  tenantId,
  fileName,
  contentType,
  body,
}: {
  config: CampuxConfig;
  tenantId: string;
  fileName: string;
  contentType: string;
  body: Buffer | Transform;
}) {
  const extension = sanitizeUploadExtension(fileName);
  const key = `tenants/${tenantId}/uploads/${crypto.randomUUID()}.${extension}`;
  const s3 = await ensureBucket(config);

  await new Upload({
    client: s3,
    params: {
      Bucket: config.s3.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    },
  }).done();

  return {
    key,
    url: `/api/uploads/post-image?key=${encodeURIComponent(key)}`,
    fileName,
  };
}

function isTransactionSerializationFailure(value: unknown) {
  return value instanceof Prisma.PrismaClientKnownRequestError && value.code === "P2034";
}

export function registerPostRoutes(app: FastifyInstance, config: CampuxConfig, queue: RuntimeQueue, oneBot?: OneBotRuntime) {
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

    const s3 = await ensureBucket(config);
    const object = await s3.send(
      new GetObjectCommand({
        Bucket: config.s3.bucket,
        Key: query.key,
      }),
    );

    if (object.ContentType) {
      reply.header("Content-Type", object.ContentType);
    }
    reply.header("Cache-Control", "private, max-age=3600");
    return reply.send(object.Body);
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
    const staged: PostAttachment[] = [];

    try {
      let fileIndex = 0;
      for await (const part of request.parts()) {
        if (part.type === "field") {
          if (part.fieldname === "text") {
            text = String(part.value ?? "");
          } else if (part.fieldname === "anonymous") {
            anonymous = part.value === "true" || part.value === true;
          }
          continue;
        }

        if (part.fieldname !== "images") {
          part.file.destroy();
          continue;
        }

        if (staged.length >= 9) {
          part.file.destroy();
          throw {
            status: 400,
            message: "最多 9 张图片",
            fileIndex,
          };
        }

        const mime = part.mimetype || "application/octet-stream";
        if (!isAllowedImageType(mime)) {
          part.file.destroy();
          throw {
            status: 415,
            message: "仅支持图片格式",
            fileIndex,
          };
        }

        const cap = 10 * 1024 * 1024;

        // Read file with size cap using Transform
        const buf = await readPartCapped(part.file, cap, fileIndex);

        const finalBuf = await compressImageBuffer(buf, mime, compression);

        // Upload to S3
        const att = await uploadAttachmentBytes({
          config,
          tenantId: context.selectedTenant.id,
          kind: "image",
          contentType: mime,
          fileName: part.filename || "attachment.jpg",
          body: finalBuf,
        });
        uploadedKeys.push(att.key);
        staged.push(att);
        fileIndex += 1;
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

      // Create post in transaction with retry logic
      let post: Awaited<ReturnType<typeof prisma.post.create>> | null = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          post = await prisma.$transaction(
            async (tx) => {
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
                  attachments: staged,
                  status: "pending_approval",
                  logs: {
                    create: {
                      tenantId: context.selectedTenant.id,
                      actorId: context.user.id,
                      newStatus: "pending_approval",
                      comment: "投稿创建",
                    },
                  },
                },
              });
            },
            { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
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
      enqueueAiAnalyzePost(queue, context.selectedTenant.id, post.id);

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

    const bytes = await renderPostCard({
      tenantName: post.tenant.name,
      displayHost: post.tenant.host,
      authorName: post.author.displayName ?? post.author.qqUin.toString(),
      authorQq: post.author.qqUin.toString(),
      cornerQq: previewBot?.qqUin.toString(),
      text: post.text,
      createdAt: post.createdAt,
      anonymous: post.anonymous,
    });

    reply.header("Cache-Control", "private, max-age=60");
    reply.type("image/jpeg");
    return reply.send(Buffer.from(bytes));
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
}
