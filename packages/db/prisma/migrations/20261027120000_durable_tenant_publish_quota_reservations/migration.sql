-- Durable per-manuscript publish quota reservations. One reservation represents
-- one manuscript, independent of the number of bots/targets used to publish it.
CREATE TABLE IF NOT EXISTS "TenantPublishQuotaReservation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "periodType" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'reserved',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TenantPublishQuotaReservation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TenantPublishQuotaReservation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TenantPublishQuotaReservation_tenantId_postId_fkey" FOREIGN KEY ("tenantId", "postId") REFERENCES "Post"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TenantPublishQuotaReservation_periodType_check" CHECK ("periodType" IN ('hourly', 'daily')),
    CONSTRAINT "TenantPublishQuotaReservation_status_check" CHECK ("status" IN ('reserved', 'consumed', 'released'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "TenantPublishQuotaReservation_tenantId_postId_periodType_periodStart_key" ON "TenantPublishQuotaReservation"("tenantId", "postId", "periodType", "periodStart");
CREATE INDEX IF NOT EXISTS "TenantPublishQuotaReservation_tenantId_periodType_periodStart_status_idx" ON "TenantPublishQuotaReservation"("tenantId", "periodType", "periodStart", "status");
