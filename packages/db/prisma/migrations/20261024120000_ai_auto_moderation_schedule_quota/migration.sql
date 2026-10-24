-- Durable auto-moderation scheduling.
-- Guard each object independently: deployments may have provisioned only part of
-- this migration before recording it as applied. Existing incompatible objects
-- deliberately fail rather than being silently accepted.
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'AiFeedback' AND column_name = 'categories') THEN
        ALTER TABLE "AiFeedback" ADD COLUMN "categories" JSONB NOT NULL DEFAULT '[]';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'PostAiAnalysis' AND column_name = 'autoDecision') THEN
        ALTER TABLE "PostAiAnalysis" ADD COLUMN "autoDecision" TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'PostAiAnalysis' AND column_name = 'autoDecisionReason') THEN
        ALTER TABLE "PostAiAnalysis" ADD COLUMN "autoDecisionReason" TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'PostAiAnalysis' AND column_name = 'autoDecisionAt') THEN
        ALTER TABLE "PostAiAnalysis" ADD COLUMN "autoDecisionAt" TIMESTAMP(3);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'PostAiAnalysis' AND column_name = 'autoDecisionExecuteAfter') THEN
        ALTER TABLE "PostAiAnalysis" ADD COLUMN "autoDecisionExecuteAfter" TIMESTAMP(3);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'PostAiAnalysis' AND column_name = 'autoDecisionCancelledAt') THEN
        ALTER TABLE "PostAiAnalysis" ADD COLUMN "autoDecisionCancelledAt" TIMESTAMP(3);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'PostAiAnalysis' AND column_name = 'autoDecisionExecutingAt') THEN
        ALTER TABLE "PostAiAnalysis" ADD COLUMN "autoDecisionExecutingAt" TIMESTAMP(3);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'PostAiAnalysis' AND column_name = 'autoDecisionLeaseAt') THEN
        ALTER TABLE "PostAiAnalysis" ADD COLUMN "autoDecisionLeaseAt" TIMESTAMP(3);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "PostAiAnalysis_tenantId_autoDecision_autoDecisionExecuteAfter_idx"
    ON "PostAiAnalysis"("tenantId", "autoDecision", "autoDecisionExecuteAfter");
