import type { TenantRole } from "@prisma/client";

export function membershipRoleUpdateForSeed(role: TenantRole): { role?: TenantRole } {
  return role === "admin" ? { role } : {};
}
