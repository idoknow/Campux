-- CreateTable
CREATE TABLE "QZoneVisitorSnapshot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "botAccountId" TEXT NOT NULL,
    "sessionId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "todayCount" INTEGER NOT NULL,
    "totalCount" INTEGER NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QZoneVisitorSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QZoneVisitorSnapshot_botAccountId_date_key" ON "QZoneVisitorSnapshot"("botAccountId", "date");

-- CreateIndex
CREATE INDEX "QZoneVisitorSnapshot_tenantId_date_idx" ON "QZoneVisitorSnapshot"("tenantId", "date");

-- CreateIndex
CREATE INDEX "QZoneVisitorSnapshot_botAccountId_checkedAt_idx" ON "QZoneVisitorSnapshot"("botAccountId", "checkedAt");

-- AddForeignKey
ALTER TABLE "QZoneVisitorSnapshot" ADD CONSTRAINT "QZoneVisitorSnapshot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QZoneVisitorSnapshot" ADD CONSTRAINT "QZoneVisitorSnapshot_botAccountId_fkey" FOREIGN KEY ("botAccountId") REFERENCES "BotAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
