-- CreateTable
CREATE TABLE "PlatformFeedback" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "notifiedAt" TIMESTAMP(3),
    "notifyError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlatformFeedback_createdAt_idx" ON "PlatformFeedback"("createdAt");

-- CreateIndex
CREATE INDEX "PlatformFeedback_tenantId_createdAt_idx" ON "PlatformFeedback"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "PlatformFeedback" ADD CONSTRAINT "PlatformFeedback_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformFeedback" ADD CONSTRAINT "PlatformFeedback_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
