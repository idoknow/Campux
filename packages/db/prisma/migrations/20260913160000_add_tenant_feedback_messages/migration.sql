-- AlterTable
ALTER TABLE "TenantFeedback" ADD COLUMN "groupMessageId" TEXT;

-- CreateTable
CREATE TABLE "TenantFeedbackMessage" (
    "id" TEXT NOT NULL,
    "feedbackId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "authorId" TEXT,
    "authorLabel" TEXT,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantFeedbackMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TenantFeedback_tenantId_groupMessageId_idx" ON "TenantFeedback"("tenantId", "groupMessageId");

-- CreateIndex
CREATE INDEX "TenantFeedbackMessage_feedbackId_createdAt_idx" ON "TenantFeedbackMessage"("feedbackId", "createdAt");

-- CreateIndex
CREATE INDEX "TenantFeedbackMessage_tenantId_createdAt_idx" ON "TenantFeedbackMessage"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "TenantFeedbackMessage" ADD CONSTRAINT "TenantFeedbackMessage_feedbackId_fkey" FOREIGN KEY ("feedbackId") REFERENCES "TenantFeedback"("id") ON DELETE CASCADE ON UPDATE CASCADE;
