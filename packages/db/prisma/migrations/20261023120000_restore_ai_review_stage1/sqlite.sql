-- Restore tenant-isolated storage for human-in-the-loop AI review.
CREATE TABLE "SchoolEntity" (
  "id" TEXT NOT NULL PRIMARY KEY, "tenantId" TEXT NOT NULL, "type" TEXT NOT NULL, "name" TEXT NOT NULL,
  "aliases" JSONB NOT NULL DEFAULT '[]', "confidence" REAL NOT NULL DEFAULT 1,
  "sensitivity" TEXT NOT NULL DEFAULT 'normal', "source" TEXT NOT NULL DEFAULT 'admin',
  "evidence" JSONB NOT NULL DEFAULT '[]', "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "SchoolEntity_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "SchoolModelSnapshot" (
  "id" TEXT NOT NULL PRIMARY KEY, "tenantId" TEXT NOT NULL, "version" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active', "summary" TEXT NOT NULL, "entities" JSONB NOT NULL,
  "riskMemory" JSONB NOT NULL DEFAULT '{}', "rules" JSONB NOT NULL, "metrics" JSONB NOT NULL DEFAULT '{}',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SchoolModelSnapshot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "PostAiAnalysis" (
  "id" TEXT NOT NULL PRIMARY KEY, "tenantId" TEXT NOT NULL, "postId" TEXT NOT NULL,
  "modelSnapshotId" TEXT, "mode" TEXT NOT NULL DEFAULT 'assist', "version" INTEGER NOT NULL DEFAULT 1, "provider" TEXT NOT NULL, "model" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending', "riskLevel" TEXT, "confidence" REAL,
  "categories" JSONB NOT NULL DEFAULT '[]', "sensitiveFindings" JSONB NOT NULL DEFAULT '[]',
  "suggestedAction" TEXT, "reasons" JSONB NOT NULL DEFAULT '[]', "rewrittenText" TEXT, "maskedText" TEXT,
  "rejectionReason" TEXT, "error" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "PostAiAnalysis_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PostAiAnalysis_postId_tenantId_fkey" FOREIGN KEY ("postId", "tenantId") REFERENCES "Post" ("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PostAiAnalysis_modelSnapshotId_tenantId_fkey" FOREIGN KEY ("modelSnapshotId", "tenantId") REFERENCES "SchoolModelSnapshot" ("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "AiFeedback" (
  "id" TEXT NOT NULL PRIMARY KEY, "tenantId" TEXT NOT NULL, "postId" TEXT NOT NULL,
  "analysisId" TEXT NOT NULL, "reviewerId" TEXT, "aiAction" TEXT, "humanAction" TEXT NOT NULL,
  "humanComment" TEXT, "matched" BOOLEAN NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiFeedback_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AiFeedback_postId_tenantId_fkey" FOREIGN KEY ("postId", "tenantId") REFERENCES "Post" ("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AiFeedback_analysisId_tenantId_fkey" FOREIGN KEY ("analysisId", "tenantId") REFERENCES "PostAiAnalysis" ("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AiFeedback_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SchoolEntity_tenantId_type_name_key" ON "SchoolEntity"("tenantId", "type", "name");
CREATE INDEX "SchoolEntity_tenantId_type_sensitivity_idx" ON "SchoolEntity"("tenantId", "type", "sensitivity");
CREATE UNIQUE INDEX "SchoolModelSnapshot_tenantId_version_key" ON "SchoolModelSnapshot"("tenantId", "version");
CREATE INDEX "SchoolModelSnapshot_tenantId_createdAt_idx" ON "SchoolModelSnapshot"("tenantId", "createdAt");
CREATE UNIQUE INDEX "PostAiAnalysis_postId_tenantId_version_key" ON "PostAiAnalysis"("postId", "tenantId", "version");
CREATE INDEX "PostAiAnalysis_tenantId_status_createdAt_idx" ON "PostAiAnalysis"("tenantId", "status", "createdAt");
CREATE INDEX "PostAiAnalysis_tenantId_postId_createdAt_idx" ON "PostAiAnalysis"("tenantId", "postId", "createdAt");
CREATE UNIQUE INDEX "AiFeedback_analysisId_key" ON "AiFeedback"("analysisId");
CREATE INDEX "AiFeedback_tenantId_createdAt_idx" ON "AiFeedback"("tenantId", "createdAt");
