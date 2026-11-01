import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { getStorageDriver, resetStorageDriver } from "@campux/integrations";

process.env.CAMPUX_BOT_SESSION_SECRET = process.env.CAMPUX_BOT_SESSION_SECRET ?? "test-signing-secret";

/** 匿名 Logo 分支只查 tenantMetadata.logo_url；用替身避开真实数据库。 */
let logoUrl: string | null = null;
const realPrismaModule = await import("../lib/prisma");
mock.module("../lib/prisma", () => ({
  prisma: {
    tenantMetadata: {
      findUnique: async () => (logoUrl === null ? null : { value: logoUrl }),
    },
  },
}));

const { registerPostRoutes } = await import("./posts");

const tenantId = "3828146d-a7af-43bf-aeab-559375b4b9a3";
const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const svgBytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const htmlBytes = new TextEncoder().encode("<!doctype html><script>alert(1)</script>");

let app: FastifyInstance;
let config: { storage: { driver: "local"; localDir: string }; webOrigin: string };
let dir = "";

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "campux-post-image-"));
  config = { storage: { driver: "local", localDir: dir }, webOrigin: "http://localhost" };
  resetStorageDriver();
  app = Fastify();
  registerPostRoutes(app, config as never, {} as never);
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  resetStorageDriver();
  mock.module("../lib/prisma", () => realPrismaModule);
  if (dir) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function fetchPostImage(name: string, bytes: Uint8Array, storedContentType: string) {
  const key = `tenants/${tenantId}/uploads/${name}`;
  await getStorageDriver(config as never).put(key, bytes, storedContentType);
  logoUrl = `/api/uploads/post-image?key=${encodeURIComponent(key)}`;
  return app.inject({ method: "GET", url: `/api/uploads/post-image?key=${encodeURIComponent(key)}` });
}

describe("GET /api/uploads/post-image 匿名 Logo 响应头", () => {
  test("PNG 字节按实际类型内联，可缓存", async () => {
    const response = await fetchPostImage("logo.png", pngBytes, "image/png");

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("image/png");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["content-disposition"]).toBeUndefined();
    expect(response.headers["cache-control"]).toBe("public, max-age=300");
  });

  test("SVG 字节声明 image/png 也只能下载", async () => {
    const response = await fetchPostImage("logo-svg.png", svgBytes, "image/png");

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("application/octet-stream");
    expect(response.headers["content-disposition"]).toBe('attachment; filename="image"');
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
  });

  test("HTML 字节同样只能下载", async () => {
    const response = await fetchPostImage("logo-html.png", htmlBytes, "image/png");

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("application/octet-stream");
    expect(response.headers["content-disposition"]).toBe('attachment; filename="image"');
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  test("声明 image/svg+xml 的 Logo 在匿名分支直接被拒", async () => {
    const response = await fetchPostImage("logo-declared.svg", pngBytes, "image/svg+xml");
    expect(response.statusCode).toBe(404);
  });
});
