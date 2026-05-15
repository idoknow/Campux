UPDATE "PublishTarget"
SET "publishDelaySeconds" = 300
WHERE "publishDelaySeconds" < 300;

ALTER TABLE "PublishTarget"
ALTER COLUMN "publishDelaySeconds" SET DEFAULT 300;
