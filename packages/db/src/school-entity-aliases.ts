import { randomUUID } from "node:crypto";

/** Fold alias text consistently for tenant-scoped indexed lookup. */
export function normalizeSchoolEntityAlias(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("und").replace(/\s+/gu, " ");
}

export interface SchoolEntityAliasTransaction {
  schoolEntityAlias: {
    deleteMany(args: { where: { tenantId: string; entityId: string } }): Promise<unknown>;
    createMany(args: { data: Array<{ id: string; tenantId: string; entityId: string; value: string; normalized: string }> }): Promise<unknown>;
  };
}

/** Replace an entity's alias rows atomically using the caller's Prisma transaction client. */
export async function syncSchoolEntityAliases(
  tx: SchoolEntityAliasTransaction,
  tenantId: string,
  entityId: string,
  aliases: readonly string[],
): Promise<void> {
  const seen = new Set<string>();
  const data = aliases.flatMap((value) => {
    const normalized = normalizeSchoolEntityAlias(value);
    if (!normalized || seen.has(normalized)) return [];
    seen.add(normalized);
    return [{ id: randomUUID(), tenantId, entityId, value: value.trim(), normalized }];
  });
  await tx.schoolEntityAlias.deleteMany({ where: { tenantId, entityId } });
  if (data.length) await tx.schoolEntityAlias.createMany({ data });
}

/** Produce de-duplicated alias rows from the legacy JSON field for a backfill. */
export function schoolEntityAliasRows(entities: readonly { id: string; tenantId: string; aliases: unknown }[]) {
  return entities.flatMap((entity) => {
    let aliases: unknown = entity.aliases;
    if (typeof aliases === "string") {
      try { aliases = JSON.parse(aliases); } catch { aliases = []; }
    }
    if (!Array.isArray(aliases)) return [];
    const seen = new Set<string>();
    return aliases.flatMap((candidate) => {
      if (typeof candidate !== "string") return [];
      const normalized = normalizeSchoolEntityAlias(candidate);
      if (!normalized || seen.has(normalized)) return [];
      seen.add(normalized);
      return [{ id: randomUUID(), tenantId: entity.tenantId, entityId: entity.id, value: candidate.trim(), normalized }];
    });
  });
}
