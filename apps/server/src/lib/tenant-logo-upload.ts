const TENANT_LOGO_MAX_BYTES = 5 * 1024 * 1024;

const TENANT_LOGO_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/heif",
]);

type TenantLogoUploadInput = {
  contentType: string;
  size: number;
};

type TenantLogoUploadResult =
  | { ok: true }
  | { ok: false; status: 413 | 415; message: string };

export function tenantLogoMaxBytes() {
  return TENANT_LOGO_MAX_BYTES;
}

export function assertTenantLogoUpload(input: TenantLogoUploadInput): TenantLogoUploadResult {
  if (!TENANT_LOGO_IMAGE_MIME_TYPES.has(input.contentType)) {
    return {
      ok: false,
      status: 415,
      message: "仅支持上传图片格式的 Logo",
    };
  }

  if (input.size > TENANT_LOGO_MAX_BYTES) {
    return {
      ok: false,
      status: 413,
      message: "Logo 图片不能超过 5MB",
    };
  }

  return { ok: true };
}
