ALTER TABLE "Post"
  ADD COLUMN "recallIgnored" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "recallIgnoredAt" TIMESTAMP(3);

CREATE INDEX "Post_tenantId_status_recallIgnored_createdAt_idx"
  ON "Post"("tenantId", "status", "recallIgnored", "createdAt");
