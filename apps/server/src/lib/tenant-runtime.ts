export type TenantRuntimeStatus = "active" | "paused" | "archived";

type TenantRuntimeClient = {
  tenant: {
    findFirst(args: {
      where: { id: string; status: "active" };
      select: { id: true };
    }): Promise<{ id: string } | null>;
  };
};

/** Shared Prisma relation filter for every tenant-scoped background scan. */
export const tenantRuntimeRelationFilter = { status: "active" as const };

export function isTenantRuntimeActiveStatus(status: TenantRuntimeStatus) {
  return status === "active";
}

/**
 * Fail-closed runtime gate used immediately before queued work and bot I/O.
 * Callers that already selected the tenant relation should prefer
 * tenantRuntimeRelationFilter so inactive rows never enter a scan at all.
 */
export async function isTenantRuntimeActive(client: TenantRuntimeClient, tenantId: string) {
  const tenant = await client.tenant.findFirst({
    where: {
      id: tenantId,
      status: "active",
    },
    select: { id: true },
  });
  return tenant !== null;
}
