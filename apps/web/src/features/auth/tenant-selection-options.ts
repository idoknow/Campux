import type { TenantSummary } from "@campux/domain";
import type { AuthenticatedMe, Membership, TenantRole } from "@/types/app";

export type TenantSelectionOption = {
  key: string;
  tenantId: string;
  tenant: TenantSummary;
  role: TenantRole;
  syntheticSystemAccess: boolean;
};

export function getTenantSelectionOptions(me: AuthenticatedMe): TenantSelectionOption[] {
  const visibleMemberships = me.memberships.filter((membership) => membership.tenant.status !== "archived");
  const realOptions = visibleMemberships.map((membership) => toMembershipOption(membership));
  if (me.user.systemRole !== "system_operator") {
    return realOptions;
  }

  const realTenantIds = new Set(visibleMemberships.map((membership) => membership.tenant.id));
  const syntheticOptions = (me.systemAccessibleTenants ?? [])
    .filter((tenant) => tenant.status !== "archived")
    .filter((tenant) => !realTenantIds.has(tenant.id))
    .map((tenant) => ({
      key: `system:${tenant.id}`,
      tenantId: tenant.id,
      tenant,
      role: "admin" as const,
      syntheticSystemAccess: true,
    }));

  return [...realOptions, ...syntheticOptions];
}

function toMembershipOption(membership: Membership): TenantSelectionOption {
  return {
    key: membership.id,
    tenantId: membership.tenant.id,
    tenant: membership.tenant,
    role: membership.role,
    syntheticSystemAccess: false,
  };
}
