import { Buffer } from "node:buffer";
import type Sharp from "sharp";
import type { CampuxConfig } from "@campux/config";
import { getStorageDriver } from "@campux/integrations";
import { sanitizeUploadExtension } from "../routes/posts";

/**
 * 惰性加载 sharp。
 *
 * sharp 是原生插件，在 `bun build --compile` 单文件形态下，其 `.node` 绑定通过运行时
 * `require("@img/sharp-<platform>/sharp.node")` 解析——这个路径无法被打包追踪，所以
 * 在顶层 `import sharp from "sharp"` 会让整个模块（乃至 server 启动）在 sharp 缺失时崩溃。
 *
 * 改为惰性按需加载：只有真正压缩图片时才尝试载入；载入失败由上层 try/catch 兜底返回原图，
 * 与既有「压缩失败用原图」的降级契约一致。Docker / 源码形态下 sharp 正常安装，行为不变。
 */
let sharpModulePromise: Promise<typeof Sharp | null> | null = null;
async function loadSharp(): Promise<typeof Sharp | null> {
  if (!sharpModulePromise) {
    sharpModulePromise = import("sharp")
      .then((mod) => (mod.default ?? mod) as unknown as typeof Sharp)
      .catch((error) => {
        console.warn("sharp 原生模块加载失败，图片压缩将被跳过（返回原图）", {
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      });
  }
  return sharpModulePromise;
}

export type ImageCompressionConfig = {
  enabled: boolean;
  quality: number;
  maxDimension: number;
};

export type PostAttachment = {
  kind: "image";
  key: string;
  url: string;
  fileName: string;
  contentType: string;
  size: number;
  width?: number;
  height?: number;
};

/**
 * Compress image buffer with optional resizing and encoding.
 * Returns original buffer if compression is disabled or for GIF/SVG.
 */
export async function compressImageBuffer(
  buffer: Buffer,
  contentType: string,
  config: ImageCompressionConfig,
): Promise<Buffer> {
  if (!config.enabled) {
    return buffer;
  }

  // Don't compress GIF (animated) or SVG (vector)
  if (contentType === "image/gif" || contentType === "image/svg+xml") {
    return buffer;
  }

  try {
    const sharp = await loadSharp();
    if (!sharp) {
      // sharp 不可用（单文件形态下原生库缺失）——降级返回原图。
      return buffer;
    }
    let image = sharp(buffer, { failOn: "none" }).rotate();

    // Resize if needed
    if (config.maxDimension > 0) {
      image = image.resize(config.maxDimension, config.maxDimension, {
        fit: "inside",
        withoutEnlargement: true,
      });
    }

    // Encode based on format
    if (contentType === "image/jpeg") {
      return await image.jpeg({ mozjpeg: true, quality: config.quality }).toBuffer();
    } else if (contentType === "image/png") {
      return await image.png({ compressionLevel: 9 }).toBuffer();
    } else if (contentType === "image/webp") {
      return await image.webp({ quality: config.quality }).toBuffer();
    } else if (contentType === "image/heic" || contentType === "image/heif") {
      // Convert HEIC/HEIF to JPEG
      return await image.jpeg({ mozjpeg: true, quality: config.quality }).toBuffer();
    }

    // Fallback to original for unrecognized formats
    return buffer;
  } catch (error) {
    // On compression error, return original buffer
    console.warn("image compression failed, using original", { error, contentType });
    return buffer;
  }
}

/**
 * Upload attachment bytes to S3 and return metadata.
 */
export async function uploadAttachmentBytes({
  config,
  tenantId,
  kind,
  contentType,
  fileName,
  body,
}: {
  config: CampuxConfig;
  tenantId: string;
  kind: "image";
  contentType: string;
  fileName: string;
  body: Buffer;
}): Promise<PostAttachment> {
  const extension = sanitizeUploadExtension(fileName);
  const key = `tenants/${tenantId}/uploads/${crypto.randomUUID()}.${extension}`;
  const storage = getStorageDriver(config);
  await storage.ensureReady();
  await storage.put(key, body, contentType);

  return {
    kind,
    key,
    url: `/api/uploads/post-image?key=${encodeURIComponent(key)}`,
    fileName,
    contentType,
    size: body.byteLength,
  };
}

/**
 * 站内上传链接 → storage key。
 * 只识别本系统生成的 `/api/uploads/post-image?key=...`，外链与相对路径统一返回 null，
 * 避免把任意字段当成可读取的 key。
 */
export function extractPostImageKey(url: string | null | undefined): string | null {
  const trimmed = typeof url === "string" ? url.trim() : "";
  if (!trimmed) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed, "http://campux.local");
  } catch {
    return null;
  }
  if (parsed.pathname !== "/api/uploads/post-image") {
    return null;
  }
  const key = parsed.searchParams.get("key")?.trim();
  if (!key || key.startsWith("base64://")) {
    return null;
  }
  return key;
}

/** 上传 key → 租户 ID（形如 `tenants/<tenantId>/uploads/...`）。 */
export function parseTenantIdFromUploadKey(key: string): string | null {
  const match = /^tenants\/([^/]+)\/(?:uploads|legacy)\//.exec(key);
  return match?.[1] ?? null;
}

export type UploadAccessDecision =
  | { allow: true; cacheControl: "private, max-age=3600" | "public, max-age=300" }
  | { allow: false; status: 401 | 403; message: string };

/**
 * `/api/uploads/post-image` 的访问判定：
 * - 已登录：只能读自己选中墙的 uploads / legacy 目录，私有缓存；
 * - 未登录：只放行该墙当前配置的 Logo（`logoKey` 与请求 key 完全一致），公开缓存。
 */
export function decideUploadAccess(input: {
  key: string;
  tenantId: string | null;
  logoKey: string | null;
}): UploadAccessDecision {
  if (input.tenantId) {
    const allowedPrefixes = [
      `tenants/${input.tenantId}/uploads/`,
      `tenants/${input.tenantId}/legacy/`,
    ];
    if (!allowedPrefixes.some((prefix) => input.key.startsWith(prefix))) {
      return { allow: false, status: 403, message: "没有访问该图片的权限" };
    }
    return { allow: true, cacheControl: "private, max-age=3600" };
  }
  if (input.logoKey !== null && input.logoKey === input.key) {
    // Logo 是公开资源，但缓存别太长：换 Logo 后旧 key 最多残留 5 分钟。
    return { allow: true, cacheControl: "public, max-age=300" };
  }
  return { allow: false, status: 401, message: "请先登录" };
}

/**
 * Batch delete attachment objects from storage.
 * Logs warnings on per-key failures but does not throw.
 */
export async function deleteAttachmentObjects(
  config: CampuxConfig,
  keys: string[],
): Promise<void> {
  if (keys.length === 0) {
    return;
  }

  const storage = getStorageDriver(config);
  await storage.delete(keys);
}
