import { describe, expect, test } from "bun:test";
import {
  buildVideoGifFfmpegArgs,
  createConvertedGifClaim,
  defaultImageMaxSizeMb,
  detectRasterImageMime,
  hasGifSignature,
  imageUploadSourceHardMaxSizeMb,
  maxImageMaxSizeMb,
  minImageMaxSizeMb,
  buildImageSourceSizeErrorMessage,
  imageStorageHardMaxBytes,
  isAllowedPostImageMime,
  isTrustedConvertedGifUrl,
  normalizeImageMaxSizeMb,
  readResponseBufferWithLimit,
  restoreAttachmentOrder,
  resolveImageUploadLimits,
  ResponseBodyTooLargeError,
  shouldExposeRemoteGifIndexes,
  validateConvertedVideoGifSize,
  validateConvertedGifClaim,
  validateProcessedImageSize,
} from "./image-upload-policy";

describe("tenant image upload policy", () => {
  test("normalizes tenant limits to a safe 1-50MB range with a 10MB default", () => {
    expect(normalizeImageMaxSizeMb(undefined)).toBe(defaultImageMaxSizeMb);
    expect(normalizeImageMaxSizeMb("20")).toBe(20);
    expect(normalizeImageMaxSizeMb(0)).toBe(minImageMaxSizeMb);
    expect(normalizeImageMaxSizeMb(999)).toBe(maxImageMaxSizeMb);
    expect(normalizeImageMaxSizeMb(Number.NaN)).toBe(defaultImageMaxSizeMb);
  });

  test("accepts a larger source only when compression is enabled", () => {
    expect(resolveImageUploadLimits({ maxSizeMb: 8, compressionEnabled: false })).toEqual({
      sourceMaxBytes: 8 * 1024 * 1024,
      processedMaxBytes: 8 * 1024 * 1024,
    });
    expect(resolveImageUploadLimits({ maxSizeMb: 8, compressionEnabled: true })).toEqual({
      sourceMaxBytes: imageUploadSourceHardMaxSizeMb * 1024 * 1024,
      processedMaxBytes: 8 * 1024 * 1024,
    });
  });

  test("keeps source errors and publisher safety limits aligned with the shared policy", () => {
    expect(buildImageSourceSizeErrorMessage({ compressionEnabled: true, maxSizeMb: 5 }))
      .toBe("图片原图不能超过 50MB，无法自动压缩");
    expect(buildImageSourceSizeErrorMessage({ compressionEnabled: false, maxSizeMb: 5.9 }))
      .toBe("图片不能超过 5MB");
    expect(imageStorageHardMaxBytes).toBe(50 * 1024 * 1024);
  });

  test("rejects an image that is still over the tenant limit after compression", () => {
    expect(validateProcessedImageSize(8 * 1024 * 1024, 8)).toEqual({ ok: true });
    expect(validateProcessedImageSize(8 * 1024 * 1024 + 1, 8)).toEqual({
      ok: false,
      status: 413,
      message: "图片处理后仍超过 8MB 限制",
    });
  });

  test("keeps converted video GIFs on the stable storage cap instead of the tenant image limit", () => {
    expect(validateConvertedVideoGifSize(12 * 1024 * 1024)).toEqual({ ok: true });
    expect(validateConvertedVideoGifSize(imageStorageHardMaxBytes + 1)).toEqual({
      ok: false,
      status: 413,
      message: "视频转换后的 GIF 不能超过 50MB",
    });
  });

  test("only grants converted-video semantics to the trusted HTTPS converter origin", () => {
    expect(isTrustedConvertedGifUrl("https://cloudflarecnimg.scdn.io/path/video.gif")).toBe(true);
    expect(isTrustedConvertedGifUrl("http://cloudflarecnimg.scdn.io/path/video.gif")).toBe(false);
    expect(isTrustedConvertedGifUrl("https://cloudflarecnimg.scdn.io.evil.example/video.gif")).toBe(false);
    expect(isTrustedConvertedGifUrl("https://user:pass@cloudflarecnimg.scdn.io/video.gif")).toBe(false);
    expect(isTrustedConvertedGifUrl("https://example.com/video.gif")).toBe(false);
  });

  test("binds converted GIF claims to server secret, URL, tenant, user, session, and expiry", () => {
    const now = new Date("2026-07-17T12:00:00.000Z").getTime();
    const input = {
      url: "https://cloudflarecnimg.scdn.io/i/video.gif",
      tenantId: "tenant-a",
      userId: "user-a",
      sessionTokenHash: "session-hash-a",
      signingSecret: "server-only-signing-secret",
    };
    const proof = createConvertedGifClaim({ ...input, now, nonce: "deterministic_nonce_123" });

    expect(validateConvertedGifClaim({ ...input, proof, now: now + 1 })).toBe(true);
    expect(createConvertedGifClaim({ ...input, now })).not.toBe(createConvertedGifClaim({ ...input, now }));
    expect(validateConvertedGifClaim({
      ...input,
      proof: proof.replace("deterministic_nonce_123", "tampered_nonce_value_12"),
      now: now + 1,
    })).toBe(false);
    expect(validateConvertedGifClaim({ ...input, signingSecret: "attacker-derived-session-hash", proof, now: now + 1 })).toBe(false);
    expect(validateConvertedGifClaim({ ...input, url: `${input.url}?other=1`, proof, now: now + 1 })).toBe(false);
    expect(validateConvertedGifClaim({ ...input, tenantId: "tenant-b", proof, now: now + 1 })).toBe(false);
    expect(validateConvertedGifClaim({ ...input, userId: "user-b", proof, now: now + 1 })).toBe(false);
    expect(validateConvertedGifClaim({ ...input, sessionTokenHash: "session-hash-b", proof, now: now + 1 })).toBe(false);
    expect(validateConvertedGifClaim({ ...input, proof, now: now + 15 * 60 * 1000 + 1 })).toBe(false);
  });

  test("requires downloaded converter output to have a GIF signature", () => {
    expect(hasGifSignature(Buffer.from("GIF87a payload"))).toBe(true);
    expect(hasGifSignature(Buffer.from("GIF89a payload"))).toBe(true);
    expect(hasGifSignature(Buffer.from("not-a-gif"))).toBe(false);
  });

  test("caps server-side GIF conversion before ffmpeg writes the output", () => {
    const args = buildVideoGifFfmpegArgs("input.mp4", "output.gif");
    expect(args[args.indexOf("-fs") + 1]).toBe(String(imageStorageHardMaxBytes));
    expect(args.join(" ")).toContain("min(30");
    expect(args.join(" ")).toContain("1920");
  });

  test("restores interleaved local and remote attachment order", () => {
    expect(restoreAttachmentOrder(
      ["image-second", "image-fourth"],
      ["video-first", "video-third"],
      ["remote", "local", "remote", "local"],
    )).toEqual(["video-first", "image-second", "video-third", "image-fourth"]);
    expect(restoreAttachmentOrder(
      ["only-local"],
      ["only-remote"],
      ["local"],
    )).toBeNull();
  });

  test("exposes converted-GIF indexes only for permanent failures", () => {
    expect(shouldExposeRemoteGifIndexes(undefined)).toBe(false);
    expect(shouldExposeRemoteGifIndexes(false)).toBe(false);
    expect(shouldExposeRemoteGifIndexes(true)).toBe(true);
  });

  test("reads remote bodies without crossing the configured memory cap", async () => {
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        controller.enqueue(new Uint8Array([3, 4]));
        controller.close();
      },
    }));
    expect([...await readResponseBufferWithLimit(response, 4)]).toEqual([1, 2, 3, 4]);
  });

  test("rejects remote bodies from content-length or streamed bytes before full buffering", async () => {
    let declaredBodyCancelled = false;
    const declared = new Response(new ReadableStream<Uint8Array>({
      cancel() {
        declaredBodyCancelled = true;
      },
    }), { headers: { "content-length": "6" } });
    await expect(readResponseBufferWithLimit(declared, 5)).rejects.toBeInstanceOf(ResponseBodyTooLargeError);
    expect(declaredBodyCancelled).toBe(true);

    const streamed = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.enqueue(new Uint8Array([4, 5, 6]));
        controller.close();
      },
    }));
    await expect(readResponseBufferWithLimit(streamed, 5)).rejects.toBeInstanceOf(ResponseBodyTooLargeError);
  });
});

