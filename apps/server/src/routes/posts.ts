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
import { buildPublishedFeed, filterPublishedFeedByTag, type BatchFeedInput, type RawFeedPost, type SingleFeedInput } from "../lib/published-feed";
import { serializeAssignedPostTags } from "../lib/post-tags";
import { prisma } from "../lib/prisma";
import { readTenantPendingPostLimit, readTenantImageCompression } from "../lib/tenant-metadata";
import {
  buildImageSourceSizeErrorMessage,
  buildVideoGifFfmpegArgs,
  convertedVideoGifSizeErrorMessage,
  createConvertedGifClaim,
  hasGifSignature,
  imageStorageHardMaxBytes,
  isAttachmentOrderCompatible,
  isTrustedConvertedGifUrl,
  readResponseBufferWithLimit,
  resolveImageUploadLimits,
  restoreAttachmentOrder,
  ResponseBodyTooLargeError,
  shouldExposeRemoteGifIndexes,
  type AttachmentOrderKind,
  validateConvertedGifClaim,
  validateConvertedVideoGifSize,
  validateProcessedImageSize,
} from "../lib/image-upload-policy";
import { writeAuditLog } from "../lib/audit";
import { compressImageBuffer, uploadAttachmentBytes, deleteAttachmentObjects, type PostAttachment } from "../lib/attachments";
import { detectPostInjection, validateRemoteGifUrls, createAutoBan } from "../lib/sanitize";
import { readSvgAvatarDataUrl } from "../lib/svg-avatars";
import { formatBanNotify } from "../lib/bot-messages";
import type { RuntimeQueue } from "../runtime/queue";
import type { OneBotRuntime } from "../runtime/onebot";
import { autoTagPost } from "../runtime/post-tagging";
import { verifyPublicForumMediaSignature } from "../lib/public-forum-media";
import { getServerSigningSecret } from "../lib/server-signing-secret";
import {
  ConvertedGifClaimStore,
  ConvertedGifClaimUnavailableError,
  convertedGifClaimSettingPrefix,
  type ConvertedGifClaimSetting,
} from "../lib/converted-gif-claim-store";
import { readSingleVideoUpload, SingleVideoUploadError } from "../lib/single-video-upload";

const fileQuerySchema = z.object({
  key: z.string().min(1),
});

const publicForumMediaQuerySchema = fileQuerySchema.extend({
  expires: z.coerce.number().int().positive(),
  signature: z.string().min(1),
});

const postParamsSchema = z.object({
  id: z.string().min(1),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  q: z.string().trim().max(200).optional(),
});

