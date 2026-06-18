import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, normalize, resolve, sep } from "node:path";
import type { CampuxConfig } from "@campux/config";
import type { StorageDriver, StorageHead, StorageObject } from "./types";

/**
 * 本地文件系统存储 driver。
 *
 * 把对象按 key 直接落到一个数据根目录下（key 里的 `/` 即子目录）。面向「零外部依赖单文件 /
 * 自托管」形态——不需要 MinIO/S3。读取仍走应用的 `/api/uploads/post-image` 代理，因此不暴露
 * 任何文件系统路径给外部。
 *
 * 安全：key 来自「tenants/<id>/uploads/<uuid>.<ext>」这类受控前缀，但仍对每个 key 做
 * 路径规整 + 越界校验（拒绝 `..` 逃逸出根目录），防御任何潜在的 key 注入。
 */
export class LocalStorageDriver implements StorageDriver {
  readonly kind = "local" as const;
  private readonly root: string;
  private readonly contentTypeSuffix = ".__ct";

  constructor(config: CampuxConfig) {
    this.root = resolve(config.storage.localDir);
  }

  private resolveKeyPath(key: string): string {
    // 拒绝任何包含 `..` 段的 key（防御路径逃逸），再规整解析。
    if (/(^|[/\\])\.\.([/\\]|$)/.test(key)) {
      throw new Error(`非法存储 key（含 .. 路径段）：${key}`);
    }
    const normalizedKey = normalize(key);
    const full = resolve(join(this.root, normalizedKey));
    const rootWithSep = this.root.endsWith(sep) ? this.root : this.root + sep;
    if (full !== this.root && !full.startsWith(rootWithSep)) {
      throw new Error(`非法存储 key（越界）：${key}`);
    }
    return full;
  }

  async ensureReady(): Promise<void> {
    await mkdir(this.root, { recursive: true });
  }

  async put(key: string, body: Buffer | Uint8Array, contentType: string): Promise<void> {
    const filePath = this.resolveKeyPath(key);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, body);
    // 旁路存一个 contentType 边车文件，读取时还原（本地无对象元数据）。
    try {
      await writeFile(filePath + this.contentTypeSuffix, contentType, "utf8");
    } catch {
      // contentType 边车写失败不影响主数据；读取时回退按扩展名推断。
    }
  }

  async getBytes(key: string): Promise<StorageObject | null> {
    const filePath = this.resolveKeyPath(key);
    try {
      const bytes = await readFile(filePath);
      const contentType = await this.readContentType(filePath, key);
      return { bytes: new Uint8Array(bytes), contentType };
    } catch (error) {
      if (isEnoent(error)) return null;
      throw error;
    }
  }

  async head(key: string): Promise<StorageHead | null> {
    const filePath = this.resolveKeyPath(key);
    try {
      const st = await stat(filePath);
      const contentType = await this.readContentType(filePath, key);
      return { size: st.size, contentType };
    } catch (error) {
      if (isEnoent(error)) return null;
      throw error;
    }
  }

  async delete(keys: string[]): Promise<void> {
    for (const key of keys) {
      try {
        const filePath = this.resolveKeyPath(key);
        await rm(filePath, { force: true });
        await rm(filePath + this.contentTypeSuffix, { force: true });
      } catch (error) {
        console.warn("failed to delete local storage object", { error, key });
      }
    }
  }

  private async readContentType(filePath: string, key: string): Promise<string | undefined> {
    try {
      const ct = await readFile(filePath + this.contentTypeSuffix, "utf8");
      if (ct.trim()) return ct.trim();
    } catch {
      // 无边车文件，回退按扩展名推断。
    }
    return inferContentTypeFromKey(key);
  }
}

function isEnoent(error: unknown): boolean {
  return Boolean(error) && typeof error === "object" && (error as { code?: string }).code === "ENOENT";
}

function inferContentTypeFromKey(key: string): string | undefined {
  const ext = key.toLowerCase().split(".").pop() ?? "";
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "svg":
      return "image/svg+xml";
    case "heic":
      return "image/heic";
    case "heif":
      return "image/heif";
    default:
      return undefined;
  }
}