describe("post image mime allowlist", () => {
  test("拒绝 SVG（可执行文档）", () => {
    expect(isAllowedPostImageMime("image/svg+xml")).toBe(false);
    expect(isAllowedPostImageMime("image/svg")).toBe(false);
  });

  test("接受常见位图格式", () => {
    for (const mime of ["image/jpeg", "image/png", "image/gif", "image/webp", "image/heic", "image/heif"]) {
      expect(isAllowedPostImageMime(mime)).toBe(true);
    }
  });
});

describe("detectRasterImageMime", () => {
  const bytesOf = (text: string) => new Uint8Array([...text].map((char) => char.charCodeAt(0)));

  test("识别常见位图签名", () => {
    expect(detectRasterImageMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(detectRasterImageMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(detectRasterImageMime(bytesOf("GIF89a......"))).toBe("image/gif");
    expect(detectRasterImageMime(bytesOf("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
    expect(detectRasterImageMime(bytesOf("BM\0\0\0\0"))).toBe("image/bmp");
    expect(detectRasterImageMime(bytesOf("\0\0\0\u0018ftypheic"))).toBe("image/heic");
    expect(detectRasterImageMime(bytesOf("\0\0\0\u0018ftypavif"))).toBe("image/avif");
  });

  test("SVG / HTML / 空内容不当作位图", () => {
    expect(detectRasterImageMime(bytesOf("<svg xmlns=\"http://www.w3.org/2000/svg\"><script>alert(1)</script></svg>"))).toBeNull();
    expect(detectRasterImageMime(bytesOf("<html><body>hi</body></html>"))).toBeNull();
    expect(detectRasterImageMime(new Uint8Array([]))).toBeNull();
  });
});
