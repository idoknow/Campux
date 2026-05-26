CREATE TABLE "TenantAiSettings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "mode" TEXT NOT NULL DEFAULT 'local',
    "provider" TEXT NOT NULL DEFAULT 'openai_compatible',
    "baseUrl" TEXT NOT NULL DEFAULT 'https://api.openai.com/v1',
    "model" TEXT NOT NULL DEFAULT 'gpt-4.1-mini',
    "apiKeySecret" JSONB,
    "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.2,
    "timeoutSeconds" INTEGER NOT NULL DEFAULT 30,
    "rules" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantAiSettings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SchoolEntity" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "aliases" JSONB NOT NULL DEFAULT '[]',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "source" TEXT NOT NULL,
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolEntity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SchoolModelSnapshot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "summary" TEXT NOT NULL,
    "entities" JSONB NOT NULL,
    "modelingMemory" JSONB NOT NULL,
    "rules" JSONB NOT NULL,
    "metrics" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchoolModelSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PostAiAnalysis" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "modelSnapshotId" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "confidence" DOUBLE PRECISION,
    "categories" JSONB NOT NULL DEFAULT '[]',
    "entities" JSONB NOT NULL DEFAULT '[]',
    "reasons" JSONB NOT NULL DEFAULT '[]',
    "rawOutput" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PostAiAnalysis_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TenantAiSettings_tenantId_key" ON "TenantAiSettings"("tenantId");
CREATE INDEX "SchoolEntity_tenantId_type_idx" ON "SchoolEntity"("tenantId", "type");
CREATE UNIQUE INDEX "SchoolEntity_tenantId_type_name_key" ON "SchoolEntity"("tenantId", "type", "name");
CREATE UNIQUE INDEX "SchoolModelSnapshot_tenantId_version_key" ON "SchoolModelSnapshot"("tenantId", "version");
CREATE INDEX "SchoolModelSnapshot_tenantId_status_createdAt_idx" ON "SchoolModelSnapshot"("tenantId", "status", "createdAt");
CREATE UNIQUE INDEX "PostAiAnalysis_postId_key" ON "PostAiAnalysis"("postId");
CREATE INDEX "PostAiAnalysis_tenantId_status_createdAt_idx" ON "PostAiAnalysis"("tenantId", "status", "createdAt");

ALTER TABLE "TenantAiSettings" ADD CONSTRAINT "TenantAiSettings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SchoolEntity" ADD CONSTRAINT "SchoolEntity_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SchoolModelSnapshot" ADD CONSTRAINT "SchoolModelSnapshot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PostAiAnalysis" ADD CONSTRAINT "PostAiAnalysis_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PostAiAnalysis" ADD CONSTRAINT "PostAiAnalysis_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PostAiAnalysis" ADD CONSTRAINT "PostAiAnalysis_modelSnapshotId_fkey" FOREIGN KEY ("modelSnapshotId") REFERENCES "SchoolModelSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
