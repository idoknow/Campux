ALTER TABLE "BotAccount" ADD COLUMN "platform" TEXT NOT NULL DEFAULT 'onebot';
ALTER TABLE "BotAccount" ADD COLUMN "officialAppId" TEXT;
ALTER TABLE "BotAccount" ADD COLUMN "officialAppSecret" JSONB;
CREATE UNIQUE INDEX "BotAccount_officialAppId_key" ON "BotAccount"("officialAppId");
