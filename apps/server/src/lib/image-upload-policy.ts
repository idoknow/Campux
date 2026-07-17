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
export { normalizeImageMaxSizeMb };

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
