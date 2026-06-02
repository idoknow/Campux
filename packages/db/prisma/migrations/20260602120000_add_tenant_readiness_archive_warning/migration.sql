-- Tenant readiness + auto-archive warning tracking
ALTER TABLE "Tenant"
  ADD COLUMN "readyAt" TIMESTAMP(3),
  ADD COLUMN "archiveWarningAt" TIMESTAMP(3);

-- Backfill: any tenant whose bot has already connected counts as ready, using
-- the earliest bot lastSeenAt as a best-effort readiness timestamp.
UPDATE "Tenant" t
SET "readyAt" = sub."firstSeenAt"
FROM (
  SELECT "tenantId", MIN("lastSeenAt") AS "firstSeenAt"
  FROM "BotAccount"
  WHERE "lastSeenAt" IS NOT NULL
  GROUP BY "tenantId"
) sub
WHERE t."id" = sub."tenantId" AND t."readyAt" IS NULL;
