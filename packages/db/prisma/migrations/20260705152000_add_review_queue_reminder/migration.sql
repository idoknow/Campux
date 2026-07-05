ALTER TABLE "Post" ADD COLUMN "reviewQueueReminderSentAt" TIMESTAMP(3);

ALTER TABLE "BotAccount" ADD COLUMN "reviewQueueAutoReminderEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "BotAccount" ADD COLUMN "reviewQueueReminderThresholdHours" INTEGER NOT NULL DEFAULT 6;

CREATE INDEX "Post_tenantId_status_reviewQueueReminderSentAt_idx" ON "Post"("tenantId", "status", "reviewQueueReminderSentAt");
