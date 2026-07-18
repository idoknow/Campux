import { isDefaultFont } from "@campux/domain";
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
  remoteGifIndexes?: number[];
  status: number;
  constructor(message: string, status: number, fileIndex?: number, remoteGifIndexes?: number[]) {
    super(message);
    this.name = "CreatePostError";
    this.status = status;
    if (fileIndex !== undefined) {
      this.fileIndex = fileIndex;
    }
    if (remoteGifIndexes) {
      this.remoteGifIndexes = remoteGifIndexes;
    }
  }
}

export type CreatePostResponse = {
  post: PostItem;
};

export function normalizePostFont(font: string | null | undefined): string | undefined {
  return font && !isDefaultFont(font) ? font : undefined;
}

export type RemoteGifClaim = {
  url: string;
  proof: string;
};

export function createPostWithAttachments(
  text: string,
  anonymous: boolean,
  files: File[],
  onProgress?: (totalPercent: number) => void,
  remoteGifClaims?: RemoteGifClaim[],
  attachmentOrder?: Array<"local" | "remote">,
  bgColor?: string,
  textColor?: string,
  font?: string,
  anonymousAvatar?: string,
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
      let parsed: CreatePostResponse | { message?: string; fileIndex?: number; remoteGifIndexes?: number[] };
      try {
        parsed = JSON.parse(xhr.responseText) as CreatePostResponse | {
          message?: string;
          fileIndex?: number;
          remoteGifIndexes?: number[];
        };
      } catch {
        reject(new CreatePostError(xhr.statusText || `投稿失败：${xhr.status}`, xhr.status));
        return;
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(parsed as CreatePostResponse);
        return;
      }

      const errorBody = parsed as { message?: string; fileIndex?: number; remoteGifIndexes?: number[] };
      const fileIndex = typeof errorBody.fileIndex === "number"
        && Number.isInteger(errorBody.fileIndex)
        && errorBody.fileIndex >= 0
        ? errorBody.fileIndex
        : undefined;
      const remoteGifIndexes = Array.isArray(errorBody.remoteGifIndexes)
        ? errorBody.remoteGifIndexes.filter((value) => Number.isInteger(value) && value >= 0)
        : undefined;
      reject(new CreatePostError(
        errorBody.message || `投稿失败：${xhr.status}`,
        xhr.status,
        fileIndex,
        remoteGifIndexes,
      ));
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
    if (anonymousAvatar) {
      formData.append("anonymousAvatar", anonymousAvatar);
    }
    if (bgColor) {
      formData.append("bgColor", bgColor);
    }
    if (textColor) {
      formData.append("textColor", textColor);
    }
    const normalizedFont = normalizePostFont(font);
    if (normalizedFont) {
      formData.append("font", normalizedFont);
    }
    if (attachmentOrder) {
      formData.append("attachmentOrder", JSON.stringify(attachmentOrder));
    }
    for (const file of files) {
      formData.append("images", file, file.name);
    }
    if (remoteGifClaims && remoteGifClaims.length > 0) {
      formData.append("remoteGifClaims", JSON.stringify(remoteGifClaims));
    }
    xhr.send(formData);
  });
}
