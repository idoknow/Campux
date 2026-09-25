-- 毕业去向插件：新增「毕业去向」编号计数器与 UserGraduation 主表。

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN "nextGraduationDisplayId" INTEGER NOT NULL DEFAULT 1;

-- CreateEnum
CREATE TYPE "UserGraduationStatus" AS ENUM ('pending_approval', 'approved', 'rejected');

-- CreateTable
CREATE TABLE "UserGraduation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "displayId" INTEGER NOT NULL,
    "authorId" TEXT NOT NULL,
    "graduationYear" INTEGER NOT NULL,
    "classYear" INTEGER NOT NULL,
    "education" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "status" "UserGraduationStatus" NOT NULL DEFAULT 'pending_approval',
    "rejectReason" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserGraduation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserGraduation_tenantId_displayId_key" ON "UserGraduation"("tenantId", "displayId");

-- CreateIndex
CREATE INDEX "UserGraduation_tenantId_status_idx" ON "UserGraduation"("tenantId", "status");

-- CreateIndex
CREATE INDEX "UserGraduation_tenantId_graduationYear_idx" ON "UserGraduation"("tenantId", "graduationYear");

-- CreateIndex
CREATE INDEX "UserGraduation_tenantId_classYear_idx" ON "UserGraduation"("tenantId", "classYear");

-- CreateIndex
CREATE INDEX "UserGraduation_tenantId_destination_idx" ON "UserGraduation"("tenantId", "destination");

-- CreateIndex
CREATE INDEX "UserGraduation_tenantId_authorId_idx" ON "UserGraduation"("tenantId", "authorId");

-- AddForeignKey
ALTER TABLE "UserGraduation" ADD CONSTRAINT "UserGraduation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserGraduation" ADD CONSTRAINT "UserGraduation_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
