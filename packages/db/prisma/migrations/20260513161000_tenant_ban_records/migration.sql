CREATE TABLE "BanRecord" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "operatorId" TEXT,
    "comment" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BanRecord_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BanRecord_tenantId_userId_endsAt_idx" ON "BanRecord"("tenantId", "userId", "endsAt");
CREATE INDEX "BanRecord_tenantId_endsAt_idx" ON "BanRecord"("tenantId", "endsAt");
