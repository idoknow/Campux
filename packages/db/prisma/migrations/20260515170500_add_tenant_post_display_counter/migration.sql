ALTER TABLE "Tenant"
ADD COLUMN IF NOT EXISTS "nextPostDisplayId" INTEGER NOT NULL DEFAULT 1;

UPDATE "Tenant" AS tenant
SET "nextPostDisplayId" = COALESCE(post_max."maxDisplayId", 0) + 1
FROM (
  SELECT "tenantId", MAX("displayId") AS "maxDisplayId"
  FROM "Post"
  GROUP BY "tenantId"
) AS post_max
WHERE tenant."id" = post_max."tenantId";
