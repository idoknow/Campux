import type { SystemRole, TenantRole } from "@campux/db";

export type TenantAccessMembership = {
  id: string;
  tenantId: string;
  userId: string;
  role: TenantRole;
  createdAt: Date;
};

export type SyntheticSystemOperatorMembership = TenantAccessMembership & {
  synthetic: true;
};

export function resolveEffectiveTenantMembership(options: {
  userId: string;
  systemRole: SystemRole | null;
  tenantId: string;
  memberships: TenantAccessMembership[];
}): TenantAccessMembership | SyntheticSystemOperatorMembership | null {
  // System operators always get synthetic admin access to any wall,
  // regardless of whether they have a real (possibly lower-role) membership.
  const synthetic = syntheticSystemOperatorMembership(options.userId, options.tenantId, options.systemRole);
  if (synthetic) {
    return synthetic;
  }
  return options.memberships.find((membership) => membership.tenantId === options.tenantId)
    ?? null;
}

export function syntheticSystemOperatorMembership(userId: string, tenantId: string, systemRole: SystemRole | null): SyntheticSystemOperatorMembership | null {
  if (systemRole !== "system_operator") {
    return null;
  }

  return {
    id: syntheticSystemOperatorMembershipId(tenantId),
    tenantId,
    userId,
    role: "admin",
    createdAt: new Date(0),
    synthetic: true,
  };
}

export function syntheticSystemOperatorMembershipId(tenantId: string) {
  return `system-operator:${tenantId}`;
}

export function isSyntheticSystemOperatorMembership(id: string) {
  return id.startsWith("system-operator:");
}
