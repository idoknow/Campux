UPDATE "PostTag"
SET "source" = 'llm'
WHERE "source" = 'manual';

UPDATE "PostTagAssignment"
SET "source" = 'llm'
WHERE "source" = 'manual';

ALTER TABLE "PostTag"
ALTER COLUMN "source" SET DEFAULT 'llm';

ALTER TABLE "PostTagAssignment"
ALTER COLUMN "source" SET DEFAULT 'llm';
