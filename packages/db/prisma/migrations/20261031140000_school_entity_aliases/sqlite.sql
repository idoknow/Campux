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
WITH RECURSIVE candidates(entity_id, value) AS (
  SELECT e2."id" AS entity_id, j.value AS value FROM "SchoolEntity" e2, json_each(e2."aliases") j WHERE j.type = 'text'
  UNION ALL SELECT "id", "name" FROM "SchoolEntity"
) , normalized(entity_id, value, normalized) AS (
  SELECT entity_id, trim(value), lower(trim(replace(replace(replace(value, char(9), ' '), char(10), ' '), char(13), ' ')))
  FROM candidates WHERE trim(value) <> ''
  UNION ALL
  SELECT entity_id, value, replace(normalized, '  ', ' ')
  FROM normalized WHERE instr(normalized, '  ') > 0
)
INSERT INTO "SchoolEntityAlias" ("id", "tenantId", "entityId", "value", "normalized")
SELECT lower(hex(randomblob(16))), e."tenantId", e."id", n.value, n.normalized
FROM "SchoolEntity" e JOIN normalized n ON n.entity_id = e."id"
WHERE instr(n.normalized, '  ') = 0
ON CONFLICT ("tenantId", "entityId", "normalized") DO NOTHING;
