CREATE TABLE "PostTag" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT NOT NULL DEFAULT '#e2e8f0',
    "status" TEXT NOT NULL DEFAULT 'active',
    "source" TEXT NOT NULL DEFAULT 'manual',
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PostTag_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PostTagAssignment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "confidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostTagAssignment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PostTag_tenantId_name_key" ON "PostTag"("tenantId", "name");
CREATE INDEX "PostTag_tenantId_status_updatedAt_idx" ON "PostTag"("tenantId", "status", "updatedAt");

CREATE UNIQUE INDEX "PostTagAssignment_postId_tagId_key" ON "PostTagAssignment"("postId", "tagId");
CREATE INDEX "PostTagAssignment_tenantId_tagId_idx" ON "PostTagAssignment"("tenantId", "tagId");
CREATE INDEX "PostTagAssignment_tenantId_postId_idx" ON "PostTagAssignment"("tenantId", "postId");

ALTER TABLE "PostTag" ADD CONSTRAINT "PostTag_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PostTagAssignment" ADD CONSTRAINT "PostTagAssignment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PostTagAssignment" ADD CONSTRAINT "PostTagAssignment_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "PostTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
