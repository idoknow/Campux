import { describe, expect, test } from "bun:test";
import { getSelectedImageRejection, normalizeImageMaxSizeDraft } from "./image-upload-policy";

describe("getSelectedImageRejection", () => {
  test("uses the tenant limit immediately when automatic compression is disabled", () => {
    expect(getSelectedImageRejection({
      fileName: "poster.png",
      sizeBytes: 6 * 1024 * 1024,
      maxSizeMb: 5,
      compressionEnabled: false,
    })).toBe("poster.png 超过 5MB 限制");
  });

  test("allows an oversized original to reach server-side compression", () => {
    expect(getSelectedImageRejection({
      fileName: "camera.jpg",
      sizeBytes: 30 * 1024 * 1024,
      maxSizeMb: 5,
      compressionEnabled: true,
    })).toBeNull();
  });

  test("still protects the service from originals above the hard upload cap", () => {
    expect(getSelectedImageRejection({
      fileName: "huge.jpg",
      sizeBytes: 50 * 1024 * 1024 + 1,
      maxSizeMb: 10,
      compressionEnabled: true,
    })).toBe("huge.jpg 原图超过 50MB，无法自动压缩");
  });
});

describe("normalizeImageMaxSizeDraft", () => {
  test("keeps the previous setting while the input is temporarily blank", () => {
    expect(normalizeImageMaxSizeDraft("", 10)).toBe(10);
    expect(normalizeImageMaxSizeDraft("   ", 20)).toBe(20);
    expect(normalizeImageMaxSizeDraft("not-a-number", 20)).toBe(20);
  });

  test("normalizes a completed draft to an integer in the shared range", () => {
    expect(normalizeImageMaxSizeDraft("5.9", 10)).toBe(5);
    expect(normalizeImageMaxSizeDraft("999", 10)).toBe(50);
  });
});
