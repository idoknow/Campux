import { describe, expect, test } from "bun:test";
import { assertTenantLogoUpload } from "./tenant-logo-upload";

describe("assertTenantLogoUpload", () => {
  test("accepts supported image mime types under the size cap", () => {
    expect(assertTenantLogoUpload({ contentType: "image/png", size: 2 * 1024 * 1024 })).toEqual({ ok: true });
  });

  test("rejects non-image uploads", () => {
    expect(assertTenantLogoUpload({ contentType: "application/pdf", size: 1024 })).toEqual({
      ok: false,
      status: 415,
      message: "仅支持上传图片格式的 Logo",
    });
  });

  test("rejects logo images larger than five megabytes", () => {
    expect(assertTenantLogoUpload({ contentType: "image/jpeg", size: 5 * 1024 * 1024 + 1 })).toEqual({
      ok: false,
      status: 413,
      message: "Logo 图片不能超过 5MB",
    });
  });
});
