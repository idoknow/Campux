import type { TenantRole } from "@prisma/client";

export function resolveMembershipRoleForSeed(
  currentRole: TenantRole | undefined,
  declaredRole: TenantRole,
): TenantRole {
  if (currentRole === "admin" && declaredRole !== "admin") {
    return "admin";
  }
  return declaredRole;
}
