CREATE TABLE "SchoolRelation" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "predicate" TEXT NOT NULL,
  "object" TEXT NOT NULL,
  "evidence" TEXT NOT NULL,
  "sourcePostId" TEXT NOT NULL,
  "approved" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SchoolRelation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SchoolRelation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SchoolRelation_sourcePostId_tenantId_fkey" FOREIGN KEY ("sourcePostId", "tenantId") REFERENCES "Post"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SchoolRelation_tenantId_subject_predicate_object_sourcePostId_key" ON "SchoolRelation"("tenantId", "subject", "predicate", "object", "sourcePostId");
CREATE INDEX "SchoolRelation_tenantId_approved_createdAt_idx" ON "SchoolRelation"("tenantId", "approved", "createdAt");
CREATE INDEX "SchoolRelation_tenantId_sourcePostId_idx" ON "SchoolRelation"("tenantId", "sourcePostId");
