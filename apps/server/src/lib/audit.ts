import type { Prisma } from "@campux/db";
import { prisma } from "./prisma";

export async function writeAuditLog({
  tenantId,
  actorId,
  action,
  targetType,
  targetId,
  detail,
}: {
  tenantId?: string | null;
  actorId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  detail?: unknown;
}) {
  const data = {
    tenantId: tenantId ?? null,
    actorId: actorId ?? null,
    action,
    targetType,
    targetId: targetId ?? null,
    ...(detail === undefined ? {} : { detail: toJsonValue(detail) }),
  };

  await prisma.auditLog.create({
    data,
  });
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  if (value === null) {
    return { value: null };
  }

  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
