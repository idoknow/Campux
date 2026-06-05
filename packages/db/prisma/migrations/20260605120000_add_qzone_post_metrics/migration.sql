-- CreateTable
CREATE TABLE "QZonePostMetric" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "publishAttemptId" TEXT NOT NULL,
    "publishTargetId" TEXT NOT NULL,
    "botAccountId" TEXT NOT NULL,
    "qzoneTid" TEXT NOT NULL,
    "visitorCount" INTEGER,
    "likeCount" INTEGER,
    "commentCount" INTEGER,
    "forwardCount" INTEGER,
    "lastError" TEXT,
    "lastVerbose" JSONB,
    "checkedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QZonePostMetric_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QZonePostMetric_publishAttemptId_key" ON "QZonePostMetric"("publishAttemptId");

-- CreateIndex
CREATE INDEX "QZonePostMetric_tenantId_postId_idx" ON "QZonePostMetric"("tenantId", "postId");

-- CreateIndex
CREATE INDEX "QZonePostMetric_tenantId_checkedAt_idx" ON "QZonePostMetric"("tenantId", "checkedAt");

-- CreateIndex
CREATE INDEX "QZonePostMetric_botAccountId_checkedAt_idx" ON "QZonePostMetric"("botAccountId", "checkedAt");

-- AddForeignKey
ALTER TABLE "QZonePostMetric" ADD CONSTRAINT "QZonePostMetric_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QZonePostMetric" ADD CONSTRAINT "QZonePostMetric_publishAttemptId_fkey" FOREIGN KEY ("publishAttemptId") REFERENCES "PublishAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
