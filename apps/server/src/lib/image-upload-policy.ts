import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  DEFAULT_IMAGE_MAX_SIZE_MB,
  IMAGE_UPLOAD_SOURCE_HARD_MAX_SIZE_MB,
  MAX_IMAGE_MAX_SIZE_MB,
  MIN_IMAGE_MAX_SIZE_MB,
  normalizeImageMaxSizeMb,
} from "@campux/domain";

const bytesPerMegabyte = 1024 * 1024;

export const defaultImageMaxSizeMb = DEFAULT_IMAGE_MAX_SIZE_MB;
export const minImageMaxSizeMb = MIN_IMAGE_MAX_SIZE_MB;
export const maxImageMaxSizeMb = MAX_IMAGE_MAX_SIZE_MB;
export const imageUploadSourceHardMaxSizeMb = IMAGE_UPLOAD_SOURCE_HARD_MAX_SIZE_MB;
export const imageStorageHardMaxBytes = imageUploadSourceHardMaxSizeMb * bytesPerMegabyte;
export const trustedConvertedGifHostname = "cloudflarecnimg.scdn.io";
export const convertedGifClaimTtlMs = 15 * 60 * 1000;
export { normalizeImageMaxSizeMb };

/**
 * 允许作为稿件图片提交的 MIME。
 * SVG 是文档而不是位图（可直接执行脚本），因此不在允许列表里。
 */
export const postImageMimeTypes: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/bmp",
  "image/tiff",
]);

export function isAllowedPostImageMime(contentType: string): boolean {
  return postImageMimeTypes.has(contentType);
}

/**
 * 按魔术字节识别真正可安全内联的位图。
 * 回放时不信任存储里的 Content-Type（OneBot 会把远端 image/* 原样存下来，
 * 历史附件也可能没有 contentType），只有字节确实是位图才内联。
 */
