import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyMultipart from "@fastify/multipart";
import { resetStorageDriver } from "@campux/integrations";

process.env.CAMPUX_BOT_SESSION_SECRET = process.env.CAMPUX_BOT_SESSION_SECRET ?? "test-signing-secret";

const tenantId = "3828146d-a7af-43bf-aeab-559375b4b9a3";
const fakeContext = {
  selectedTenant: { id: tenantId, slug: "wall", status: "active" },
  selectedMembership: { role: "submitter" },
  user: { id: "user-1", passwordChangeRequired: false },
};

const realPrismaModule = await import("../lib/prisma");
const realAuthModule = await import("../lib/auth");
mock.module("../lib/prisma", () => ({
  prisma: {
    tenantMetadata: { findMany: async () => [], findUnique: async () => null },
    banRecord: { findFirst: async () => null },
  },
}));
mock.module("../lib/auth", () => ({
  getSessionContext: async () => null,
  hasTenantRole: () => true,
  requireTenantContext: async () => fakeContext,
  requireReadyTenant: async () => fakeContext,
}));

const { registerPostRoutes } = await import("./posts");

let app: FastifyInstance;
let dir = "";
const boundary = "----campux-test-boundary";

function multipartBody(fields: Record<string, string>, file?: { name: string; filename: string; contentType: string; bytes: string }) {
  const chunks: string[] = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(`--${boundary}`, `Content-Disposition: form-data; name="${name}"`, "", value);
  }
  if (file) {
    chunks.push(
      `--${boundary}`,
      `Content-Disposition: form-data; name="${file.name}"; filename="${file.filename}"`,
      `Content-Type: ${file.contentType}`,
      "",
      file.bytes,
    );
  }
  chunks.push(`--${boundary}--`, "");
  return chunks.join("\r\n");
}

function submit(body: string) {
  return app.inject({
    method: "POST",
    url: "/api/posts",
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: body,
  });
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "campux-upload-svg-"));
  resetStorageDriver();
  app = Fastify();
  await app.register(fastifyMultipart, { limits: { fileSize: 500 * 1024 * 1024, files: 9, fields: 10 } });
  registerPostRoutes(app, { storage: { driver: "local", localDir: dir }, webOrigin: "http://localhost" } as never, {} as never);
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  resetStorageDriver();
  mock.module("../lib/prisma", () => realPrismaModule);
  mock.module("../lib/auth", () => realAuthModule);
  if (dir) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("POST /api/posts multipart 上传", () => {
  test("image/svg+xml 被拒（415），不会落盘", async () => {
    const response = await submit(multipartBody(
      { text: "测试投稿" },
      { name: "images", filename: "xss.svg", contentType: "image/svg+xml", bytes: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>' },
    ));

    expect(response.statusCode).toBe(415);
    expect(response.json().message).toBe("仅支持图片和视频格式");
    expect(await readdir(dir)).toEqual([]);
  });

  test("image/svg 同样被拒（415）", async () => {
    const response = await submit(multipartBody(
      { text: "测试投稿" },
      { name: "images", filename: "xss.svg", contentType: "image/svg", bytes: "<svg/>" },
    ));

    expect(response.statusCode).toBe(415);
  });
});
