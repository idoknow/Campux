import { Prisma } from "@campux/db";
import { prisma } from "./prisma";

type MetadataClient = typeof prisma | Prisma.TransactionClient;

export const defaultPendingPostLimit = 1;
export const maxPendingPostLimit = 50;
export const pendingPostLimitMetadataKey = "pending_post_limit";

export function normalizePendingPostLimit(value: unknown) {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : defaultPendingPostLimit;
  if (!Number.isFinite(numeric)) {
    return defaultPendingPostLimit;
  }
  return Math.max(0, Math.min(maxPendingPostLimit, Math.floor(numeric)));
}

export async function readTenantPendingPostLimit(client: MetadataClient, tenantId: string) {
  const entry = await client.tenantMetadata.findUnique({
    where: {
      tenantId_key: {
        tenantId,
        key: pendingPostLimitMetadataKey,
      },
    },
    select: {
      value: true,
    },
  });

  return normalizePendingPostLimit(entry?.value);
}
