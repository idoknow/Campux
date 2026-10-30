-- SQLite equivalent of migration.sql.
CREATE TABLE "TenantPublishQuotaReservation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "periodType" TEXT NOT NULL,
    "periodStart" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'reserved',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TenantPublishQuotaReservation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TenantPublishQuotaReservation_tenantId_postId_fkey" FOREIGN KEY ("tenantId", "postId") REFERENCES "Post"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TenantPublishQuotaReservation_periodType_check" CHECK ("periodType" IN ('hourly', 'daily')),
    CONSTRAINT "TenantPublishQuotaReservation_status_check" CHECK ("status" IN ('reserved', 'consumed', 'released'))
);
CREATE UNIQUE INDEX "TenantPublishQuotaReservation_tenantId_postId_periodType_periodStart_key" ON "TenantPublishQuotaReservation"("tenantId", "postId", "periodType", "periodStart");
CREATE INDEX "TenantPublishQuotaReservation_tenantId_periodType_periodStart_status_idx" ON "TenantPublishQuotaReservation"("tenantId", "periodType", "periodStart", "status");
