-- 广播通知插件：新增「广播员」身份、编号计数器、通知主表与历史版本表。

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN "nextBroadcastDisplayId" INTEGER NOT NULL DEFAULT 1;

-- AlterEnum
-- 「广播员」插在 submitter 与 reviewer 之间：rank submitter(1) < broadcaster(2) < reviewer(3) < admin(4)。
ALTER TYPE "TenantRole" ADD VALUE 'broadcaster' AFTER 'submitter';

-- CreateTable
CREATE TABLE "TenantBroadcast" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "displayId" INTEGER NOT NULL,
    "authorId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "broadcastCount" INTEGER NOT NULL DEFAULT 0,
    "modified" BOOLEAN NOT NULL DEFAULT false,
    "removedAt" TIMESTAMP(3),
    "removedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantBroadcast_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantBroadcastVersion" (
    "id" TEXT NOT NULL,
    "broadcastId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "broadcastCount" INTEGER NOT NULL DEFAULT 0,
    "changedById" TEXT NOT NULL,

    CONSTRAINT "TenantBroadcastVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TenantBroadcast_tenantId_displayId_key" ON "TenantBroadcast"("tenantId", "displayId");

-- CreateIndex
CREATE INDEX "TenantBroadcast_tenantId_endsAt_idx" ON "TenantBroadcast"("tenantId", "endsAt");

-- CreateIndex
CREATE INDEX "TenantBroadcast_tenantId_authorId_idx" ON "TenantBroadcast"("tenantId", "authorId");

-- CreateIndex
CREATE UNIQUE INDEX "TenantBroadcastVersion_broadcastId_version_key" ON "TenantBroadcastVersion"("broadcastId", "version");

-- CreateIndex
CREATE INDEX "TenantBroadcastVersion_broadcastId_idx" ON "TenantBroadcastVersion"("broadcastId");

-- AddForeignKey
ALTER TABLE "TenantBroadcast" ADD CONSTRAINT "TenantBroadcast_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- 与 Campaign/Post 的作者外键一致：RESTRICT。广播以租户维度 CASCADE 清理，
-- 作者引用仅用于展示头像/姓名，不允许随作者删除级联。
ALTER TABLE "TenantBroadcast" ADD CONSTRAINT "TenantBroadcast_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantBroadcastVersion" ADD CONSTRAINT "TenantBroadcastVersion_broadcastId_fkey" FOREIGN KEY ("broadcastId") REFERENCES "TenantBroadcast"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantBroadcastVersion" ADD CONSTRAINT "TenantBroadcastVersion_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
