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
SELECT lower(hex(randomblob(16))), e."tenantId", e."id", trim(candidate.value), lower(trim(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(candidate.value, char(9), ' '), char(10), ' '), char(13), ' '), '  ', ' '), '  ', ' '), '  ', ' '), '  ', ' '), '  ', ' '), '  ', ' '), '  ', ' ')))
FROM "SchoolEntity" e, (
  SELECT e2."id" AS entity_id, j.value AS value FROM "SchoolEntity" e2, json_each(e2."aliases") j WHERE j.type = 'text'
  UNION ALL SELECT "id", "name" FROM "SchoolEntity"
) candidate
WHERE candidate.entity_id = e."id" AND trim(candidate.value) <> ''
ON CONFLICT ("tenantId", "entityId", "normalized") DO NOTHING;
