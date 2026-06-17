import { Buffer } from "node:buffer";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import type Sharp from "sharp";
import type { CampuxConfig } from "@campux/config";
import { createS3Client } from "@campux/integrations";
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
  const s3 = createS3Client(config);

  await new Upload({
    client: s3,
    params: {
      Bucket: config.s3.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    },
  }).done();

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
 * Batch delete attachment objects from S3.
 * Logs warnings on per-key failures but does not throw.
 */
export async function deleteAttachmentObjects(
  config: CampuxConfig,
  keys: string[],
): Promise<void> {
  if (keys.length === 0) {
    return;
  }

  const s3 = createS3Client(config);

  for (const key of keys) {
    try {
      await s3.send(
        new DeleteObjectCommand({
          Bucket: config.s3.bucket,
          Key: key,
        }),
      );
    } catch (error) {
      console.warn("failed to delete attachment object", { error, key });
    }
  }
}
