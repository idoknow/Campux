import { describe, expect, test } from "bun:test";
import { buildAuditLogWhere, canReadAuditLogTenant } from "./system";

describe("审计日志租户筛选", () => {
  test("未选租户时只按可管理范围收敛", () => {
    expect(buildAuditLogWhere({ manageableTenantIds: null })).toEqual({});
    expect(buildAuditLogWhere({ manageableTenantIds: ["a", "b"] })).toEqual({ tenantId: { in: ["a", "b"] } });
  });

  test("选了租户时按该租户过滤，并保留平台权限范围", () => {
    expect(buildAuditLogWhere({ manageableTenantIds: null, tenantId: "t1" })).toEqual({ tenantId: "t1" });
    expect(buildAuditLogWhere({ manageableTenantIds: ["t1", "t2"], tenantId: "t1" })).toEqual({
      tenantId: "t1",
    });
  });

  test("无权查看非可管理租户，平台管理员不受限", () => {
    expect(canReadAuditLogTenant({ manageableTenantIds: ["t1"], tenantId: "t2" })).toBe(false);
    expect(canReadAuditLogTenant({ manageableTenantIds: ["t1"], tenantId: "t1" })).toBe(true);
    expect(canReadAuditLogTenant({ manageableTenantIds: null, tenantId: "t9" })).toBe(true);
    expect(canReadAuditLogTenant({ manageableTenantIds: ["t1"] })).toBe(true);
  });
});
