import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { PendingAttachment } from "@/types/app";
import { uploadVideoToGif, ScdnApiError, SCDN_MAX_VIDEO_SIZE } from "@/lib/scdn-api";
import { getSelectedImageRejection, getSelectedImageRejections } from "@/lib/image-upload-policy";
import { applyAttachmentUploadFailure } from "@/lib/attachment-upload-state";

type ConversionJob = {
  attachmentId: string;
  file: File;
};

type ActiveConversion = {
  attachmentId: string;
  controller: AbortController;
};

export function usePendingAttachments({
  maxSizeMb,
  compressionEnabled,
}: {
  maxSizeMb: number;
  compressionEnabled: boolean;
}) {
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const ownedBlobUrlsRef = useRef(new Map<string, string>());
  const conversionQueueRef = useRef<ConversionJob[]>([]);
  const activeConversionRef = useRef<ActiveConversion | null>(null);
  const convertingRef = useRef(false);
  const unmountedRef = useRef(false);

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      activeConversionRef.current?.controller.abort();
      activeConversionRef.current = null;
      conversionQueueRef.current = [];
      for (const url of ownedBlobUrlsRef.current.values()) {
        URL.revokeObjectURL(url);
      }
      ownedBlobUrlsRef.current.clear();
    };
  }, []);

  /** Process the next video conversion job in the queue */
  const processNextConversion = useCallback(async () => {
    if (unmountedRef.current
      || convertingRef.current
      || conversionQueueRef.current.length === 0) {
      return;
    }
    convertingRef.current = true;

    const job = conversionQueueRef.current.shift()!;
    const { attachmentId, file } = job;
    const controller = new AbortController();
    activeConversionRef.current = { attachmentId, controller };

    try {
      setPending((current) =>
        current.map((p) =>
          p.id === attachmentId ? { ...p, status: "converting" as const, progress: 0 } : p,
        ),
      );

      const uploadData = await uploadVideoToGif(file, (percent) => {
        if (controller.signal.aborted || unmountedRef.current) return;
        setPending((current) =>
          current.map((p) =>
            p.id === attachmentId ? { ...p, progress: percent } : p,
          ),
        );
      }, controller.signal);

      if (controller.signal.aborted || unmountedRef.current) return;

      const gifFile = new File([""], file.name.replace(/\.[^.]+$/, ".gif"), {
        type: "image/gif",
      });
      const ownedBlobUrl = ownedBlobUrlsRef.current.get(attachmentId);
      if (ownedBlobUrl) {
        URL.revokeObjectURL(ownedBlobUrl);
        ownedBlobUrlsRef.current.delete(attachmentId);
      }

      setPending((current) =>
        current.map((p) =>
          p.id === attachmentId
            ? {
                ...p,
                file: gifFile,
                blobUrl: uploadData.url,
                status: "ready" as const,
                progress: 100,
                originalVideo: file,
                remoteGifUrl: uploadData.url,
                remoteGifProof: uploadData.proof,
              }
            : p,
        ),
      );
    } catch (error) {
      if (controller.signal.aborted || unmountedRef.current) return;
      const message = error instanceof ScdnApiError ? error.message : "视频转换失败";
      toast.error(`视频转换失败：${message}`);
      setPending((current) =>
        current.map((p) =>
          p.id === attachmentId
            ? { ...p, status: "failed" as const, errorMessage: message, progress: 0 }
            : p,
        ),
      );
    } finally {
      if (activeConversionRef.current?.attachmentId === attachmentId) {
        activeConversionRef.current = null;
      }
      convertingRef.current = false;
      if (!unmountedRef.current) {
        processNextConversion();
      }
    }
  }, []);

  const add = useCallback(
    (files: ArrayLike<File> | null) => {
      if (!files?.length) {
        return;
      }
      setPending((current) => {
        const remaining = Math.max(9 - current.length, 0);
        const candidates = Array.from(files).slice(0, remaining);
        if (Array.from(files).length > remaining) {
          toast.error("最多只能添加 9 个文件");
        }

        const accepted: PendingAttachment[] = [];
        const videoJobs: ConversionJob[] = [];
        const baseSort =
          current.length > 0
            ? Math.max(...current.map((p) => p.sortOrder)) + 1
            : 0;
        let nextIndex = 0;
        for (const file of candidates) {
          const isVideo = file.type.startsWith("video/");
          if (!file.type.startsWith("image/") && !isVideo) {
            toast.error(`${file.name || "文件"} 不是图片或视频格式`);
            continue;
          }
          if (isVideo && file.size > SCDN_MAX_VIDEO_SIZE) {
            toast.error(`${file.name || "视频"} 超过 15MB 限制`);
            continue;
          }
          if (!isVideo) {
            const rejection = getSelectedImageRejection({
              fileName: file.name,
              sizeBytes: file.size,
              maxSizeMb,
              compressionEnabled,
            });
            if (rejection) {
              toast.error(rejection);
              continue;
            }
          }

          const id = crypto.randomUUID();
          const blobUrl = URL.createObjectURL(file);
          ownedBlobUrlsRef.current.set(id, blobUrl);

          accepted.push({
            id,
            file,
            blobUrl,
            kind: "image",
            sortOrder: baseSort + nextIndex,
            progress: 0,
            status: isVideo ? "converting" : "ready",
            originalVideo: isVideo ? file : undefined,
          });

          if (isVideo) {
            videoJobs.push({ attachmentId: id, file });
          }

          nextIndex += 1;
        }

        // Schedule video conversions after state update
        if (videoJobs.length > 0) {
          conversionQueueRef.current.push(...videoJobs);
          // Use setTimeout to defer processing to after state update
          setTimeout(() => processNextConversion(), 0);
        }

        return [...current, ...accepted];
      });
    },
    [compressionEnabled, maxSizeMb, processNextConversion],
  );

  const remove = useCallback((id: string) => {
    if (activeConversionRef.current?.attachmentId === id) {
      activeConversionRef.current.controller.abort();
    }
    const ownedBlobUrl = ownedBlobUrlsRef.current.get(id);
    if (ownedBlobUrl) {
      URL.revokeObjectURL(ownedBlobUrl);
      ownedBlobUrlsRef.current.delete(id);
    }
    conversionQueueRef.current = conversionQueueRef.current.filter(
      (job) => job.attachmentId !== id,
    );
    setPending((current) => current.filter((p) => p.id !== id));
  }, []);

  const validateBeforeUpload = useCallback(() => {
    const missingClaims = pending.filter((item) =>
      item.status === "ready" && item.remoteGifUrl && !item.remoteGifProof);
    if (missingClaims.length > 0) {
      const missingIds = new Set(missingClaims.map((item) => item.id));
      const message = "视频转换凭证缺失，请移除后重新添加";
      setPending((current) => current.map((item) => missingIds.has(item.id)
        ? { ...item, status: "failed" as const, errorMessage: message, progress: 0 }
        : item));
      toast.error(message);
      return false;
    }

    const rejected = getSelectedImageRejections({
      images: pending
        .filter((item) => item.status === "ready" && !item.originalVideo && !item.remoteGifUrl)
        .map((item) => ({
          id: item.id,
          fileName: item.file.name,
          sizeBytes: item.file.size,
        })),
      maxSizeMb,
      compressionEnabled,
    });
    if (rejected.length === 0) {
      return true;
    }

    const errorsById = new Map(rejected.map((item) => [item.id, item.message]));
    setPending((current) => current.map((item) => {
      const message = errorsById.get(item.id);
      return message
        ? { ...item, status: "failed" as const, errorMessage: message, progress: 0 }
        : item;
    }));
    toast.error(rejected.length === 1
      ? rejected[0]!.message
      : `${rejected.length} 张图片不符合当前上传限制`);
    return false;
  }, [compressionEnabled, maxSizeMb, pending]);

  const markUploading = useCallback(() => {
    setPending((current) =>
      current.map((p) => ({
        ...p,
        status: "uploading" as const,
        progress: 0,
      })),
    );
  }, []);

  const setProgress = useCallback((totalPercent: number) => {
    setPending((current) =>
      current.map((p) =>
        p.status === "uploading" ? { ...p, progress: totalPercent } : p,
      ),
    );
  }, []);

  const markFailed = useCallback(
    (fileIndex: number | undefined, remoteGifIndexes: number[] | undefined, message: string) => {
      setPending((current) => applyAttachmentUploadFailure(
        current,
        fileIndex,
        remoteGifIndexes,
        message,
      ));
    },
    [],
  );

  const clearAll = useCallback(() => {
    activeConversionRef.current?.controller.abort();
    activeConversionRef.current = null;
    conversionQueueRef.current = [];
    for (const url of ownedBlobUrlsRef.current.values()) {
      URL.revokeObjectURL(url);
    }
    ownedBlobUrlsRef.current.clear();
    setPending([]);
  }, []);

  return {
    pending,
    add,
    remove,
    validateBeforeUpload,
    markUploading,
    setProgress,
    markFailed,
    clearAll,
  };
}
