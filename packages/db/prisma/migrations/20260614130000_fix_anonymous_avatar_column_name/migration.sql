-- Fix: migration 20260614120000_add_anonymous_avatar created the column as
-- snake_case "anonymous_avatar", but schema.prisma defines `anonymousAvatar`
-- with no @map (the whole schema uses camelCase column names, zero @map).
-- That mismatch made every Post query fail with P2022
-- (The column `Post.anonymousAvatar` does not exist) and crash-looped the app.
--
-- Rename to the camelCase name Prisma expects. Idempotent and safe whether the
-- DB currently has the snake_case column, the camelCase column (prod was hotfixed
-- manually), or neither.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'Post' AND column_name = 'anonymous_avatar'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'Post' AND column_name = 'anonymousAvatar'
  ) THEN
    ALTER TABLE "Post" RENAME COLUMN "anonymous_avatar" TO "anonymousAvatar";
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'Post' AND column_name = 'anonymousAvatar'
  ) THEN
    ALTER TABLE "Post" ADD COLUMN "anonymousAvatar" TEXT;
  END IF;
END $$;
