import { describe, expect, test } from "bun:test";
import { resolveEffectiveTenantMembership } from "./tenant-access";

const userId = "user-1";
const tenantId = "tenant-1";

describe("resolveEffectiveTenantMembership", () => {
  test("uses a real tenant membership when the user has one", () => {
    const membership = {
      id: "membership-1",
      tenantId,
      userId,
      role: "reviewer" as const,
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
    };

    expect(resolveEffectiveTenantMembership({ userId, systemRole: null, tenantId, memberships: [membership] })).toBe(membership);
  });

  test("gives system operators synthetic admin access to any tenant without adding a real membership", () => {
    expect(resolveEffectiveTenantMembership({ userId, systemRole: "system_operator", tenantId, memberships: [] })).toEqual({
      id: `system-operator:${tenantId}`,
      tenantId,
      userId,
      role: "admin",
      createdAt: new Date(0),
      synthetic: true,
    });
  });

  test("does not synthesize tenant access for operations admins", () => {
    expect(resolveEffectiveTenantMembership({ userId, systemRole: "operations_admin", tenantId, memberships: [] })).toBeNull();
  });
});
