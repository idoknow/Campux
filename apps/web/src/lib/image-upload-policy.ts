import { IMAGE_UPLOAD_SOURCE_HARD_MAX_SIZE_MB } from "@campux/domain";

const bytesPerMegabyte = 1024 * 1024;
export const imageUploadSourceHardMaxSizeMb = IMAGE_UPLOAD_SOURCE_HARD_MAX_SIZE_MB;

export function getSelectedImageRejection({
  fileName,
  sizeBytes,
  maxSizeMb,
  compressionEnabled,
}: {
  fileName: string;
  sizeBytes: number;
  maxSizeMb: number;
  compressionEnabled: boolean;
}): string | null {
  const displayName = fileName || "图片";
  if (compressionEnabled) {
    if (sizeBytes > imageUploadSourceHardMaxSizeMb * bytesPerMegabyte) {
      return `${displayName} 原图超过 ${imageUploadSourceHardMaxSizeMb}MB，无法自动压缩`;
    }
    return null;
  }

  if (sizeBytes > maxSizeMb * bytesPerMegabyte) {
    return `${displayName} 超过 ${maxSizeMb}MB 限制`;
  }
  return null;
}
