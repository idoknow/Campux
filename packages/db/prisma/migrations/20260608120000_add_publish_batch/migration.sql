-- CreateEnum
CREATE TYPE "PublishBatchStatus" AS ENUM ('collecting', 'publishing', 'published', 'partially_failed', 'failed');

-- AlterTable
ALTER TABLE "PublishAttempt" ADD COLUMN "batchId" TEXT;

-- CreateTable
CREATE TABLE "PublishBatch" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "status" "PublishBatchStatus" NOT NULL DEFAULT 'collecting',
    "imageCount" INTEGER NOT NULL DEFAULT 0,
    "flushedAt" TIMESTAMP(3),
    "lastItemAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublishBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublishBatchItem" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "imageCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublishBatchItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PublishBatch_tenantId_status_lastItemAt_idx" ON "PublishBatch"("tenantId", "status", "lastItemAt");

-- CreateIndex
CREATE UNIQUE INDEX "PublishBatchItem_batchId_postId_key" ON "PublishBatchItem"("batchId", "postId");

-- CreateIndex
CREATE UNIQUE INDEX "PublishBatchItem_postId_key" ON "PublishBatchItem"("postId");

-- CreateIndex
CREATE INDEX "PublishBatchItem_batchId_position_idx" ON "PublishBatchItem"("batchId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "PublishAttempt_batchId_publishTargetId_key" ON "PublishAttempt"("batchId", "publishTargetId");

-- CreateIndex
CREATE INDEX "PublishAttempt_batchId_idx" ON "PublishAttempt"("batchId");

-- AddForeignKey
ALTER TABLE "PublishAttempt" ADD CONSTRAINT "PublishAttempt_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "PublishBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishBatch" ADD CONSTRAINT "PublishBatch_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishBatchItem" ADD CONSTRAINT "PublishBatchItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "PublishBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishBatchItem" ADD CONSTRAINT "PublishBatchItem_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
