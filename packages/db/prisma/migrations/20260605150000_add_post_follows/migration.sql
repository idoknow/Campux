-- CreateTable
CREATE TABLE "PostFollow" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastPushedAt" TIMESTAMP(3),
    "lastPushedCommentCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PostFollow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PostFollow_postId_userId_key" ON "PostFollow"("postId", "userId");

-- CreateIndex
CREATE INDEX "PostFollow_userId_idx" ON "PostFollow"("userId");

-- CreateIndex
CREATE INDEX "PostFollow_postId_idx" ON "PostFollow"("postId");

-- AddForeignKey
ALTER TABLE "PostFollow" ADD CONSTRAINT "PostFollow_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostFollow" ADD CONSTRAINT "PostFollow_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
