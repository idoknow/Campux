CREATE TABLE "AiBackfillBatch" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "actorId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "mode" TEXT NOT NULL DEFAULT 'missing',
    "totalCount" INTEGER NOT NULL DEFAULT 0,
    "queuedCount" INTEGER NOT NULL DEFAULT 0,
    "runningCount" INTEGER NOT NULL DEFAULT 0,
    "succeededCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "lastError" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiBackfillBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiBackfillItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiBackfillItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiBackfillLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'info',
    "event" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiBackfillLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AiBackfillBatch_tenantId_status_createdAt_idx" ON "AiBackfillBatch"("tenantId", "status", "createdAt");
CREATE UNIQUE INDEX "AiBackfillItem_batchId_postId_key" ON "AiBackfillItem"("batchId", "postId");
CREATE INDEX "AiBackfillItem_tenantId_status_nextRunAt_idx" ON "AiBackfillItem"("tenantId", "status", "nextRunAt");
CREATE INDEX "AiBackfillItem_batchId_status_nextRunAt_idx" ON "AiBackfillItem"("batchId", "status", "nextRunAt");
CREATE INDEX "AiBackfillLog_tenantId_createdAt_idx" ON "AiBackfillLog"("tenantId", "createdAt");
CREATE INDEX "AiBackfillLog_batchId_createdAt_idx" ON "AiBackfillLog"("batchId", "createdAt");

ALTER TABLE "AiBackfillBatch" ADD CONSTRAINT "AiBackfillBatch_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiBackfillBatch" ADD CONSTRAINT "AiBackfillBatch_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AiBackfillItem" ADD CONSTRAINT "AiBackfillItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "AiBackfillBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiBackfillItem" ADD CONSTRAINT "AiBackfillItem_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiBackfillLog" ADD CONSTRAINT "AiBackfillLog_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "AiBackfillBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
