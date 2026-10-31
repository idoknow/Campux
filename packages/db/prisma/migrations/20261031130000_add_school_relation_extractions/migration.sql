-- CreateTable
CREATE TABLE "SchoolRelationExtraction" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "postId" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SchoolRelationExtraction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SchoolRelationExtraction_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SchoolRelationExtraction_postId_tenantId_fkey" FOREIGN KEY ("postId", "tenantId") REFERENCES "Post"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SchoolRelationExtraction_tenantId_postId_contentHash_key" ON "SchoolRelationExtraction"("tenantId", "postId", "contentHash");
CREATE INDEX "SchoolRelationExtraction_tenantId_status_attemptedAt_idx" ON "SchoolRelationExtraction"("tenantId", "status", "attemptedAt");
