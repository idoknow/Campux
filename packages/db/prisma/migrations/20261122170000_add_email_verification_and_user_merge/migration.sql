-- AlterTable
ALTER TABLE "User" ADD COLUMN "mergedAt" TIMESTAMP(3),
ADD COLUMN "mergedIntoUserId" TEXT;

-- CreateTable
CREATE TABLE "UserMerge" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "oldUserId" TEXT NOT NULL,
    "newUserId" TEXT NOT NULL,
    "oldQqUin" BIGINT NOT NULL,
    "newQqUin" BIGINT NOT NULL,
    "oldEmail" TEXT,
    "migratedPosts" INTEGER NOT NULL DEFAULT 0,
    "migratedMemberships" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserMerge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserMerge_tenantId_createdAt_idx" ON "UserMerge"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "UserMerge_oldUserId_idx" ON "UserMerge"("oldUserId");

-- CreateIndex
CREATE INDEX "UserMerge_newUserId_idx" ON "UserMerge"("newUserId");