import type { PendingAttachment } from "@/types/app";

export function applyAttachmentUploadFailure(
  attachments: PendingAttachment[],
  fileIndex: number | undefined,
  remoteGifIndexes: number[] | undefined,
  message: string,
): PendingAttachment[] {
  const failedRemoteIndexes = new Set(remoteGifIndexes ?? []);
  let localIndex = 0;
  let remoteIndex = 0;

  return attachments.map((attachment) => {
    const isRemoteGif = Boolean(attachment.remoteGifUrl);
    const isFailedAttachment = isRemoteGif
      ? failedRemoteIndexes.has(remoteIndex++)
      : fileIndex !== undefined && localIndex++ === fileIndex;
    if (isFailedAttachment) {
      return {
        ...attachment,
        status: "failed",
        errorMessage: message,
        progress: 0,
      };
    }
    if (attachment.status === "uploading") {
      return { ...attachment, status: "ready", progress: 0 };
    }
    return attachment;
  });
}
