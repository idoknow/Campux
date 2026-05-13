ALTER TABLE "User" ADD COLUMN "isTestAccount" BOOLEAN NOT NULL DEFAULT false;

UPDATE "User"
SET "isTestAccount" = true
WHERE "qqUin" IN (10000, 20000, 30000, 40000);
