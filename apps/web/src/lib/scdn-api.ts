/**
 * 失控图床 API 客户端
 *
 * API 端点: https://img.scdn.io/api/v1.php
 *
 * 将视频上传至失控图床，服务端自动转码为 GIF 并返回外链。
 * 前端下载 GIF 后作为普通附件参与投稿流程。
 */

const API_BASE = "https://img.scdn.io/api/v1.php";

/** 失控图床对视频文件的尺寸限制 */
export const SCDN_MAX_VIDEO_SIZE = 15 * 1024 * 1024; // 15MB

export class ScdnApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScdnApiError";
  }
}

/** 上传成功响应的 data 部分 */
export interface ScdnUploadData {
  url: string;
  filename: string;
  storage_backend: "local" | "telegram" | "r2";
  original_size?: number;
  compressed_size?: number;
  compression_ratio?: number;
  message?: string;
}

/** 上传成功响应 */
export interface ScdnUploadResponse {
  success: true;
  url: string;
  data: ScdnUploadData;
  message?: string;
}

/** 上传失败响应 */
export interface ScdnErrorResponse {
  success: false;
  error: string;
  message: string;
}

export type ScdnResponse = ScdnUploadResponse | ScdnErrorResponse;

/**
 * 将视频文件上传至失控图床，服务端自动转为 GIF。
 *
 * @param file - 视频文件（≤ 15MB）
 * @param onProgress - 上传进度回调（0-100）
 * @returns 上传成功后的 data 对象（含 GIF 外链 url）
 */
export async function uploadVideoToGif(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<ScdnUploadData> {
  if (file.size > SCDN_MAX_VIDEO_SIZE) {
    throw new ScdnApiError(
      `视频超过 ${SCDN_MAX_VIDEO_SIZE / 1024 / 1024}MB 限制（失控图床限制）`,
    );
  }

  const formData = new FormData();
  formData.append("image", file);
  formData.append("outputFormat", "gif");
  formData.append("cdn_domain", "cloudflarecnimg.scdn.io");
  formData.append("storage_destination", "telegram");

  const data = await new Promise<ScdnResponse>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", API_BASE);

    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    });

    xhr.addEventListener("load", () => {
      try {
        const parsed = JSON.parse(xhr.responseText) as ScdnResponse;
        resolve(parsed);
      } catch {
        reject(new ScdnApiError(`解析响应失败：${xhr.statusText || xhr.status}`));
      }
    });

    xhr.addEventListener("error", () => {
      reject(new ScdnApiError("网络错误，上传至图床失败"));
    });

    xhr.addEventListener("abort", () => {
      reject(new ScdnApiError("上传已取消"));
    });

    xhr.send(formData);
  });

  if (!data.success) {
    throw new ScdnApiError(data.message || data.error || "图床上传失败");
  }

  return data.data;
}

/**
 * 从 URL 下载 GIF Blob（用于将图床返回的 GIF 下载到本地后作为附件上传到 Campux 后端）
 */
export async function downloadGifBlob(url: string): Promise<Blob> {
  const response = await fetch(url, {
    // 避免 CORS 限制，使用 no-cors 模式可能拿不到响应体，
    // 故使用默认 same-origin 模式，依赖服务端允许跨域
    mode: "cors",
  });

  if (!response.ok) {
    throw new ScdnApiError(`下载 GIF 失败：${response.status} ${response.statusText}`);
  }

  const blob = await response.blob();

  if (!blob.type.startsWith("image/") && !blob.type.startsWith("application/octet-stream")) {
    // 允许 application/octet-stream，有些 CDN 返回该类型
    throw new ScdnApiError(`下载内容不是图片类型：${blob.type}`);
  }

  return blob;
}
