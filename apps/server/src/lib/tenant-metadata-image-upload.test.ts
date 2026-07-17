import { describe, expect, test } from "bun:test";
import {
  imageMaxSizeMetadataKey,
  readTenantImageCompression,
} from "./tenant-metadata";

function metadataClient(entries: Array<{ key: string; value: unknown }>) {
  return {
    tenantMetadata: {
      findMany: async () => entries,
    },
  } as never;
}

describe("tenant image upload metadata", () => {
  test("defaults legacy tenants to a 10MB image limit with compression enabled", async () => {
    await expect(readTenantImageCompression(metadataClient([]), "tenant-1")).resolves.toEqual({
      enabled: true,
      quality: 80,
      maxDimension: 2048,
      maxSizeMb: 10,
    });
  });

  test("reads the tenant-specific image size limit together with compression settings", async () => {
    await expect(readTenantImageCompression(metadataClient([
      { key: "image_compression_enabled", value: false },
      { key: "image_compression_quality", value: 70 },
      { key: "image_compression_max_dimension", value: 1600 },
      { key: imageMaxSizeMetadataKey, value: 25 },
    ]), "tenant-1")).resolves.toEqual({
      enabled: false,
      quality: 70,
      maxDimension: 1600,
      maxSizeMb: 25,
    });
  });
});
