export async function api<T>(path: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(path, {
    ...options,
    credentials: "include",
    headers,
  });
  const data = (await response.json().catch(() => ({}))) as T & { message?: string };
  if (!response.ok) {
    throw new Error(data.message || `请求失败：${response.status}`);
  }
  return data as T;
}

export type UploadImageResponse = {
  key: string;
  url: string;
  fileName: string;
};

export function uploadWithProgress(
  file: File,
  onProgress: (progress: number) => void,
): Promise<UploadImageResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/uploads/post-images");
    xhr.withCredentials = true;

    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        onProgress((event.loaded / event.total) * 100);
      }
    });

    xhr.addEventListener("load", () => {
      let parsed: UploadImageResponse | { message?: string };
      try {
        parsed = JSON.parse(xhr.responseText) as UploadImageResponse | { message?: string };
      } catch {
        reject(new Error(xhr.statusText || `上传失败：${xhr.status}`));
        return;
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(parsed as UploadImageResponse);
        return;
      }

      const message = (parsed as { message?: string }).message || `上传失败：${xhr.status}`;
      reject(new Error(message));
    });

    xhr.addEventListener("error", () => {
      reject(new Error("网络错误，图片上传失败"));
    });

    xhr.addEventListener("abort", () => {
      reject(new Error("上传已取消"));
    });

    const formData = new FormData();
    formData.append("file", file);
    xhr.send(formData);
  });
}