const publishedListQuerySchema = listQuerySchema.extend({
  tag: z.string().trim().max(80).optional(),
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

class ConvertedVideoGifSizeError extends Error {
  constructor() {
    super(convertedVideoGifSizeErrorMessage);
    this.name = "ConvertedVideoGifSizeError";
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

const VIDEO_SIZE_CAP = 15 * 1024 * 1024;
const REMOTE_VIDEO_SIZE_CAP = VIDEO_SIZE_CAP;
const MAX_VIDEO_DURATION_SEC = 60;
const SCDN_API_URL = "https://img.scdn.io/api/v1.php";
const SCDN_RESPONSE_MAX_BYTES = 64 * 1024;
const MAX_CONCURRENT_VIDEO_GIF_CONVERSIONS = 2;
const VIDEO_UPLOAD_DEADLINE_MS = 30_000;
const activeVideoGifConversions = new Set<string>();
const convertedGifClaimStore = new ConvertedGifClaimStore({
  transaction: (callback) => prisma.$transaction(async (tx) => callback({
    deleteByKeys: async (keys) => {
      const deleted = await tx.systemSetting.deleteMany({
        where: { key: { in: keys } },
      });
      return deleted.count;
    },
  })),
  pruneAndCreate: async (cutoff, setting) => {
    await prisma.$transaction([
      prisma.systemSetting.deleteMany({
        where: {
          key: { startsWith: convertedGifClaimSettingPrefix },
          updatedAt: { lte: cutoff },
        },
      }),
      prisma.systemSetting.create({ data: setting }),
    ]);
  },
  restore: async (settings) => {
    await prisma.systemSetting.createMany({ data: settings });
  },
});

function reserveVideoGifConversion(conversionKey: string): (() => void) | null {
  if (activeVideoGifConversions.has(conversionKey)
    || activeVideoGifConversions.size >= MAX_CONCURRENT_VIDEO_GIF_CONVERSIONS) {
    return null;
  }
  activeVideoGifConversions.add(conversionKey);
  return () => {
    activeVideoGifConversions.delete(conversionKey);
  };
}

const VIDEO_CONTAINER_FORMATS = new Set([
  "3gp",
  "3g2",
  "avi",
  "matroska",
  "mj2",
  "mov",
  "mp4",
  "webm",
]);

async function probeVideoFile(inputPath: string): Promise<number> {
  const { spawn } = await import("node:child_process");
  return new Promise<number>((resolve, reject) => {
    const proc = spawn("ffprobe", [
      "-v", "quiet",
      "-print_format", "json",
      "-show_entries", "format=duration,format_name:stream=codec_type",
      inputPath,
    ], { timeout: 10000 });
    let stdout = "";
    let stdoutBytes = 0;
    let stdoutTooLarge = false;
    proc.stdout?.on("data", (data: Buffer) => {
      stdoutBytes += data.byteLength;
      if (stdoutBytes > 64 * 1024) {
        stdoutTooLarge = true;
        proc.kill("SIGKILL");
        return;
      }
      stdout += data.toString();
    });
    proc.on("close", (code) => {
      if (stdoutTooLarge) {
        reject(new Error("视频元数据过大"));
        return;
      }
      if (code !== 0) {
        reject(new Error("无法解析视频信息"));
        return;
      }
      try {
        const info = JSON.parse(stdout) as {
          format?: { duration?: string; format_name?: string };
          streams?: Array<{ codec_type?: string }>;
        };
        const duration = Number(info.format?.duration);
        const formats = new Set((info.format?.format_name ?? "").split(","));
        const hasSupportedContainer = [...formats].some((format) => VIDEO_CONTAINER_FORMATS.has(format));
        const hasVideoStream = info.streams?.some((stream) => stream.codec_type === "video") ?? false;
        if (!Number.isFinite(duration) || duration <= 0 || !hasSupportedContainer || !hasVideoStream) {
          reject(new Error("文件不是受支持的视频"));
          return;
        }
        resolve(duration);
      } catch {
        reject(new Error("无法解析视频信息"));
      }
    });
    proc.on("error", (error: NodeJS.ErrnoException) => {
      reject(error.code === "ENOENT"
        ? new Error("服务端未安装 ffprobe，请使用 Web 前端投稿")
        : error);
    });
  });
}

async function probeVideoBuffer(videoBuffer: Buffer): Promise<number> {
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const tmpDir = mkdtempSync(join(tmpdir(), "campux-video-probe-"));
  const inputPath = join(tmpDir, "input.bin");
  try {
    writeFileSync(inputPath, videoBuffer);
    return await probeVideoFile(inputPath);
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

async function uploadVideoToScdn(videoBuffer: Buffer, fileName: string, mimeType: string): Promise<string> {
  const formData = new FormData();
  formData.append("image", new Blob([Uint8Array.from(videoBuffer)], { type: mimeType }), fileName);
  formData.append("outputFormat", "gif");
  formData.append("cdn_domain", "cloudflarecnimg.scdn.io");
  formData.append("storage_destination", "telegram");

  const response = await fetch(SCDN_API_URL, {
    method: "POST",
    body: formData,
    redirect: "manual",
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`视频转换服务返回 HTTP ${response.status}`);
  }
  const body = await readResponseBufferWithLimit(response, SCDN_RESPONSE_MAX_BYTES);
  let payload: { success?: boolean; data?: { url?: string }; message?: string; error?: string };
  try {
    payload = JSON.parse(body.toString("utf8"));
  } catch {
    throw new Error("视频转换服务返回了无效响应");
  }
  const url = payload.data?.url;
  if (!payload.success || typeof url !== "string" || !isTrustedConvertedGifUrl(url)) {
    throw new Error(payload.message || payload.error || "视频转换服务未返回可信 GIF 地址");
  }
  return url;
}

/**
 * Convert a bounded video buffer to a bounded GIF using ffmpeg.
 * Output is constrained before encoding starts so crafted videos cannot grow
 * unbounded temporary files or heap allocations.
 */
async function convertVideoToGif(videoBuffer: Buffer): Promise<{ buffer: Buffer }> {
  const { spawn } = await import("node:child_process");
  const { mkdtempSync, writeFileSync, readFileSync, rmSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");

  const tmpDir = mkdtempSync(join(tmpdir(), "campux-video-"));
  const inputPath = join(tmpDir, "input.mp4");
  const outputPath = join(tmpDir, "output.gif");

  try {
    writeFileSync(inputPath, videoBuffer);

    const duration = await probeVideoFile(inputPath);

    if (duration > MAX_VIDEO_DURATION_SEC) {
      throw new Error(`视频时长 ${Math.round(duration)}s 超过限制 (${MAX_VIDEO_DURATION_SEC}s)`);
    }

    await new Promise<void>((resolve, reject) => {
      const ffmpeg = spawn("ffmpeg", buildVideoGifFfmpegArgs(inputPath, outputPath), { timeout: 60000 });
      let stderr = "";
      ffmpeg.stderr?.on("data", (d: Buffer) => {
        stderr = `${stderr}${d.toString()}`.slice(-4_096);
      });
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

    const sizeValidation = validateConvertedVideoGifSize(statSync(outputPath).size);
    if (!sizeValidation.ok) {
      throw new ConvertedVideoGifSizeError();
    }
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

const multipartLimitErrorCodes = new Set([
  "FST_PARTS_LIMIT",
  "FST_FILES_LIMIT",
  "FST_FIELDS_LIMIT",
  "FST_REQ_FILE_TOO_LARGE",
]);

function isMultipartLimitError(error: unknown): boolean {
  return Boolean(error
    && typeof error === "object"
    && "code" in error
    && multipartLimitErrorCodes.has(String(error.code)));
}

function isTransactionSerializationFailure(value: unknown) {
  return isPrismaKnownRequestError(value) && value.code === "P2034";
}

export function registerPostRoutes(app: FastifyInstance, config: CampuxConfig, _queue: RuntimeQueue, oneBot?: OneBotRuntime) {
  app.get("/api/public/forum-media", async (request, reply) => {
    const query = publicForumMediaQuerySchema.parse(request.query);
    if (!verifyPublicForumMediaSignature(query.key, query.expires, query.signature)) {
      return reply.code(403).send({ message: "图片链接无效或已过期" });
    }
    if (!/^tenants\/[^/]+\/(?:uploads|legacy|published\/qq-forum)\//.test(query.key)) {
      return reply.code(403).send({ message: "图片路径不允许公开访问" });
    }

    const storage = getStorageDriver(config);
    const object = await storage.getBytes(query.key);
    if (!object) {
      return reply.code(404).send({ message: "图片不存在" });
    }
    if (object.contentType) {
      reply.header("Content-Type", object.contentType);
    }
    reply.header("Cache-Control", "public, max-age=3600");
    return reply.send(Buffer.from(object.bytes));
  });

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

  app.post("/api/uploads/video-gif", async (request, reply) => {
    const context = await requireReadyTenant(request, reply, "submitter");
    const activeBan = await prisma.banRecord.findFirst({
      where: {
        tenantId: context.selectedTenant.id,
        userId: context.user.id,
        endsAt: { gt: new Date() },
      },
      orderBy: { endsAt: "desc" },
    });
    if (activeBan) {
      return reply.code(403).send({ message: `账号已被封禁：${activeBan.comment}` });
    }
    const signingSecret = getServerSigningSecret();
    const conversionKey = `${context.selectedTenant.id}:${context.user.id}`;
    const releaseConversion = reserveVideoGifConversion(conversionKey);
    if (!releaseConversion) {
      reply.header("Connection", "close");
      reply.raw.once("finish", () => request.raw.destroy());
      return reply.code(429).send({ message: "视频转换繁忙，请稍后重试" });
    }
    const uploadDeadline = setTimeout(() => {
      request.raw.destroy(new Error("video upload deadline exceeded"));
    }, VIDEO_UPLOAD_DEADLINE_MS);

    try {
      let videoUpload: Awaited<ReturnType<typeof readSingleVideoUpload>>;
      try {
        videoUpload = await readSingleVideoUpload(request, {
          maxBytes: REMOTE_VIDEO_SIZE_CAP,
          isAllowedMimeType: isConvertibleVideoType,
          missingMessage: "请选择视频文件",
          sizeMessage: "视频原文件不能超过 15MB",
          shapeMessage: "视频上传字段或附件超过限制",
          typeMessage: "仅支持 MP4、WebM、MOV、AVI、MKV 或 3GP 视频",
        });
        clearTimeout(uploadDeadline);
      } catch (error) {
        if (error instanceof SingleVideoUploadError) {
          return reply.code(error.status).send({ message: error.message });
        }
        throw error;
      }
      const {
        buffer: videoBuffer,
        filename: videoFilename,
        mimetype: videoMimetype,
      } = videoUpload;

      try {
        const duration = await probeVideoBuffer(videoBuffer);
        if (duration > MAX_VIDEO_DURATION_SEC) {
          return reply.code(400).send({ message: `视频时长不能超过 ${MAX_VIDEO_DURATION_SEC} 秒` });
        }
      } catch (error) {
        return reply.code(400).send({
          message: error instanceof Error ? error.message : "无法解析视频信息",
        });
      }

      let url: string;
      try {
        url = await uploadVideoToScdn(
          videoBuffer,
          videoFilename,
          videoMimetype,
        );
      } catch (error) {
        app.log.warn({ error }, "server-side video GIF conversion failed");
        return reply.code(502).send({
          message: error instanceof Error ? error.message : "视频转换服务暂时不可用",
        });
      }

      const claimNow = Date.now();
      const proof = createConvertedGifClaim({
        url,
        tenantId: context.selectedTenant.id,
        userId: context.user.id,
        sessionTokenHash: context.session.tokenHash,
        signingSecret,
        now: claimNow,
      });
      await convertedGifClaimStore.issue(proof, claimNow);
      reply.header("Cache-Control", "no-store");
      return reply.send({ url, proof });
    } finally {
      clearTimeout(uploadDeadline);
      releaseConversion();
    }
  });

  app.post("/api/posts", async (request, reply) => {
    const context = await requireReadyTenant(request, reply, "submitter");
    const compression = await readTenantImageCompression(prisma, context.selectedTenant.id);
    const imageUploadLimits = resolveImageUploadLimits({
      maxSizeMb: compression.maxSizeMb,
      compressionEnabled: compression.enabled,
    });

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
    const remoteGifClaims: Array<{ url: string; proof: string }> = [];
    let attachmentOrder: AttachmentOrderKind[] | null = null;
    let consumedConvertedGifClaimSettings: ConvertedGifClaimSetting[] = [];

    try {
      let fileIndex = 0;
      for await (const part of request.parts({
        limits: {
          fieldNameSize: 64,
          fieldSize: 32 * 1024,
          fields: 10,
          files: 9,
          headerPairs: 32,
          parts: 19,
          fileSize: Math.max(REMOTE_VIDEO_SIZE_CAP, imageUploadLimits.sourceMaxBytes),
        },
      })) {
        if (part.type === "field") {
          if (part.fieldnameTruncated || part.valueTruncated) {
            throw {
              status: 413,
              message: "投稿字段过大",
            };
          }
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
          } else if (part.fieldname === "attachmentOrder") {
            try {
              const parsed = JSON.parse(String(part.value ?? "[]"));
              if (!Array.isArray(parsed)
                || parsed.length > 9
                || parsed.some((kind) => kind !== "local" && kind !== "remote")) {
                throw new Error("invalid attachment order");
              }
              attachmentOrder = parsed;
            } catch {
              throw {
                status: 400,
                message: "附件顺序格式无效",
              };
            }
          } else if (part.fieldname === "remoteGifUrls") {
            throw {
              status: 400,
              message: "视频转换凭证缺失，请重新转换",
            };
          } else if (part.fieldname === "remoteGifClaims") {
            try {
              const parsed = JSON.parse(String(part.value ?? "[]"));
              if (!Array.isArray(parsed)
                || parsed.length > 9
                || parsed.some((claim) => !claim
                  || typeof claim !== "object"
                  || typeof claim.url !== "string"
                  || claim.url.length > 2_048
                  || typeof claim.proof !== "string"
                  || claim.proof.length > 256)) {
                throw new Error("invalid claims");
              }
              remoteGifClaims.push(...parsed.map((claim) => ({
                url: claim.url,
                proof: claim.proof,
              })));
            } catch {
              throw {
                status: 400,
                message: "视频转换凭证格式无效",
              };
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
        const cap = isVideo ? VIDEO_SIZE_CAP : imageUploadLimits.sourceMaxBytes;
        const sizeErrorMessage = isVideo
          ? "视频原文件不能超过 15MB"
          : buildImageSourceSizeErrorMessage({
              compressionEnabled: compression.enabled,
              maxSizeMb: compression.maxSizeMb,
            });
        const releaseConversion = isVideo
          ? reserveVideoGifConversion(`${context.selectedTenant.id}:${context.user.id}`)
          : null;
        if (isVideo && !releaseConversion) {
          part.file.destroy();
          reply.header("Connection", "close");
          reply.raw.once("finish", () => request.raw.destroy());
          throw {
            status: 429,
            message: "视频转换繁忙，请稍后重试",
            fileIndex,
          };
        }
        const uploadDeadline = isVideo
          ? setTimeout(() => request.raw.destroy(new Error("video upload deadline exceeded")), VIDEO_UPLOAD_DEADLINE_MS)
          : null;

        let finalBuf: Buffer;
        let finalMime: string;
        let finalFileName: string;
        try {
          const buf = await readPartCapped(part.file, cap, fileIndex, sizeErrorMessage);
          if (uploadDeadline) {
            clearTimeout(uploadDeadline);
          }
          if (part.file.truncated) {
            throw {
              status: 413,
              message: sizeErrorMessage,
              fileIndex,
            };
          }

          if (isVideo) {
            try {
              const converted = await convertVideoToGif(buf);
              finalBuf = converted.buffer;
              finalMime = "image/gif";
              finalFileName = (part.filename || "video").replace(/\.[^.]+$/, ".gif");
            } catch (convErr) {
              if (convErr instanceof ConvertedVideoGifSizeError) {
                throw {
                  status: 413,
                  message: convertedVideoGifSizeErrorMessage,
                  fileIndex,
                };
              }
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
        } finally {
          if (uploadDeadline) {
            clearTimeout(uploadDeadline);
          }
          releaseConversion?.();
        }

        const sizeValidation = isVideo
          ? validateConvertedVideoGifSize(finalBuf.byteLength)
          : validateProcessedImageSize(finalBuf.byteLength, compression.maxSizeMb);
        if (!sizeValidation.ok) {
          throw {
            status: sizeValidation.status,
            message: sizeValidation.message,
            fileIndex,
          };
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

      if (staged.length + remoteGifClaims.length > 9) {
        throw {
          status: 400,
          message: "最多 9 个文件",
        };
      }
      const localAttachmentCount = staged.length;
      if (attachmentOrder && !isAttachmentOrderCompatible(
        attachmentOrder,
        localAttachmentCount,
        remoteGifClaims.length,
      )) {
        throw {
          status: 400,
          message: "附件顺序与文件数量不匹配",
        };
      }

      // Validate content before any remote GIF network work.
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

      const remoteGifUrls = remoteGifClaims.map((claim) => claim.url);
      const remoteGifSigningSecret = remoteGifClaims.length > 0
        ? getServerSigningSecret()
        : null;
      const invalidRemoteGifUrlIndexes = remoteGifUrls.flatMap((url, remoteGifIndex) => {
        const validation = validateRemoteGifUrls([url]);
        return validation.valid && isTrustedConvertedGifUrl(url) ? [] : [remoteGifIndex];
      });
      if (invalidRemoteGifUrlIndexes.length > 0) {
        throw {
          status: 400,
          message: "视频转换结果来源不受信任",
          remoteGifIndexes: invalidRemoteGifUrlIndexes,
        };
      }
      const invalidRemoteGifIndexes = remoteGifClaims.flatMap((claim, remoteGifIndex) => (
        validateConvertedGifClaim({
          url: claim.url,
          proof: claim.proof,
          tenantId: context.selectedTenant.id,
          userId: context.user.id,
          sessionTokenHash: context.session.tokenHash,
          signingSecret: remoteGifSigningSecret!,
        }) ? [] : [remoteGifIndex]
      ));
      if (invalidRemoteGifIndexes.length > 0) {
        throw {
          status: 403,
          message: "视频转换凭证无效或已过期，请重新转换",
          remoteGifIndexes: invalidRemoteGifIndexes,
        };
      }

      const releaseRemoteGifIngestion = remoteGifClaims.length > 0
        ? reserveVideoGifConversion(`${context.selectedTenant.id}:${context.user.id}`)
        : null;
      if (remoteGifClaims.length > 0 && !releaseRemoteGifIngestion) {
        throw {
          status: 429,
          message: "视频处理繁忙，请稍后重试",
        };
      }
      const remoteGifIngestionSignal = remoteGifClaims.length > 0
        ? AbortSignal.timeout(60_000)
        : null;

      try {
        if (remoteGifClaims.length > 0) {
          try {
            consumedConvertedGifClaimSettings = await convertedGifClaimStore.consume(
              remoteGifClaims.map((claim) => claim.proof),
            );
          } catch (error) {
            if (error instanceof ConvertedGifClaimUnavailableError) {
              throw {
                status: 403,
                message: "视频转换凭证已使用、重复或已失效，请重新转换",
                remoteGifIndexes: remoteGifClaims.map((_, index) => index),
              };
            }
            throw error;
          }
        }

        // Only server-issued converted-video claims receive the stable 50MB cap.
        for (const [remoteGifIndex, { url: gifUrl }] of remoteGifClaims.entries()) {
        try {
          const response = await fetch(gifUrl, {
            redirect: "manual",
            signal: remoteGifIngestionSignal,
          });
          if (response.status >= 300 && response.status < 400) {
            await response.body?.cancel().catch(() => undefined);
            throw {
              status: 400,
              message: "视频转换结果不允许重定向",
              remoteGifIndexes: [remoteGifIndex],
              permanentRemoteGifFailure: true,
            };
          }
          if (!response.ok) {
            await response.body?.cancel().catch(() => undefined);
            app.log.warn({ url: gifUrl, status: response.status }, "failed to fetch remote GIF");
            const permanentRemoteGifFailure = response.status >= 400
              && response.status < 500
              && ![408, 425, 429].includes(response.status);
            throw {
              status: permanentRemoteGifFailure ? 410 : 502,
              message: permanentRemoteGifFailure
                ? "视频转换结果已失效，请重新转换"
                : "视频转换结果下载失败，请重试",
              remoteGifIndexes: [remoteGifIndex],
              permanentRemoteGifFailure,
            };
          }
          if (response.url && !isTrustedConvertedGifUrl(response.url)) {
            await response.body?.cancel().catch(() => undefined);
            throw {
              status: 400,
              message: "视频转换结果来源不受信任",
              remoteGifIndexes: [remoteGifIndex],
              permanentRemoteGifFailure: true,
            };
          }
          let buf: Buffer;
          try {
            buf = await readResponseBufferWithLimit(response, imageStorageHardMaxBytes);
          } catch (error) {
            if (error instanceof ResponseBodyTooLargeError) {
              throw {
                status: 413,
                message: convertedVideoGifSizeErrorMessage,
                remoteGifIndexes: [remoteGifIndex],
                permanentRemoteGifFailure: true,
              };
            }
            throw error;
          }
          if (!hasGifSignature(buf)) {
            throw {
              status: 415,
              message: "视频转换结果不是有效的 GIF",
              remoteGifIndexes: [remoteGifIndex],
              permanentRemoteGifFailure: true,
            };
          }
          const sizeValidation = validateConvertedVideoGifSize(buf.byteLength);
          if (!sizeValidation.ok) {
            throw {
              status: sizeValidation.status,
              message: sizeValidation.message,
              remoteGifIndexes: [remoteGifIndex],
              permanentRemoteGifFailure: true,
            };
          }

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
          if (fetchErr && typeof fetchErr === "object" && "status" in fetchErr && "message" in fetchErr) {
            throw fetchErr;
          }
          app.log.warn({ error: fetchErr, url: gifUrl }, "failed to process remote GIF");
          throw {
            status: 502,
            message: "视频转换结果下载失败，请重试",
            remoteGifIndexes: [remoteGifIndex],
          };
        }
        }
      } finally {
        releaseRemoteGifIngestion?.();
      }

      if (attachmentOrder) {
        const localAttachments = staged.slice(0, localAttachmentCount);
        const remoteAttachments = staged.slice(localAttachmentCount);
        const ordered = restoreAttachmentOrder(localAttachments, remoteAttachments, attachmentOrder)!;
        staged.splice(0, staged.length, ...ordered);
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

              const created = await tx.post.create({
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
              return tx.post.findUniqueOrThrow({
                where: { id: created.id },
                include: {
                  tagAssignments: {
                    include: { tag: true },
                    orderBy: { createdAt: "asc" },
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

      // Post creation commits one-time converted-GIF claim consumption.
      consumedConvertedGifClaimSettings = [];

      oneBot?.notifyNewPost(post.id).catch((error) => {
        app.log.warn({ error, postId: post.id }, "failed to notify review group");
      });
      autoTagPost({
        tenantId: context.selectedTenant.id,
        postId: post.id,
        logger: request.log,
      }).catch((error) => {
        app.log.warn({ error, postId: post.id }, "failed to auto-tag post");
      });

      return {
        post: toPostListItem(post),
      };
    } catch (err) {
      let convertedGifClaimRestoreFailed = false;
      let convertedGifClaimsRestored = false;
      if (consumedConvertedGifClaimSettings.length > 0) {
        try {
          await convertedGifClaimStore.restore(consumedConvertedGifClaimSettings);
          consumedConvertedGifClaimSettings = [];
          convertedGifClaimsRestored = true;
        } catch (restoreErr) {
          convertedGifClaimRestoreFailed = true;
          app.log.error({ error: restoreErr }, "failed to restore converted GIF claims");
        }
      }

      // Cleanup uploaded files on error
      await deleteAttachmentObjects(config, uploadedKeys).catch((cleanupErr) => {
        app.log.warn({ error: cleanupErr }, "failed to cleanup uploaded attachments");
      });

      if (convertedGifClaimRestoreFailed) {
        return reply.code(503).send({
          message: "视频处理失败且转换凭证无法恢复，请移除视频后重新添加",
          remoteGifIndexes: remoteGifClaims.map((_, index) => index),
        });
      }

      // Handle errors
      if (isMultipartLimitError(err)) {
        return reply.code(413).send({ message: "投稿附件或字段超过限制" });
      }

      if (err instanceof PendingPostLimitError) {
        return reply.code(409).send({
          message: `你还有 ${err.pendingCount} 条稿件待审核，当前校园墙最多同时保留 ${err.limit} 条待审核稿件。`,
        });
      }

      if (typeof err === "object" && err !== null && "status" in err && "message" in err) {
        const errorObj = err as {
          status: number;
          message: string;
          fileIndex?: number;
          remoteGifIndexes?: number[];
          permanentRemoteGifFailure?: boolean;
        };
        return reply.code(errorObj.status).send({
          message: errorObj.message,
          ...(errorObj.fileIndex !== undefined ? { fileIndex: errorObj.fileIndex } : {}),
          ...(errorObj.remoteGifIndexes
            && shouldExposeRemoteGifIndexes(
              convertedGifClaimsRestored,
              errorObj.permanentRemoteGifFailure,
            )
            ? { remoteGifIndexes: errorObj.remoteGifIndexes }
            : {}),
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
    sizeErrorMessage: string,
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
          message: sizeErrorMessage,
          fileIndex,
        };
      }
      throw error;
    }
  }


  app.get("/api/posts/mine", async (request, reply) => {
    const context = await requireTenantContext(request, reply);
    const query = listQuerySchema.parse(request.query);
    const where: Record<string, unknown> = {
      tenantId: context.selectedTenant.id,
      authorId: context.user.id,
    };
    const keyword = query.q?.trim();
    if (keyword) {
      const displayId = /^\d+$/.test(keyword) ? Number.parseInt(keyword, 10) : null;
      where.OR = [
        { text: { contains: keyword } },
        ...(displayId !== null ? [{ displayId }] : []),
      ];
    }
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
          tagAssignments: {
            include: {
              tag: true,
            },
            orderBy: {
              createdAt: "asc",
            },
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
    const query = publishedListQuerySchema.parse(request.query);
    const tenantId = context.selectedTenant.id;
    const viewerIsReviewer = hasTenantRole(context.selectedMembership.role, "reviewer");
    const keyword = query.q?.trim();

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

    // Build keyword filter for Prisma queries
    let keywordSingleFilter: Record<string, unknown> = {};
    let keywordBatchFilter: Record<string, unknown> = {};
    if (keyword) {
      const displayIdFilter = /^\d+$/.test(keyword) ? Number.parseInt(keyword, 10) : null;
      const orClauses: Record<string, unknown>[] = [{ text: { contains: keyword } }];
      if (displayIdFilter !== null) {
        orClauses.push({ displayId: displayIdFilter });
      }
      keywordSingleFilter = { OR: orClauses };
      keywordBatchFilter = {
        items: {
          some: {
            post: {
              OR: orClauses,
            },
          },
        },
      };
    }

    const [singlePosts, batches] = await Promise.all([
      // A) 独立发布稿件：已发布且不属于任何批次
      prisma.post.findMany({
        where: {
          tenantId,
          status: "published",
          batchItem: { is: null },
          ...keywordSingleFilter,
        },
        include: {
          author: authorSelect,
          tagAssignments: {
            include: { tag: true },
            orderBy: { createdAt: "asc" },
          },
          qzonePostMetrics: metricInclude,
        },
        orderBy: { updatedAt: "desc" },
      }),
      // B) 已发布批次（批量）
      prisma.publishBatch.findMany({
        where: {
          tenantId,
          status: "published",
          ...(keyword ? keywordBatchFilter : {}),
        },
        include: {
          items: {
            orderBy: { position: "asc" },
            include: {
              post: {
                include: {
                  author: authorSelect,
                  tagAssignments: {
                    include: { tag: true },
                    orderBy: { createdAt: "asc" },
                  },
                },
              },
            },
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
      tagAssignments?: Parameters<typeof serializeAssignedPostTags>[0];
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
      tags: serializeAssignedPostTags(post.tagAssignments),
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

    let allItems = filterPublishedFeedByTag(
      buildPublishedFeed({ singles, batches: batchInputs, viewerIsReviewer }),
      query.tag,
    );

    // 按关键词过滤已发布稿件（匹配正文内容或稿件编号）
    if (keyword) {
      const keywordLower = keyword.toLowerCase();
      const displayIdFilter = /^\d+$/.test(keyword) ? Number.parseInt(keyword, 10) : null;
      allItems = allItems.filter((item) => {
        for (const post of item.posts) {
          if (displayIdFilter !== null && post.displayId === displayIdFilter) {
            return true;
          }
          if (post.text.toLowerCase().includes(keywordLower)) {
            return true;
          }
        }
        return false;
      });
    }

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
        tagAssignments: {
          include: { tag: true },
          orderBy: { createdAt: "asc" },
        },
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
      tags: serializeAssignedPostTags(post.tagAssignments).map((tag) => ({ name: tag.name, color: tag.color })),
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
