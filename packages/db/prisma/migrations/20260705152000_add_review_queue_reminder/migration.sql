ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "reviewQueueReminderSentAt" TIMESTAMP(3);

ALTER TABLE "BotAccount" ADD COLUMN IF NOT EXISTS "reviewQueueAutoReminderEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "BotAccount" ADD COLUMN IF NOT EXISTS "reviewQueueReminderThresholdHours" INTEGER NOT NULL DEFAULT 6;

CREATE INDEX IF NOT EXISTS "Post_tenantId_status_reviewQueueReminderSentAt_idx" ON "Post"("tenantId", "status", "reviewQueueReminderSentAt");
