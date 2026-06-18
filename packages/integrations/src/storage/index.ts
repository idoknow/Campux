import type { CampuxConfig } from "@campux/config";
import type { StorageDriver } from "./types";
import { S3StorageDriver } from "./s3-driver";
import { LocalStorageDriver } from "./local-driver";

export type { StorageDriver, StorageObject, StorageHead, StorageKind } from "./types";
export { resolveStorageKind } from "./types";
export { S3StorageDriver } from "./s3-driver";
export { LocalStorageDriver } from "./local-driver";

let cached: StorageDriver | null = null;

/**
 * 取（进程级缓存的）存储 driver。由 config.storage.driver 决定 s3 还是 local。
 *
 * config 在进程内不变，因此 driver 单例缓存即可；测试里可用 resetStorageDriver() 重置。
 */
export function getStorageDriver(config: CampuxConfig): StorageDriver {
  if (cached) return cached;
  cached = config.storage.driver === "local"
    ? new LocalStorageDriver(config)
    : new S3StorageDriver(config);
  return cached;
}

/** 测试辅助：清空缓存的 driver 单例。 */
export function resetStorageDriver(): void {
  cached = null;
}
