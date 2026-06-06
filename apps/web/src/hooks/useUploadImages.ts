import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { PendingAttachment } from "@/types/app";
import { uploadVideoToGif, ScdnApiError, SCDN_MAX_VIDEO_SIZE } from "@/lib/scdn-api";

const MAX_IMAGE_SIZE = 10 * 1024 * 1024;

type ConversionJob = {
  attachmentId: string;
  file: File;
};

export function usePendingAttachments() {
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const blobUrlsRef = useRef<string[]>([]);
  const conversionQueueRef = useRef<ConversionJob[]>([]);
  const convertingRef = useRef(false);

  useEffect(() => {
    return () => {
      for (const url of blobUrlsRef.current) {
        URL.revokeObjectURL(url);
      }
      blobUrlsRef.current = [];
    };
  }, []);

  /** Process the next video conversion job in the queue */
  const processNextConversion = useCallback(async () => {
    if (convertingRef.current || conversionQueueRef.current.length === 0) {
      return;
    }
    convertingRef.current = true;

    const job = conversionQueueRef.current.shift()!;
    const { attachmentId, file } = job;

    try {
      // Update status to "converting"
      setPending((current) =>
        current.map((p) =>
          p.id === attachmentId ? { ...p, status: "converting" as const, progress: 0 } : p,
        ),
      );

      // Step 1: Upload video to 失控图床 API → get GIF URL
      const uploadData = await uploadVideoToGif(file, (percent) => {
        setPending((current) =>
          current.map((p) =>
            p.id === attachmentId ? { ...p, progress: percent } : p,
          ),
        );
      });

      // Step 2: Keep the GIF URL — the backend will download it from the CDN
      // (browser fetch is blocked by CORS on the CloudFlare CN CDN domain)
      const gifBlobUrl = uploadData.url;

      // Create a placeholder file so the attachment is trackable
      const gifFile = new File([""], file.name.replace(/\.[^.]+$/, ".gif"), {
        type: "image/gif",
      });

      // Replace the attachment with the GIF version (remote URL based)
      setPending((current) =>
        current.map((p) =>
          p.id === attachmentId
            ? {
                ...p,
                file: gifFile,
                blobUrl: gifBlobUrl,
                status: "ready" as const,
                progress: 100,
                originalVideo: file,
                remoteGifUrl: uploadData.url,
              }
            : p,
        ),
      );
    } catch (error) {
      const message =
        error instanceof ScdnApiError
          ? error.message
          : "视频转换失败";
      toast.error(`视频转换失败：${message}`);
      // Mark as failed so user can remove it
      setPending((current) =>
        current.map((p) =>
          p.id === attachmentId
            ? { ...p, status: "failed" as const, errorMessage: message, progress: 0 }
            : p,
        ),
      );
    } finally {
      convertingRef.current = false;
      // Process next job in queue
      processNextConversion();
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
            toast.error(`${file.name || "视频"} 超过 15MB 限制（失控图床限制）`);
            continue;
          }
          if (!isVideo && file.size > MAX_IMAGE_SIZE) {
            toast.error(`${file.name || "图片"} 超过 10MB 限制`);
            continue;
          }

          const id = crypto.randomUUID();
          const blobUrl = URL.createObjectURL(file);
          blobUrlsRef.current.push(blobUrl);

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
    [processNextConversion],
  );

  const remove = useCallback((id: string) => {
    setPending((current) => {
      const item = current.find((p) => p.id === id);
      if (item) {
        URL.revokeObjectURL(item.blobUrl);
        blobUrlsRef.current = blobUrlsRef.current.filter(
          (url) => url !== item.blobUrl,
        );
      }
      return current.filter((p) => p.id !== id);
    });
    // Also remove from conversion queue if pending
    conversionQueueRef.current = conversionQueueRef.current.filter(
      (job) => job.attachmentId !== id,
    );
  }, []);

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
    (fileIndex: number | undefined, message: string) => {
      setPending((current) =>
        current.map((p, index) => {
          if (fileIndex !== undefined && index === fileIndex) {
            return { ...p, status: "failed" as const, errorMessage: message };
          }
          if (p.status === "uploading") {
            return { ...p, status: "ready" as const, progress: 0 };
          }
          return p;
        }),
      );
    },
    [],
  );

  const clearAll = useCallback(() => {
    setPending((current) => {
      for (const item of current) {
        URL.revokeObjectURL(item.blobUrl);
      }
      blobUrlsRef.current = [];
      return [];
    });
    conversionQueueRef.current = [];
  }, []);

  return {
    pending,
    add,
    remove,
    markUploading,
    setProgress,
    markFailed,
    clearAll,
  };
}
