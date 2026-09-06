-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('pending_approval', 'rejected', 'running', 'ended', 'taken_down');

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN "nextCampaignDisplayId" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "displayId" INTEGER NOT NULL,
    "authorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "coverAttachment" JSONB,
    "anonymous" BOOLEAN NOT NULL DEFAULT false,
    "votesPerPerson" INTEGER NOT NULL DEFAULT 1,
    "allowStackOnOption" BOOLEAN NOT NULL DEFAULT false,
    "showVoterDetails" BOOLEAN NOT NULL DEFAULT true,
    "durationHours" INTEGER NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'pending_approval',
    "rejectReason" TEXT,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "takenDownAt" TIMESTAMP(3),
    "takenDownById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignOption" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "label" TEXT NOT NULL,
    "imageAttachment" JSONB,
    "voteTotal" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignVote" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,
    "voterId" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignVote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_tenantId_displayId_key" ON "Campaign"("tenantId", "displayId");

-- CreateIndex
CREATE INDEX "Campaign_tenantId_status_endsAt_idx" ON "Campaign"("tenantId", "status", "endsAt");

-- CreateIndex
CREATE INDEX "Campaign_tenantId_authorId_status_idx" ON "Campaign"("tenantId", "authorId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignOption_campaignId_sortOrder_key" ON "CampaignOption"("campaignId", "sortOrder");

-- CreateIndex
CREATE INDEX "CampaignOption_campaignId_idx" ON "CampaignOption"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignVote_campaignId_voterId_optionId_key" ON "CampaignVote"("campaignId", "voterId", "optionId");

-- CreateIndex
CREATE INDEX "CampaignVote_campaignId_voterId_idx" ON "CampaignVote"("campaignId", "voterId");

-- CreateIndex
CREATE INDEX "CampaignVote_optionId_idx" ON "CampaignVote"("optionId");

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignOption" ADD CONSTRAINT "CampaignOption_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignVote" ADD CONSTRAINT "CampaignVote_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignVote" ADD CONSTRAINT "CampaignVote_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "CampaignOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignVote" ADD CONSTRAINT "CampaignVote_voterId_fkey" FOREIGN KEY ("voterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
