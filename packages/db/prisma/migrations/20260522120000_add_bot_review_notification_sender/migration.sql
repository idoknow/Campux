ALTER TABLE "BotAccount"
ADD COLUMN "reviewNotificationEnabled" BOOLEAN NOT NULL DEFAULT false;

WITH ranked_review_bots AS (
  SELECT
    id,
    ROW_NUMBER() OVER (PARTITION BY "tenantId" ORDER BY "createdAt" ASC, id ASC) AS rn
  FROM "BotAccount"
  WHERE enabled = true AND "reviewGroupId" IS NOT NULL
)
UPDATE "BotAccount" AS bot
SET "reviewNotificationEnabled" = true
FROM ranked_review_bots AS ranked
WHERE bot.id = ranked.id AND ranked.rn = 1;

CREATE UNIQUE INDEX "BotAccount_one_review_notification_sender_per_tenant"
ON "BotAccount"("tenantId")
WHERE "reviewNotificationEnabled" = true;
