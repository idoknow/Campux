-- CreateTable
CREATE TABLE "BotFriendSnapshot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "botAccountId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "friendCount" INTEGER NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BotFriendSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BotFriendSnapshot_botAccountId_date_key" ON "BotFriendSnapshot"("botAccountId", "date");

-- CreateIndex
CREATE INDEX "BotFriendSnapshot_tenantId_date_idx" ON "BotFriendSnapshot"("tenantId", "date");

-- CreateIndex
CREATE INDEX "BotFriendSnapshot_botAccountId_checkedAt_idx" ON "BotFriendSnapshot"("botAccountId", "checkedAt");

-- AddForeignKey
ALTER TABLE "BotFriendSnapshot" ADD CONSTRAINT "BotFriendSnapshot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotFriendSnapshot" ADD CONSTRAINT "BotFriendSnapshot_botAccountId_fkey" FOREIGN KEY ("botAccountId") REFERENCES "BotAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
