ALTER TABLE "PublishAttempt" ADD COLUMN IF NOT EXISTS "qzoneTid" TEXT;
UPDATE "PublishAttempt" SET "qzoneTid" = "externalId" WHERE "qzoneTid" IS NULL AND "externalId" IS NOT NULL;
