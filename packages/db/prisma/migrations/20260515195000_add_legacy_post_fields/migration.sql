-- AlterTable
ALTER TABLE "Post" ADD COLUMN "legacyTenantSlug" TEXT;
ALTER TABLE "Post" ADD COLUMN "legacyDisplayId" INTEGER;
ALTER TABLE "Post" ADD COLUMN "legacyUuid" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Post_tenantId_legacyDisplayId_key" ON "Post"("tenantId", "legacyDisplayId");
