import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CampuxConfig } from "@campux/config";
import { LocalStorageDriver } from "./local-driver";

function makeConfig(localDir: string): CampuxConfig {
  // 只填 storage 字段，其余按需 as 断言（driver 只读 storage.localDir）。
  return { storage: { driver: "local", localDir } } as unknown as CampuxConfig;
}

describe("LocalStorageDriver", () => {
  test("put/getBytes/head/delete round-trip with contentType sidecar", async () => {
    const root = mkdtempSync(join(tmpdir(), "campux-localstore-"));
    try {
      const driver = new LocalStorageDriver(makeConfig(root));
      await driver.ensureReady();

      const key = "tenants/t1/uploads/abc.png";
      const body = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
      await driver.put(key, body, "image/png");

      const got = await driver.getBytes(key);
      expect(got).not.toBeNull();
      expect(Buffer.from(got!.bytes).equals(body)).toBe(true);
      expect(got!.contentType).toBe("image/png");

      const head = await driver.head(key);
      expect(head).not.toBeNull();
      expect(head!.size).toBe(body.byteLength);
      expect(head!.contentType).toBe("image/png");

      await driver.delete([key]);
      expect(await driver.getBytes(key)).toBeNull();
      expect(await driver.head(key)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("missing object returns null (not throw)", async () => {
    const root = mkdtempSync(join(tmpdir(), "campux-localstore-"));
    try {
      const driver = new LocalStorageDriver(makeConfig(root));
      expect(await driver.getBytes("tenants/x/uploads/none.jpg")).toBeNull();
      expect(await driver.head("tenants/x/uploads/none.jpg")).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("falls back to extension-based contentType when sidecar missing", async () => {
    const root = mkdtempSync(join(tmpdir(), "campux-localstore-"));
    try {
      const driver = new LocalStorageDriver(makeConfig(root));
      await driver.ensureReady();
      const key = "tenants/t/uploads/photo.jpg";
      await driver.put(key, Buffer.from("x"), "image/jpeg");
      // remove the sidecar to force fallback
      rmSync(join(root, key + ".__ct"), { force: true });
      const got = await driver.getBytes(key);
      expect(got!.contentType).toBe("image/jpeg");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects path traversal keys (cannot escape root)", async () => {
    const root = mkdtempSync(join(tmpdir(), "campux-localstore-"));
    try {
      const driver = new LocalStorageDriver(makeConfig(root));
      await driver.ensureReady();
      await expect(driver.put("../../../etc/evil", Buffer.from("x"), "text/plain")).rejects.toThrow();
      // confirm nothing was written outside root
      expect(existsSync(join(root, "..", "..", "..", "etc", "evil"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
