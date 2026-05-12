import type { Tenant, TenantMembership, User } from "@campux/db";

export function toTenantSummary(
  tenant: Tenant & {
    _count?: {
      botAccounts?: number;
      posts?: number;
    };
  },
) {
  return {
    id: tenant.id,
    slug: tenant.slug,
    name: tenant.name,
    status: tenant.status,
    themeColor: tenant.themeColor,
    botAccountCount: tenant._count?.botAccounts ?? 0,
    pendingPostCount: tenant._count?.posts ?? 0,
  };
}

export function toPublicUser(user: Pick<User, "id" | "qqUin" | "displayName" | "systemRole">) {
  return {
    id: user.id,
    qqUin: user.qqUin.toString(),
    displayName: user.displayName,
    systemRole: user.systemRole,
  };
}

export function toMembership(
  membership: TenantMembership & {
    tenant: Tenant & {
      _count?: {
        botAccounts?: number;
        posts?: number;
      };
    };
  },
) {
  return {
    id: membership.id,
    role: membership.role,
    tenant: toTenantSummary(membership.tenant),
  };
}
