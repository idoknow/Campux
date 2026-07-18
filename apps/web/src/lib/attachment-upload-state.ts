import type { PendingAttachment } from "@/types/app";

export function canAcceptAttachmentSelection(busy: boolean, fileCount: number): boolean {
  return !busy && fileCount > 0;
}

export function runWhenSubmissionIdle(busy: boolean, mutation: () => void): boolean {
  if (busy) return false;
  mutation();
  return true;
}

export function removeAttachmentsById(
  attachments: PendingAttachment[],
  attachmentIds: ReadonlySet<string>,
): PendingAttachment[] {
  return attachments.filter((attachment) => !attachmentIds.has(attachment.id));
}

export function markAttachmentsUploading(
  attachments: PendingAttachment[],
  attachmentIds: ReadonlySet<string>,
): PendingAttachment[] {
  return attachments.map((attachment) => attachmentIds.has(attachment.id)
    ? { ...attachment, status: "uploading" as const, progress: 0 }
    : attachment);
}

export function applyAttachmentUploadFailure(
  attachments: PendingAttachment[],
  fileIndex: number | undefined,
  remoteGifIndexes: number[] | undefined,
  message: string,
  submissionAttachments: PendingAttachment[] = attachments,
): PendingAttachment[] {
  const failedRemoteIndexes = new Set(remoteGifIndexes ?? []);
  const failedAttachmentIds = new Set<string>();
  const submissionAttachmentIds = new Set(submissionAttachments.map(({ id }) => id));
  let localIndex = 0;
  let remoteIndex = 0;

  for (const attachment of submissionAttachments) {
    const isRemoteGif = Boolean(attachment.remoteGifUrl);
    const isFailedAttachment = isRemoteGif
      ? failedRemoteIndexes.has(remoteIndex++)
      : fileIndex !== undefined && localIndex++ === fileIndex;
    if (isFailedAttachment) {
      failedAttachmentIds.add(attachment.id);
    }
  }

  return attachments.map((attachment) => {
    if (failedAttachmentIds.has(attachment.id)) {
      return {
        ...attachment,
        status: "failed",
        errorMessage: message,
        progress: 0,
      };
    }
    if (submissionAttachmentIds.has(attachment.id) && attachment.status === "uploading") {
      return { ...attachment, status: "ready", progress: 0 };
    }
    return attachment;
  });
}

type ActiveConversionLike = {
  attachmentId: string;
  controller: { abort: () => void };
};

type ConversionJobLike = {
  attachmentId: string;
};

export function cleanupAttachmentLifecycle<
  Active extends ActiveConversionLike,
  Job extends ConversionJobLike,
>({
  activeConversion,
  conversionQueue,
  ownedBlobUrls,
  attachmentIds,
  revokeObjectUrl,
}: {
  activeConversion: Active | null;
  conversionQueue: Job[];
  ownedBlobUrls: Map<string, string>;
  attachmentIds: ReadonlySet<string> | undefined;
  revokeObjectUrl: (url: string) => void;
}): {
  activeConversion: Active | null;
  conversionQueue: Job[];
} {
  const shouldCleanup = (attachmentId: string) => !attachmentIds || attachmentIds.has(attachmentId);
  let nextActiveConversion = activeConversion;

  if (activeConversion && shouldCleanup(activeConversion.attachmentId)) {
    activeConversion.controller.abort();
    nextActiveConversion = null;
  }

  const nextConversionQueue = conversionQueue.filter(
    (job) => !shouldCleanup(job.attachmentId),
  );
  for (const [attachmentId, url] of ownedBlobUrls) {
    if (!shouldCleanup(attachmentId)) continue;
    revokeObjectUrl(url);
    ownedBlobUrls.delete(attachmentId);
  }

  return {
    activeConversion: nextActiveConversion,
    conversionQueue: nextConversionQueue,
  };
}