export function detectRasterImageMime(bytes: Uint8Array): string | null {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  const matches = (signature: readonly number[], offset = 0) => signature.every((byte, index) => bytes[offset + index] === byte);

  if (bytes.length >= 3 && matches([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (bytes.length >= 8 && matches([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (bytes.length >= 6 && (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a")) return "image/gif";
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (bytes.length >= 2 && ascii(0, 2) === "BM") return "image/bmp";
  if (bytes.length >= 4 && (matches([0x49, 0x49, 0x2a, 0x00]) || matches([0x4d, 0x4d, 0x00, 0x2a]))) return "image/tiff";
  if (bytes.length >= 12 && ascii(4, 8) === "ftyp") {
    const brand = ascii(8, 12);
    if (["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1"].includes(brand)) {
      return "image/heic";
    }
    if (brand === "avif" || brand === "avis") return "image/avif";
  }
  return null;
}

export type AttachmentOrderKind = "local" | "remote";

export function isAttachmentOrderCompatible(
  order: AttachmentOrderKind[],
  localCount: number,
  remoteCount: number,
): boolean {
  const localOrderCount = order.filter((kind) => kind === "local").length;
  return order.length === localCount + remoteCount
    && localOrderCount === localCount
    && order.length - localOrderCount === remoteCount;
}

export function restoreAttachmentOrder<T>(
  localAttachments: T[],
  remoteAttachments: T[],
  order: AttachmentOrderKind[],
): T[] | null {
  if (!isAttachmentOrderCompatible(order, localAttachments.length, remoteAttachments.length)) {
    return null;
  }
  let localIndex = 0;
  let remoteIndex = 0;
  return order.map((kind) => (
    kind === "local"
      ? localAttachments[localIndex++]!
      : remoteAttachments[remoteIndex++]!
  ));
}

function convertedGifClaimSignature({
  url,
  tenantId,
  userId,
  expiresAt,
  nonce,
  sessionTokenHash,
  signingSecret,
}: {
  url: string;
  tenantId: string;
  userId: string;
  expiresAt: number;
  nonce: string;
  sessionTokenHash: string;
  signingSecret: string;
}): Buffer {
  const payload = JSON.stringify([url, tenantId, userId, sessionTokenHash, expiresAt, nonce]);
  return createHmac("sha256", signingSecret)
    .update("campux:converted-gif-claim:v1\n")
    .update(payload)
    .digest();
}

export function createConvertedGifClaim({
  url,
  tenantId,
  userId,
  sessionTokenHash,
  signingSecret,
  now = Date.now(),
  nonce,
}: {
  url: string;
  tenantId: string;
  userId: string;
  sessionTokenHash: string;
  signingSecret: string;
  now?: number;
  nonce?: string;
}): string {
  const expiresAt = now + convertedGifClaimTtlMs;
  const claimNonce = nonce ?? randomBytes(16).toString("base64url");
  const signature = convertedGifClaimSignature({
    url,
    tenantId,
    userId,
    expiresAt,
    nonce: claimNonce,
    sessionTokenHash,
    signingSecret,
  });
  return `${expiresAt}.${claimNonce}.${signature.toString("base64url")}`;
}

export function validateConvertedGifClaim({
  url,
  proof,
  tenantId,
  userId,
  sessionTokenHash,
  signingSecret,
  now = Date.now(),
}: {
  url: string;
  proof: string;
  tenantId: string;
  userId: string;
  sessionTokenHash: string;
  signingSecret: string;
  now?: number;
}): boolean {
  const match = /^(\d+)\.([A-Za-z0-9_-]{16,64})\.([A-Za-z0-9_-]+)$/.exec(proof);
  if (!match) {
    return false;
  }
  const expiresAt = Number(match[1]);
  const nonce = match[2]!;
  if (!Number.isSafeInteger(expiresAt)
    || expiresAt < now
    || expiresAt - now > convertedGifClaimTtlMs) {
    return false;
  }
  const supplied = Buffer.from(match[3]!, "base64url");
  const expected = convertedGifClaimSignature({
    url,
    tenantId,
    userId,
    expiresAt,
    nonce,
    sessionTokenHash,
    signingSecret,
  });
  return supplied.byteLength === expected.byteLength && timingSafeEqual(supplied, expected);
}

export function shouldExposeRemoteGifIndexes(
  permanentRemoteGifFailure: boolean | undefined,
): boolean {
  return permanentRemoteGifFailure === true;
}

export function isTrustedConvertedGifUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return url.protocol === "https:"
      && url.hostname === trustedConvertedGifHostname
      && url.port === ""
      && url.username === ""
      && url.password === "";
  } catch {
    return false;
  }
}

export function hasGifSignature(buffer: Uint8Array): boolean {
  if (buffer.byteLength < 6) {
    return false;
  }
  const signature = Buffer.from(buffer.buffer, buffer.byteOffset, 6).toString("ascii");
  return signature === "GIF87a" || signature === "GIF89a";
}

export function buildVideoGifFfmpegArgs(inputPath: string, outputPath: string): string[] {
  const filter = "fps=fps='min(30,source_fps)',scale=w='min(1920,iw)':h='min(1920,ih)':force_original_aspect_ratio=decrease,split[s0][s1];[s0]palettegen=stats_mode=full:max_colors=256[p];[s1][p]paletteuse=dither=floyd_steinberg";
  return [
    "-y", "-i", inputPath,
    "-vf", filter,
    "-threads", "1",
    "-loop", "0",
    "-fs", String(imageStorageHardMaxBytes),
    outputPath,
  ];
}

export function buildImageSourceSizeErrorMessage({
  compressionEnabled,
  maxSizeMb,
}: {
  compressionEnabled: boolean;
  maxSizeMb: unknown;
}): string {
  if (compressionEnabled) {
    return `图片原图不能超过 ${imageUploadSourceHardMaxSizeMb}MB，无法自动压缩`;
  }
  return `图片不能超过 ${normalizeImageMaxSizeMb(maxSizeMb)}MB`;
}

export function resolveImageUploadLimits({
  maxSizeMb,
  compressionEnabled,
}: {
  maxSizeMb: unknown;
  compressionEnabled: boolean;
}) {
  const normalizedMaxSizeMb = normalizeImageMaxSizeMb(maxSizeMb);
  return {
    sourceMaxBytes: (compressionEnabled ? imageUploadSourceHardMaxSizeMb : normalizedMaxSizeMb) * bytesPerMegabyte,
    processedMaxBytes: normalizedMaxSizeMb * bytesPerMegabyte,
  };
}

export const convertedVideoGifSizeErrorMessage = `视频转换后的 GIF 不能超过 ${imageUploadSourceHardMaxSizeMb}MB`;

export function validateConvertedVideoGifSize(sizeBytes: number):
  | { ok: true }
  | { ok: false; status: 413; message: string } {
  if (sizeBytes <= imageStorageHardMaxBytes) {
    return { ok: true };
  }
  return {
    ok: false,
    status: 413,
    message: convertedVideoGifSizeErrorMessage,
  };
}

export class ResponseBodyTooLargeError extends Error {
  constructor(public readonly maxBytes: number) {
    super(`response body exceeds ${maxBytes} bytes`);
    this.name = "ResponseBodyTooLargeError";
  }
}

export async function readResponseBufferWithLimit(response: Response, maxBytes: number): Promise<Buffer> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new TypeError("maxBytes must be a non-negative safe integer");
  }

  const contentLength = response.headers.get("content-length")?.trim();
  const declaredLength = contentLength && /^\d+$/.test(contentLength)
    ? Number(contentLength)
    : null;
  if (contentLength && /^\d+$/.test(contentLength) && BigInt(contentLength) > BigInt(maxBytes)) {
    await response.body?.cancel().catch(() => undefined);
    throw new ResponseBodyTooLargeError(maxBytes);
  }

  if (!response.body) {
    return Buffer.alloc(0);
  }

  const initialCapacity = declaredLength !== null
    ? declaredLength
    : Math.min(maxBytes, 64 * 1024);
  let output = Buffer.allocUnsafe(initialCapacity);
  let totalBytes = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      const nextTotal = totalBytes + value.byteLength;
      if (nextTotal > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new ResponseBodyTooLargeError(maxBytes);
      }
      if (nextTotal > output.byteLength) {
        const nextCapacity = Math.min(
          maxBytes,
          Math.max(nextTotal, Math.max(64 * 1024, output.byteLength * 2)),
        );
        const grown = Buffer.allocUnsafe(nextCapacity);
        output.copy(grown, 0, 0, totalBytes);
        output = grown;
      }
      Buffer.from(value.buffer, value.byteOffset, value.byteLength).copy(output, totalBytes);
      totalBytes = nextTotal;
    }
  } finally {
    reader.releaseLock();
  }

  return output.subarray(0, totalBytes);
}

export function validateProcessedImageSize(sizeBytes: number, maxSizeMb: unknown):
  | { ok: true }
  | { ok: false; status: 413; message: string } {
  const normalizedMaxSizeMb = normalizeImageMaxSizeMb(maxSizeMb);
  if (sizeBytes <= normalizedMaxSizeMb * bytesPerMegabyte) {
    return { ok: true };
  }
  return {
    ok: false,
    status: 413,
    message: `图片处理后仍超过 ${normalizedMaxSizeMb}MB 限制`,
  };
}
