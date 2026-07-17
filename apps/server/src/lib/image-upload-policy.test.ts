import { describe, expect, test } from "bun:test";
import {
  defaultImageMaxSizeMb,
  imageUploadSourceHardMaxSizeMb,
  maxImageMaxSizeMb,
  minImageMaxSizeMb,
  normalizeImageMaxSizeMb,
  resolveImageUploadLimits,
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

  test("rejects an image that is still over the tenant limit after compression", () => {
    expect(validateProcessedImageSize(8 * 1024 * 1024, 8)).toEqual({ ok: true });
    expect(validateProcessedImageSize(8 * 1024 * 1024 + 1, 8)).toEqual({
      ok: false,
      status: 413,
      message: "图片处理后仍超过 8MB 限制",
    });
  });
});
