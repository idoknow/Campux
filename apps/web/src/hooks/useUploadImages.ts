import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { UploadedImage, UploadingFile } from "@/types/app";
import { uploadWithProgress } from "@/lib/api";

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_FILE_SIZE_LABEL = "10MB";

export function useUploadImages() {
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([]);
  const blobUrlsRef = useRef<string[]>([]);

  useEffect(() => {
    return () => {
      for (const url of blobUrlsRef.current) {
        URL.revokeObjectURL(url);
      }
    };
  }, []);

  function removeUploading(id: string) {
    setUploadingFiles((current) => {
      const item = current.find((f) => f.id === id);
      if (item?.blobUrl) {
        URL.revokeObjectURL(item.blobUrl);
        blobUrlsRef.current = blobUrlsRef.current.filter((url) => url !== item.blobUrl);
      }
      return current.filter((f) => f.id !== id);
    });
  }

  const uploadFiles = useCallback(
    async (
      files: ArrayLike<File> | null,
      uploadedImages: UploadedImage[],
      existingUploadingFiles: UploadingFile[],
      onUploaded: (image: UploadedImage) => void,
    ) => {
      if (!files?.length) {
        return;
      }

      const remainingSlots = Math.max(9 - uploadedImages.length - existingUploadingFiles.length, 0);
      const fileArray = Array.from(files).slice(0, remainingSlots);
      if (fileArray.length === 0) {
        toast.error("最多只能添加 9 张图片");
        return;
      }

      const oversized = fileArray.filter((f) => f.size > MAX_FILE_SIZE);
      if (oversized.length > 0) {
        toast.error(`${oversized.map((f) => f.name || "图片").join("、")} 超过 ${MAX_FILE_SIZE_LABEL} 限制`);
      }
      const validFiles = fileArray.filter((f) => f.size <= MAX_FILE_SIZE);
      if (validFiles.length === 0) {
        return;
      }

      const nextSortOrder =
        Math.max(
          -1,
          ...uploadedImages.map((image) => image.sortOrder),
          ...existingUploadingFiles.map((file) => file.sortOrder),
        ) + 1;

      const newEntries: UploadingFile[] = validFiles.map((file, index) => {
        const blobUrl = URL.createObjectURL(file);
        blobUrlsRef.current.push(blobUrl);
        return {
          id: crypto.randomUUID(),
          file,
          blobUrl,
          progress: 0,
          status: "uploading" as const,
          sortOrder: nextSortOrder + index,
        };
      });

      setUploadingFiles((current) => [...current, ...newEntries]);

      for (const entry of newEntries) {
        try {
          const result = await uploadWithProgress(entry.file, (progress) => {
            setUploadingFiles((current) =>
              current.map((f) => (f.id === entry.id ? { ...f, progress } : f)),
            );
          });
          onUploaded({ ...result, previewUrl: result.url, sortOrder: entry.sortOrder });
          setUploadingFiles((current) => current.filter((f) => f.id !== entry.id));
          URL.revokeObjectURL(entry.blobUrl);
          blobUrlsRef.current = blobUrlsRef.current.filter((url) => url !== entry.blobUrl);
        } catch (caught) {
          const errorMessage = caught instanceof Error ? caught.message : "图片上传失败";
          toast.error(errorMessage);
          setUploadingFiles((current) =>
            current.map((f) =>
              f.id === entry.id ? { ...f, status: "failed" as const, errorMessage } : f,
            ),
          );
        }
      }
    },
    [],
  );

  return {
    uploadingFiles,
    uploadFiles,
    removeUploading,
  };
}
