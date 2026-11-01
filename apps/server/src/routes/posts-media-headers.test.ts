import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { getStorageDriver, resetStorageDriver } from "@campux/integrations";
import { isAllowedPostImageMime } from "../lib/image-upload-policy";
import { buildPublicForumMediaUrl } from "../lib/public-forum-media";
import { registerPostRoutes, storedImageResponseHeaders } from "./posts";

process.env.CAMPUX_BOT_SESSION_SECRET = process.env.CAMPUX_BOT_SESSION_SECRET ?? "test-signing-secret";

const tenantId = "3828146d-a7af-43bf-aeab-559375b4b9a3";
const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const svgBytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const htmlBytes = new TextEncoder().encode("<!doctype html><script>alert(1)</script>");
const emptyBytes = new Uint8Array([]);

let app: FastifyInstance;
let config: { storage: { driver: "local"; localDir: string }; webOrigin: string };
let dir = "";

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "campux-media-headers-"));
  config = { storage: { driver: "local", localDir: dir }, webOrigin: "http://localhost" };
  resetStorageDriver();
  app = Fastify();
  registerPostRoutes(app, config as never, {} as never);
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  resetStorageDriver();
  if (dir) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function fetchForumMedia(key: string, bytes: Uint8Array, storedContentType: string) {
  const storage = getStorageDriver(config as never);
  await storage.put(key, bytes, storedContentType);
  const url = new URL(buildPublicForumMediaUrl(config as never, key));
  return app.inject({ method: "GET", url: `${url.pathname}${url.search}` });
}

describe("GET /api/public/forum-media 响应头", () => {
  test("位图字节按实际类型内联，忽略错误的存储 Content-Type", async () => {
    const response = await fetchForumMedia(
      `tenants/${tenantId}/published/qq-forum/case-raster.png`,
      pngBytes,
      "image/svg+xml",
    );

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("image/png");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["content-disposition"]).toBeUndefined();
    expect(response.headers["cache-control"]).toBe("public, max-age=3600");
  });

  test("SVG 字节即使声明 image/png 也只给下载", async () => {
    const response = await fetchForumMedia(
      `tenants/${tenantId}/published/qq-forum/case-svg.png`,
      svgBytes,
      "image/png",
    );

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("application/octet-stream");
    expect(response.headers["content-disposition"]).toBe('attachment; filename="image"');
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
  });

  test("HTML 与空内容同样只给下载", async () => {
    for (const [name, bytes] of [["case-html.png", htmlBytes], ["case-empty.png", emptyBytes]] as const) {
      const response = await fetchForumMedia(
        `tenants/${tenantId}/published/qq-forum/${name}`,
        bytes,
        "image/png",
      );

      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toBe("application/octet-stream");
      expect(response.headers["content-disposition"]).toBe('attachment; filename="image"');
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.headers["x-content-type-options"]).toBe("nosniff");
    }
  });
});

/**
 * /api/uploads/post-image 的响应头由同一个 storedImageResponseHeaders() 生成。
 * 该路由的匿名 Logo 分支已在 posts-image-route.test.ts 做了路由级覆盖；
 * 这里再对 helper 本身断言完整头矩阵，防止路由与 helper 之间出现偏差。
 */
describe("storedImageResponseHeaders（post-image 共用）", () => {
  test("位图 → 内联 + nosniff，可缓存", () => {
    expect(storedImageResponseHeaders(pngBytes)).toEqual({
      headers: {
        "X-Content-Type-Options": "nosniff",
        "Content-Type": "image/png",
      },
      cacheable: true,
    });
  });

  test("SVG / HTML / 空内容 → 附件 + no-store", () => {
    for (const bytes of [svgBytes, htmlBytes, emptyBytes]) {
      expect(storedImageResponseHeaders(bytes)).toEqual({
        headers: {
          "X-Content-Type-Options": "nosniff",
          "Content-Type": "application/octet-stream",
          "Content-Disposition": 'attachment; filename="image"',
          "Cache-Control": "no-store",
        },
        cacheable: false,
      });
    }
  });
});

/**
 * 上传侧拒绝 SVG 的判定点在 posts.ts 的 multipart 循环里（isAllowedPostImageMime）。
 * 路由级 multipart 用例需要额外的会话/租户上下文与 ban 查询替身，这里直接锁住该判定函数的边界值。
 */
describe("上传白名单拒绝 SVG", () => {
  test("image/svg+xml 与 image/svg 均不通过", () => {
    expect(isAllowedPostImageMime("image/svg+xml")).toBe(false);
    expect(isAllowedPostImageMime("image/svg")).toBe(false);
  });

  test("常见位图仍然通过", () => {
    expect(isAllowedPostImageMime("image/jpeg")).toBe(true);
    expect(isAllowedPostImageMime("image/png")).toBe(true);
    expect(isAllowedPostImageMime("image/heic")).toBe(true);
  });
});
