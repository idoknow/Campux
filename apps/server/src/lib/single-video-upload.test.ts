import { afterEach, describe, expect, test } from "bun:test";
import multipart from "@fastify/multipart";
import Fastify, { type FastifyInstance } from "fastify";
import { readSingleVideoUpload, SingleVideoUploadError } from "./single-video-upload";

const apps: FastifyInstance[] = [];

async function buildApp() {
  const app = Fastify();
  apps.push(app);
  await app.register(multipart);
  app.post("/upload", async (request, reply) => {
    try {
      const upload = await readSingleVideoUpload(request, {
        maxBytes: 1024,
        isAllowedMimeType: (mimetype) => mimetype === "video/mp4",
        missingMessage: "missing",
        sizeMessage: "too large",
        shapeMessage: "invalid shape",
        typeMessage: "invalid type",
      });
      return reply.send({ size: upload.buffer.byteLength, filename: upload.filename });
    } catch (error) {
      if (error instanceof SingleVideoUploadError) {
        return reply.code(error.status).send({ message: error.message });
      }
      throw error;
    }
  });
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function videoFile(contents: string, name = "clip.mp4") {
  return new File([contents], name, { type: "video/mp4" });
}

describe("readSingleVideoUpload", () => {
  test("accepts exactly one video file", async () => {
    const app = await buildApp();
    const form = new FormData();
    form.append("video", videoFile("abc"));

    const response = await app.inject({ method: "POST", url: "/upload", payload: form as never });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('{"size":3,"filename":"clip.mp4"}');
  });

  test("rejects a trailing field after the video file", async () => {
    const app = await buildApp();
    const form = new FormData();
    form.append("video", videoFile("abc"));
    form.append("extra", "value");

    const response = await app.inject({ method: "POST", url: "/upload", payload: form as never });

    expect(response.statusCode).toBe(413);
    expect(response.body).toBe('{"message":"invalid shape"}');
  });

  test("rejects a trailing second file after the video file", async () => {
    const app = await buildApp();
    const form = new FormData();
    form.append("video", videoFile("abc"));
    form.append("video2", videoFile("def", "second.mp4"));

    const response = await app.inject({ method: "POST", url: "/upload", payload: form as never });

    expect(response.statusCode).toBe(413);
    expect(response.body).toBe('{"message":"invalid shape"}');
  });

  test("rejects a field before the video file", async () => {
    const app = await buildApp();
    const form = new FormData();
    form.append("extra", "value");
    form.append("video", videoFile("abc"));

    const response = await app.inject({ method: "POST", url: "/upload", payload: form as never });

    expect(response.statusCode).toBe(413);
    expect(response.body).toBe('{"message":"invalid shape"}');
  });

  test("rejects an empty multipart request", async () => {
    const app = await buildApp();
    const form = new FormData();

    const response = await app.inject({ method: "POST", url: "/upload", payload: form as never });

    expect(response.statusCode).toBe(400);
    expect(response.body).toBe('{"message":"missing"}');
  });

  test("rejects a non-video MIME type", async () => {
    const app = await buildApp();
    const form = new FormData();
    form.append("video", new File(["abc"], "clip.txt", { type: "text/plain" }));

    const response = await app.inject({ method: "POST", url: "/upload", payload: form as never });

    expect(response.statusCode).toBe(415);
    expect(response.body).toBe('{"message":"invalid type"}');
  });

  test("rejects a video above the byte cap", async () => {
    const app = await buildApp();
    const form = new FormData();
    form.append("video", videoFile("x".repeat(1025)));

    const response = await app.inject({ method: "POST", url: "/upload", payload: form as never });

    expect(response.statusCode).toBe(413);
    expect(response.body).toBe('{"message":"too large"}');
  });
});
