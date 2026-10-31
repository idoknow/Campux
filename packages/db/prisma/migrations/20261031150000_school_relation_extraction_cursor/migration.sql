CREATE TABLE "SchoolRelationExtractionCursor" (
  "tenantId" TEXT NOT NULL,
  "postId" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SchoolRelationExtractionCursor_pkey" PRIMARY KEY ("tenantId"),
  CONSTRAINT "SchoolRelationExtractionCursor_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
