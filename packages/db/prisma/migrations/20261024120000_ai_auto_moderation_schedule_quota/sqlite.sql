-- SQLite DDL reference for durable auto-moderation scheduling.
-- For upgrades, use the canonical application migration runner: it checks each
-- column before ALTER TABLE. SQLite does not support portable
-- ALTER TABLE ... ADD COLUMN IF NOT EXISTS, so this file alone cannot safely
-- resume a partially-applied set of column additions.

ALTER TABLE "AiFeedback" ADD COLUMN "categories" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "PostAiAnalysis" ADD COLUMN "autoDecision" TEXT;
ALTER TABLE "PostAiAnalysis" ADD COLUMN "autoDecisionReason" TEXT;
ALTER TABLE "PostAiAnalysis" ADD COLUMN "autoDecisionAt" DATETIME;
ALTER TABLE "PostAiAnalysis" ADD COLUMN "autoDecisionExecuteAfter" DATETIME;
ALTER TABLE "PostAiAnalysis" ADD COLUMN "autoDecisionCancelledAt" DATETIME;
ALTER TABLE "PostAiAnalysis" ADD COLUMN "autoDecisionExecutingAt" DATETIME;
ALTER TABLE "PostAiAnalysis" ADD COLUMN "autoDecisionLeaseAt" DATETIME;
ALTER TABLE "SchoolEntity" ADD COLUMN "sensitivity" TEXT NOT NULL DEFAULT 'normal';

CREATE INDEX IF NOT EXISTS "PostAiAnalysis_tenantId_autoDecision_autoDecisionExecuteAfter_idx"
    ON "PostAiAnalysis"("tenantId", "autoDecision", "autoDecisionExecuteAfter");
