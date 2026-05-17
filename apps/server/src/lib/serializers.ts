import type { Tenant, TenantMembership, User } from "@campux/db";

export function toTenantSummary(
  tenant: Tenant & {
    _count?: {
      botAccounts?: number;
      posts?: number;
    };
    metadata?: Array<{ key: string; value: unknown }>;
  },
) {
  const logoUrl = tenant.metadata?.find((entry) => entry.key === "logo_url" && typeof entry.value === "string")?.value;

  return {
    id: tenant.id,
    slug: tenant.slug,
    host: tenant.host,
    name: tenant.name,
    status: tenant.status,
    themeColor: tenant.themeColor,
    logoUrl: typeof logoUrl === "string" ? logoUrl : "",
    botAccountCount: tenant._count?.botAccounts ?? 0,
    pendingPostCount: tenant._count?.posts ?? 0,
  };
}

export function toPublicUser(user: Pick<User, "id" | "qqUin" | "email" | "displayName" | "systemRole" | "passwordChangeRequired">) {
  return {
    id: user.id,
    qqUin: user.qqUin.toString(),
    email: user.email,
    displayName: user.displayName,
    systemRole: user.systemRole,
    passwordChangeRequired: user.passwordChangeRequired,
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
