CREATE UNIQUE INDEX "SchoolEntity_tenantId_id_key" ON "SchoolEntity"("tenantId", "id");
CREATE TABLE "SchoolEntityAlias" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "normalized" TEXT NOT NULL,
  CONSTRAINT "SchoolEntityAlias_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SchoolEntityAlias_tenantId_entityId_fkey" FOREIGN KEY ("tenantId", "entityId") REFERENCES "SchoolEntity"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SchoolEntityAlias_tenantId_entityId_normalized_key" ON "SchoolEntityAlias"("tenantId", "entityId", "normalized");
CREATE INDEX "SchoolEntityAlias_tenantId_normalized_idx" ON "SchoolEntityAlias"("tenantId", "normalized");
INSERT INTO "SchoolEntityAlias" ("id", "tenantId", "entityId", "value", "normalized")
SELECT gen_random_uuid()::text, e."tenantId", e."id", trim(alias_value), lower(regexp_replace(trim(alias_value), '[[:space:]]+', ' ', 'g'))
FROM "SchoolEntity" e
CROSS JOIN LATERAL (
  SELECT jsonb_array_elements_text(e."aliases") AS alias_value
  UNION ALL SELECT e."name"
) aliases(alias_value)
WHERE trim(alias_value) <> ''
ON CONFLICT ("tenantId", "entityId", "normalized") DO NOTHING;
