-- 为待审核稿件保留提交时选择的话题名，审核通过后再落为公共 PostTag。
ALTER TABLE "Post" ADD COLUMN "pendingTags" TEXT;
