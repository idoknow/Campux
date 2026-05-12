-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('active', 'paused', 'archived');

-- CreateEnum
CREATE TYPE "TenantRole" AS ENUM ('submitter', 'reviewer', 'admin');

-- CreateEnum
CREATE TYPE "SystemRole" AS ENUM ('system_operator');

-- CreateEnum
CREATE TYPE "PostStatus" AS ENUM ('pending_approval', 'approved', 'rejected', 'cancelled', 'publishing', 'partially_failed', 'failed', 'published', 'pending_recall', 'recalled');

-- CreateEnum
CREATE TYPE "PublishAttemptStatus" AS ENUM ('queued', 'running', 'succeeded', 'failed', 'skipped');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "TenantStatus" NOT NULL DEFAULT 'active',
    "themeColor" TEXT NOT NULL DEFAULT '#e0574f',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "qqUin" BIGINT NOT NULL,
    "displayName" TEXT,
    "systemRole" "SystemRole",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantMembership" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "TenantRole" NOT NULL DEFAULT 'submitter',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantMetadata" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantMetadata_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Post" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "displayId" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "images" JSONB NOT NULL DEFAULT '[]',
    "anonymous" BOOLEAN NOT NULL DEFAULT false,
    "status" "PostStatus" NOT NULL DEFAULT 'pending_approval',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "actorId" TEXT,
    "oldStatus" "PostStatus",
    "newStatus" "PostStatus" NOT NULL,
    "comment" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BotAccount" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "qqUin" BIGINT NOT NULL,
    "displayName" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BotAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublishTarget" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "botAccountId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'qzone',
    "displayName" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "publishDelaySeconds" INTEGER NOT NULL DEFAULT 0,
    "failurePolicy" TEXT NOT NULL DEFAULT 'block_post',

    CONSTRAINT "PublishTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublishAttempt" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "publishTargetId" TEXT NOT NULL,
    "status" "PublishAttemptStatus" NOT NULL DEFAULT 'queued',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextRunAt" TIMESTAMP(3),
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublishAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "User_qqUin_key" ON "User"("qqUin");

-- CreateIndex
CREATE INDEX "TenantMembership_userId_idx" ON "TenantMembership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TenantMembership_tenantId_userId_key" ON "TenantMembership"("tenantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "TenantMetadata_tenantId_key_key" ON "TenantMetadata"("tenantId", "key");

-- CreateIndex
CREATE INDEX "Post_tenantId_status_createdAt_idx" ON "Post"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Post_tenantId_displayId_key" ON "Post"("tenantId", "displayId");

-- CreateIndex
CREATE INDEX "PostLog_tenantId_postId_createdAt_idx" ON "PostLog"("tenantId", "postId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BotAccount_tenantId_qqUin_key" ON "BotAccount"("tenantId", "qqUin");

-- CreateIndex
CREATE INDEX "PublishTarget_tenantId_enabled_idx" ON "PublishTarget"("tenantId", "enabled");

-- CreateIndex
CREATE INDEX "PublishAttempt_tenantId_status_nextRunAt_idx" ON "PublishAttempt"("tenantId", "status", "nextRunAt");

-- CreateIndex
CREATE UNIQUE INDEX "PublishAttempt_postId_publishTargetId_key" ON "PublishAttempt"("postId", "publishTargetId");

-- AddForeignKey
ALTER TABLE "TenantMembership" ADD CONSTRAINT "TenantMembership_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantMembership" ADD CONSTRAINT "TenantMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantMetadata" ADD CONSTRAINT "TenantMetadata_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostLog" ADD CONSTRAINT "PostLog_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotAccount" ADD CONSTRAINT "BotAccount_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishTarget" ADD CONSTRAINT "PublishTarget_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishTarget" ADD CONSTRAINT "PublishTarget_botAccountId_fkey" FOREIGN KEY ("botAccountId") REFERENCES "BotAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishAttempt" ADD CONSTRAINT "PublishAttempt_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishAttempt" ADD CONSTRAINT "PublishAttempt_publishTargetId_fkey" FOREIGN KEY ("publishTargetId") REFERENCES "PublishTarget"("id") ON DELETE CASCADE ON UPDATE CASCADE;
