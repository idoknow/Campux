CREATE TABLE "SchoolRelationExtractionCursor" (
  "tenantId" TEXT NOT NULL PRIMARY KEY,
  "postId" TEXT,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SchoolRelationExtractionCursor_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
