import type { CampuxConfig } from "@campux/config";

/**
 * 对象存储抽象。
 *
 * Campux 的稿件图片（投稿原图、渲染卡片图）存放在对象存储里，key 形如
 * `tenants/<id>/uploads/<uuid>.<ext>`。历史实现直接用 AWS S3 SDK（MinIO / 任意 S3 兼容）。
 *
 * 为支持「零外部依赖的单文件 / 自托管」形态，这里把存储抽象成一个最小接口，提供两种实现：
 *   - `s3`     —— S3 / MinIO（生产默认；保留既有行为）
 *   - `local`  —— 本地文件系统（单文件自托管默认；把对象写到一个数据目录下）
 *
 * 所有读取都走应用自身的 `/api/uploads/post-image?key=` 代理，因此 driver 不需要产出公网 URL。
 * 接口返回值刻意只用 Buffer / 基础类型，不暴露 S3 SDK 的具体形状，便于两种实现等价替换。
 */

/** 读取到的对象内容。 */
export interface StorageObject {
  bytes: Uint8Array;
  contentType?: string | undefined;
}

/** 对象元信息（HEAD）。 */
export interface StorageHead {
  size: number;
  contentType?: string | undefined;
}

export interface StorageDriver {
  /** driver 类型标识，便于日志/诊断。 */
  readonly kind: "s3" | "local";

  /**
   * 确保后端就绪（S3：建桶；local：建目录）。幂等。在写入前调用。
   */
  ensureReady(): Promise<void>;

  /**
   * 写入一个对象。
   * @param key         对象 key（含前缀路径）
   * @param body        内容（Buffer / Uint8Array）
   * @param contentType MIME 类型
   */
  put(key: string, body: Buffer | Uint8Array, contentType: string): Promise<void>;

  /**
   * 读取对象完整字节。对象不存在返回 null。
   */
  getBytes(key: string): Promise<StorageObject | null>;

  /**
   * 读取对象元信息。对象不存在返回 null。
   */
  head(key: string): Promise<StorageHead | null>;

  /**
   * 删除若干对象。单个 key 失败只记日志不抛错（与既有 S3 删除语义一致）。
   */
  delete(keys: string[]): Promise<void>;
}

/** 由 config 决定使用哪种 driver。 */
export type StorageKind = StorageDriver["kind"];

export function resolveStorageKind(config: CampuxConfig): StorageKind {
  return config.storage.driver;
}
