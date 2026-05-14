-- CreateTable
CREATE TABLE "BotSession" (
    "id" TEXT NOT NULL,
    "botAccountId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'qzone',
    "domain" TEXT NOT NULL DEFAULT 'user.qzone.qq.com',
    "cookies" JSONB NOT NULL,
    "rawCookies" TEXT,
    "refreshedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BotSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BotSession_botAccountId_type_domain_key" ON "BotSession"("botAccountId", "type", "domain");

-- CreateIndex
CREATE INDEX "BotSession_botAccountId_refreshedAt_idx" ON "BotSession"("botAccountId", "refreshedAt");

-- AddForeignKey
ALTER TABLE "BotSession" ADD CONSTRAINT "BotSession_botAccountId_fkey" FOREIGN KEY ("botAccountId") REFERENCES "BotAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
