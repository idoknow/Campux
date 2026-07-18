/**
 * Campux video-to-GIF upload client.
 *
 * The browser uploads the source video to Campux. The server validates the
 * media, calls the external converter, and returns a short-lived claim bound
 * to the current session, user, and tenant.
 */

/** External converter source-video limit, also enforced by Campux. */
export const SCDN_MAX_VIDEO_SIZE = 15 * 1024 * 1024; // 15MB

export class ScdnApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScdnApiError";
  }
}

export interface ScdnUploadData {
  url: string;
  proof: string;
}

type VideoGifUploadResponse = {
  url?: string;
  proof?: string;
  message?: string;
};

/** Upload a video to Campux for validated server-side GIF conversion. */
export async function uploadVideoToGif(
  file: File,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<ScdnUploadData> {
  if (file.size > SCDN_MAX_VIDEO_SIZE) {
    throw new ScdnApiError(
      `视频超过 ${SCDN_MAX_VIDEO_SIZE / 1024 / 1024}MB 限制（转换服务限制）`,
    );
  }

  const formData = new FormData();
  formData.append("video", file, file.name);

  return new Promise<ScdnUploadData>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;
    const handleSignalAbort = () => xhr.abort();
    const cleanup = () => signal?.removeEventListener("abort", handleSignalAbort);
    const resolveOnce = (data: ScdnUploadData) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(data);
    };
    const rejectOnce = (error: ScdnApiError) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    if (signal?.aborted) {
      rejectOnce(new ScdnApiError("上传已取消"));
      return;
    }
    signal?.addEventListener("abort", handleSignalAbort, { once: true });

    xhr.open("POST", "/api/uploads/video-gif");
    xhr.withCredentials = true;
    xhr.timeout = 120_000;

    xhr.upload.addEventListener("progress", (event) => {
      if (!signal?.aborted && event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    });

    xhr.addEventListener("load", () => {
      let parsed: VideoGifUploadResponse;
      try {
        parsed = JSON.parse(xhr.responseText) as VideoGifUploadResponse;
      } catch {
        rejectOnce(new ScdnApiError(`解析响应失败：${xhr.statusText || xhr.status}`));
        return;
      }

      if (xhr.status < 200 || xhr.status >= 300) {
        rejectOnce(new ScdnApiError(parsed.message || `视频转换失败：${xhr.status}`));
        return;
      }
      if (typeof parsed.url !== "string" || typeof parsed.proof !== "string") {
        rejectOnce(new ScdnApiError("视频转换服务未返回有效凭证"));
        return;
      }
      resolveOnce({ url: parsed.url, proof: parsed.proof });
    });

    xhr.addEventListener("error", () => {
      rejectOnce(new ScdnApiError("网络错误，视频转换失败"));
    });

    xhr.addEventListener("timeout", () => {
      rejectOnce(new ScdnApiError("视频转换超时，请重试"));
    });

    xhr.addEventListener("abort", () => {
      rejectOnce(new ScdnApiError("上传已取消"));
    });

    xhr.send(formData);
  });
}
