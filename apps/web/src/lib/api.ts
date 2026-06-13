import type { PostItem } from "../types/app";

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

export class CreatePostError extends Error {
  fileIndex?: number;
  status: number;
  constructor(message: string, status: number, fileIndex?: number) {
    super(message);
    this.name = "CreatePostError";
    this.status = status;
    if (fileIndex !== undefined) {
      this.fileIndex = fileIndex;
    }
  }
}

export type CreatePostResponse = {
  post: PostItem;
};

export function createPostWithAttachments(
  text: string,
  anonymous: boolean,
  files: File[],
  onProgress?: (totalPercent: number) => void,
  remoteGifUrls?: string[],
  bgColor?: string,
  textColor?: string,
  font?: string,
): Promise<CreatePostResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/posts");
    xhr.withCredentials = true;

    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress((event.loaded / event.total) * 100);
      }
    });

    xhr.addEventListener("load", () => {
      let parsed: CreatePostResponse | { message?: string; fileIndex?: number };
      try {
        parsed = JSON.parse(xhr.responseText) as CreatePostResponse | { message?: string; fileIndex?: number };
      } catch {
        reject(new CreatePostError(xhr.statusText || `投稿失败：${xhr.status}`, xhr.status));
        return;
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(parsed as CreatePostResponse);
        return;
      }

      const errorBody = parsed as { message?: string; fileIndex?: number };
      reject(new CreatePostError(errorBody.message || `投稿失败：${xhr.status}`, xhr.status, errorBody.fileIndex));
    });

    xhr.addEventListener("error", () => {
      reject(new CreatePostError("网络错误，投稿失败", 0));
    });

    xhr.addEventListener("abort", () => {
      reject(new CreatePostError("投稿已取消", 0));
    });

    const formData = new FormData();
    formData.append("text", text);
    formData.append("anonymous", String(anonymous));
    if (bgColor) {
      formData.append("bgColor", bgColor);
    }
    if (textColor) {
      formData.append("textColor", textColor);
    }
    if (font) {
      formData.append("font", font);
    }
    for (const file of files) {
      formData.append("images", file, file.name);
    }
    if (remoteGifUrls && remoteGifUrls.length > 0) {
      formData.append("remoteGifUrls", JSON.stringify(remoteGifUrls));
    }
    xhr.send(formData);
  });
}
