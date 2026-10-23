-- School-model and per-post AI review records for the human-in-the-loop Stage 1 workflow.
CREATE TABLE "SchoolEntity" (
    "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "type" TEXT NOT NULL, "name" TEXT NOT NULL,
    "aliases" JSONB NOT NULL DEFAULT '[]', "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "sensitivity" TEXT NOT NULL DEFAULT 'normal', "source" TEXT NOT NULL DEFAULT 'admin', "evidence" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SchoolEntity_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "SchoolModelSnapshot" (
    "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "version" INTEGER NOT NULL, "status" TEXT NOT NULL DEFAULT 'active',
    "summary" TEXT NOT NULL, "entities" JSONB NOT NULL, "riskMemory" JSONB NOT NULL DEFAULT '{}', "rules" JSONB NOT NULL, "metrics" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "SchoolModelSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "PostAiAnalysis" (
    "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "postId" TEXT NOT NULL, "modelSnapshotId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1, "provider" TEXT NOT NULL, "model" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'pending',
    "riskLevel" TEXT, "confidence" DOUBLE PRECISION, "categories" JSONB NOT NULL DEFAULT '[]', "sensitiveFindings" JSONB NOT NULL DEFAULT '[]',
    "suggestedAction" TEXT, "reasons" JSONB NOT NULL DEFAULT '[]', "rewrittenText" TEXT, "maskedText" TEXT, "rejectionReason" TEXT, "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "PostAiAnalysis_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "AiFeedback" (
    "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "postId" TEXT NOT NULL, "analysisId" TEXT NOT NULL, "reviewerId" TEXT,
    "aiAction" TEXT, "humanAction" TEXT NOT NULL, "humanComment" TEXT, "matched" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "AiFeedback_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SchoolEntity_tenantId_type_name_key" ON "SchoolEntity"("tenantId", "type", "name");
CREATE INDEX "SchoolEntity_tenantId_type_sensitivity_idx" ON "SchoolEntity"("tenantId", "type", "sensitivity");
CREATE UNIQUE INDEX "SchoolModelSnapshot_tenantId_id_key" ON "SchoolModelSnapshot"("tenantId", "id");
CREATE UNIQUE INDEX "SchoolModelSnapshot_tenantId_version_key" ON "SchoolModelSnapshot"("tenantId", "version");
CREATE INDEX "SchoolModelSnapshot_tenantId_status_createdAt_idx" ON "SchoolModelSnapshot"("tenantId", "status", "createdAt");
CREATE INDEX "SchoolModelSnapshot_tenantId_createdAt_idx" ON "SchoolModelSnapshot"("tenantId", "createdAt");
CREATE UNIQUE INDEX "PostAiAnalysis_tenantId_id_key" ON "PostAiAnalysis"("tenantId", "id");
CREATE UNIQUE INDEX "PostAiAnalysis_postId_tenantId_version_key" ON "PostAiAnalysis"("postId", "tenantId", "version");
CREATE INDEX "PostAiAnalysis_tenantId_status_createdAt_idx" ON "PostAiAnalysis"("tenantId", "status", "createdAt");
CREATE INDEX "PostAiAnalysis_tenantId_postId_createdAt_idx" ON "PostAiAnalysis"("tenantId", "postId", "createdAt");
CREATE UNIQUE INDEX "AiFeedback_tenantId_id_key" ON "AiFeedback"("tenantId", "id");
CREATE UNIQUE INDEX "AiFeedback_analysisId_key" ON "AiFeedback"("analysisId");
CREATE INDEX "AiFeedback_tenantId_createdAt_idx" ON "AiFeedback"("tenantId", "createdAt");
ALTER TABLE "Post" ADD CONSTRAINT "Post_tenantId_id_key" UNIQUE ("tenantId", "id");
ALTER TABLE "SchoolEntity" ADD CONSTRAINT "SchoolEntity_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SchoolModelSnapshot" ADD CONSTRAINT "SchoolModelSnapshot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PostAiAnalysis" ADD CONSTRAINT "PostAiAnalysis_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PostAiAnalysis" ADD CONSTRAINT "PostAiAnalysis_postId_tenantId_fkey" FOREIGN KEY ("postId", "tenantId") REFERENCES "Post"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PostAiAnalysis" ADD CONSTRAINT "PostAiAnalysis_modelSnapshotId_tenantId_fkey" FOREIGN KEY ("modelSnapshotId", "tenantId") REFERENCES "SchoolModelSnapshot"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiFeedback" ADD CONSTRAINT "AiFeedback_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiFeedback" ADD CONSTRAINT "AiFeedback_postId_tenantId_fkey" FOREIGN KEY ("postId", "tenantId") REFERENCES "Post"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiFeedback" ADD CONSTRAINT "AiFeedback_analysisId_tenantId_fkey" FOREIGN KEY ("analysisId", "tenantId") REFERENCES "PostAiAnalysis"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
