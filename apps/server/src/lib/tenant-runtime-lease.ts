import type { Prisma } from "@campux/db";


type TenantRuntimeLeaseClient = {
  $transaction<Result>(
    operation: (transaction: Prisma.TransactionClient) => Promise<Result>,
    options?: { maxWait?: number; timeout?: number },
  ): Promise<Result>;
};

export type ActiveTenantLeaseResult<Result> =
  | { active: false }
  | { active: true; value: Result };

export async function lockTenantRuntime(
  transaction: Prisma.TransactionClient,
  tenantId: string,
) {
  const locked = await transaction.$executeRaw`
    UPDATE "Tenant"
    SET "status" = "status"
    WHERE "id" = ${tenantId}
  `;
  if (locked !== 1) {
    return null;
  }
  return transaction.tenant.findUnique({
    where: { id: tenantId },
    select: { status: true },
  });
}

export async function lockActiveTenantRuntime(
  transaction: Prisma.TransactionClient,
  tenantId: string,
) {
  const tenant = await lockTenantRuntime(transaction, tenantId);
  return tenant?.status === "active";
}

/**
 * Serializes an irreversible tenant side effect with status transitions.
 *
 * The no-op UPDATE obtains the same durable tenant-row write lock that a
 * pause/archive update needs. If egress wins, the status transition waits for
 * it to finish; if the transition wins, this transaction sees the inactive
 * status and skips egress. Database writes performed by the operation must use
 * the supplied transaction client so the lock and mutation share one session.
 */
export async function runWithActiveTenantLease<Result>(
  client: TenantRuntimeLeaseClient,
  tenantId: string,
  operation: (transaction: Prisma.TransactionClient) => Promise<Result>,
): Promise<ActiveTenantLeaseResult<Result>> {
  return client.$transaction(async (transaction) => {
    if (!await lockActiveTenantRuntime(transaction, tenantId)) {
      return { active: false } as const;
    }
    return { active: true, value: await operation(transaction) } as const;
  }, { maxWait: 15_000, timeout: 180_000 });
}
