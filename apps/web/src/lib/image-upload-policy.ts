import { IMAGE_UPLOAD_SOURCE_HARD_MAX_SIZE_MB, normalizeImageMaxSizeMb } from "@campux/domain";

const bytesPerMegabyte = 1024 * 1024;
export const imageUploadSourceHardMaxSizeMb = IMAGE_UPLOAD_SOURCE_HARD_MAX_SIZE_MB;

export function normalizeImageMaxSizeDraft(draft: string, fallback: number): number {
  const parsed = Number(draft);
  return draft.trim() === "" || !Number.isFinite(parsed)
    ? normalizeImageMaxSizeMb(fallback)
    : normalizeImageMaxSizeMb(parsed);
}

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

export function getSelectedImageRejections({
  images,
  maxSizeMb,
  compressionEnabled,
}: {
  images: Array<{ id: string; fileName: string; sizeBytes: number }>;
  maxSizeMb: number;
  compressionEnabled: boolean;
}): Array<{ id: string; message: string }> {
  return images.flatMap((image) => {
    const message = getSelectedImageRejection({
      fileName: image.fileName,
      sizeBytes: image.sizeBytes,
      maxSizeMb,
      compressionEnabled,
    });
    return message ? [{ id: image.id, message }] : [];
  });
}
