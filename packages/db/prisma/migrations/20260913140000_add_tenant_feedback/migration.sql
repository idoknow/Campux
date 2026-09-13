-- CreateTable
CREATE TABLE "TenantFeedback" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TenantFeedback_tenantId_createdAt_idx" ON "TenantFeedback"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "TenantFeedback_tenantId_authorId_createdAt_idx" ON "TenantFeedback"("tenantId", "authorId", "createdAt");

-- AddForeignKey
ALTER TABLE "TenantFeedback" ADD CONSTRAINT "TenantFeedback_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantFeedback" ADD CONSTRAINT "TenantFeedback_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
