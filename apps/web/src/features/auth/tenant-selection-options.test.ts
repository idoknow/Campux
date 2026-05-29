import { describe, expect, it } from "bun:test";
import type { TenantSummary } from "@campux/domain";
import type { AuthenticatedMe, Membership } from "@/types/app";
import { getTenantSelectionOptions } from "./tenant-selection-options";

function tenant(overrides: Partial<TenantSummary> & Pick<TenantSummary, "id" | "name">): TenantSummary {
  return {
    id: overrides.id,
    name: overrides.name,
    slug: overrides.slug ?? overrides.id,
    host: overrides.host ?? null,
    status: overrides.status ?? "active",
    themeColor: overrides.themeColor ?? "#42a5f5",
    logoUrl: overrides.logoUrl ?? "",
    aiEnabled: overrides.aiEnabled ?? true,
    botAccountCount: overrides.botAccountCount ?? 0,
    pendingPostCount: overrides.pendingPostCount ?? 0,
  };
}

function membership(id: string, tenantSummary: TenantSummary, role: Membership["role"] = "reviewer"): Membership {
  return {
    id,
    role,
    tenant: tenantSummary,
  };
}

function me(overrides: Partial<AuthenticatedMe>): AuthenticatedMe {
  return {
    authenticated: true,
    user: {
      id: "user-1",
      qqUin: "10000",
      email: null,
      displayName: "运维",
      systemRole: null,
      passwordChangeRequired: false,
    },
    memberships: [],
    systemAccessibleTenants: [],
    currentTenant: null,
    currentMembership: null,
    activeBan: null,
    needsTenantSelection: false,
    hostLocked: false,
    ...overrides,
  };
}

describe("getTenantSelectionOptions", () => {
  it("shows real memberships for ordinary users", () => {
    const alpha = tenant({ id: "tenant-alpha", name: "Alpha 墙" });
    const options = getTenantSelectionOptions(
      me({
        memberships: [membership("membership-alpha", alpha, "admin")],
      }),
    );

    expect(options).toEqual([
      {
        key: "membership-alpha",
        tenantId: "tenant-alpha",
        tenant: alpha,
        role: "admin",
        syntheticSystemAccess: false,
      },
    ]);
  });

  it("lets system operators choose tenants without tenant memberships", () => {
    const alpha = tenant({ id: "tenant-alpha", name: "Alpha 墙" });
    const beta = tenant({ id: "tenant-beta", name: "Beta 墙" });
    const options = getTenantSelectionOptions(
      me({
        user: {
          id: "operator-1",
          qqUin: "10001",
          email: null,
          displayName: "系统运维",
          systemRole: "system_operator",
          passwordChangeRequired: false,
        },
        memberships: [],
        systemAccessibleTenants: [alpha, beta],
      }),
    );

    expect(options).toEqual([
      {
        key: "system:tenant-alpha",
        tenantId: "tenant-alpha",
        tenant: alpha,
        role: "admin",
        syntheticSystemAccess: true,
      },
      {
        key: "system:tenant-beta",
        tenantId: "tenant-beta",
        tenant: beta,
        role: "admin",
        syntheticSystemAccess: true,
      },
    ]);
  });

  it("keeps real membership labels when a system operator is already a tenant member", () => {
    const alpha = tenant({ id: "tenant-alpha", name: "Alpha 墙" });
    const beta = tenant({ id: "tenant-beta", name: "Beta 墙" });
    const options = getTenantSelectionOptions(
      me({
        user: {
          id: "operator-1",
          qqUin: "10001",
          email: null,
          displayName: "系统运维",
          systemRole: "system_operator",
          passwordChangeRequired: false,
        },
        memberships: [membership("membership-alpha", alpha, "reviewer")],
        systemAccessibleTenants: [alpha, beta],
      }),
    );

    expect(options).toEqual([
      {
        key: "membership-alpha",
        tenantId: "tenant-alpha",
        tenant: alpha,
        role: "reviewer",
        syntheticSystemAccess: false,
      },
      {
        key: "system:tenant-beta",
        tenantId: "tenant-beta",
        tenant: beta,
        role: "admin",
        syntheticSystemAccess: true,
      },
    ]);
  });
});
