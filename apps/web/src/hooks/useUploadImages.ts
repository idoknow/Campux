import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { PendingAttachment } from "@/types/app";

const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const MAX_VIDEO_SIZE = 500 * 1024 * 1024;

export function usePendingAttachments() {
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const blobUrlsRef = useRef<string[]>([]);

  useEffect(() => {
    return () => {
      for (const url of blobUrlsRef.current) {
        URL.revokeObjectURL(url);
      }
      blobUrlsRef.current = [];
    };
  }, []);

  const add = useCallback((files: ArrayLike<File> | null) => {
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
      const baseSort = current.length > 0 ? Math.max(...current.map((p) => p.sortOrder)) + 1 : 0;
      let nextIndex = 0;
      for (const file of candidates) {
        const isVideo = file.type.startsWith("video/");
        if (!file.type.startsWith("image/") && !isVideo) {
          toast.error(`${file.name || "文件"} 不是图片或视频格式`);
          continue;
        }
        if (isVideo && file.size > MAX_VIDEO_SIZE) {
          toast.error(`${file.name || "视频"} 超过 500MB 限制`);
          continue;
        }
        if (!isVideo && file.size > MAX_IMAGE_SIZE) {
          toast.error(`${file.name || "图片"} 超过 10MB 限制`);
          continue;
        }
        const blobUrl = URL.createObjectURL(file);
        blobUrlsRef.current.push(blobUrl);
        accepted.push({
          id: crypto.randomUUID(),
          file,
          blobUrl,
          kind: isVideo ? "video" : "image",
          sortOrder: baseSort + nextIndex,
          progress: 0,
          status: "ready",
        });
        nextIndex += 1;
      }
      return [...current, ...accepted];
    });
  }, []);

  const remove = useCallback((id: string) => {
    setPending((current) => {
      const item = current.find((p) => p.id === id);
      if (item) {
        URL.revokeObjectURL(item.blobUrl);
        blobUrlsRef.current = blobUrlsRef.current.filter((url) => url !== item.blobUrl);
      }
      return current.filter((p) => p.id !== id);
    });
  }, []);

  const markUploading = useCallback(() => {
    setPending((current) => current.map((p) => ({ ...p, status: "uploading" as const, progress: 0 })));
  }, []);

  const setProgress = useCallback((totalPercent: number) => {
    setPending((current) => current.map((p) => (p.status === "uploading" ? { ...p, progress: totalPercent } : p)));
  }, []);

  const markFailed = useCallback((fileIndex: number | undefined, message: string) => {
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
  }, []);

  const clearAll = useCallback(() => {
    setPending((current) => {
      for (const item of current) {
        URL.revokeObjectURL(item.blobUrl);
      }
      blobUrlsRef.current = [];
      return [];
    });
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
