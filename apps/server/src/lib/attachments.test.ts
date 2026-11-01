import { describe, expect, test } from "bun:test";
import { decideUploadAccess, extractPostImageKey, parseTenantIdFromUploadKey } from "./attachments";

const tenantId = "e7b86499-dfa8-4130-8356-76b0c4ccbf19";
const key = `tenants/${tenantId}/uploads/5eb21d73-0843-4926-8ca5-5a5d1a676218.png`;

describe("extractPostImageKey", () => {
  test("解析站内上传链接", () => {
    expect(extractPostImageKey(`/api/uploads/post-image?key=${encodeURIComponent(key)}`)).toBe(key);
  });

  test("允许带 origin 的绝对链接", () => {
    expect(extractPostImageKey(`https://admin.campux.top/api/uploads/post-image?key=${encodeURIComponent(key)}`)).toBe(key);
  });

  test("外链返回 null", () => {
    expect(extractPostImageKey("https://cdn.example.com/logo.png")).toBeNull();
  });

  test("空值与空白返回 null", () => {
    expect(extractPostImageKey("")).toBeNull();
    expect(extractPostImageKey("   ")).toBeNull();
    expect(extractPostImageKey(null)).toBeNull();
    expect(extractPostImageKey(undefined)).toBeNull();
  });

  test("站内相对路径（非上传接口）返回 null", () => {
    expect(extractPostImageKey("/logo.svg")).toBeNull();
  });

  test("缺少 key 参数返回 null", () => {
    expect(extractPostImageKey("/api/uploads/post-image")).toBeNull();
  });

  test("base64 内联数据返回 null", () => {
    expect(extractPostImageKey("/api/uploads/post-image?key=base64://abcdef")).toBeNull();
  });
});

describe("decideUploadAccess", () => {
  test("未登录读取该墙 Logo → 放行且公开缓存", () => {
    expect(decideUploadAccess({ key, tenantId: null, logoKey: key })).toEqual({ allow: true, cacheControl: "public, max-age=300" });
  });

  test("未登录读取其它上传文件 → 401", () => {
    expect(decideUploadAccess({ key, tenantId: null, logoKey: null })).toEqual({ allow: false, status: 401, message: "请先登录" });
  });

  test("未登录时别的墙的 Logo 也不放行", () => {
    const otherKey = `tenants/other/uploads/x.png`;
    expect(decideUploadAccess({ key: otherKey, tenantId: null, logoKey: key })).toEqual({
      allow: false,
      status: 401,
      message: "请先登录",
    });
  });

  test("登录后读取本墙上传 → 放行且私有缓存", () => {
    expect(decideUploadAccess({ key, tenantId, logoKey: null })).toEqual({ allow: true, cacheControl: "private, max-age=3600" });
  });

  test("登录后跨墙读取 → 403", () => {
    const otherTenant = "11111111-1111-1111-1111-111111111111";
    expect(decideUploadAccess({ key, tenantId: otherTenant, logoKey: null })).toEqual({
      allow: false,
      status: 403,
      message: "没有访问该图片的权限",
    });
  });

  test("登录后访问非上传目录 → 403", () => {
    expect(decideUploadAccess({ key: `tenants/${tenantId}/published/qq-forum/a.png`, tenantId, logoKey: null })).toEqual({
      allow: false,
      status: 403,
      message: "没有访问该图片的权限",
    });
  });
});

describe("parseTenantIdFromUploadKey", () => {
  test("uploads 目录", () => {
    expect(parseTenantIdFromUploadKey(key)).toBe(tenantId);
  });

  test("legacy 目录", () => {
    expect(parseTenantIdFromUploadKey(`tenants/${tenantId}/legacy/old.png`)).toBe(tenantId);
  });

  test("其它目录不当作上传 key", () => {
    expect(parseTenantIdFromUploadKey(`tenants/${tenantId}/published/qq-forum/a.png`)).toBeNull();
    expect(parseTenantIdFromUploadKey("logo.svg")).toBeNull();
    expect(parseTenantIdFromUploadKey("")).toBeNull();
  });
});
