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
SELECT lower(hex(randomblob(16))), e."tenantId", e."id", trim(j.value), lower(trim(j.value))
FROM "SchoolEntity" e, json_each(e."aliases") j
WHERE j.type = 'text' AND trim(j.value) <> ''
ON CONFLICT ("tenantId", "entityId", "normalized") DO NOTHING;
