-- Rename images column to attachments
ALTER TABLE "Post" RENAME COLUMN "images" TO "attachments";

-- Add kind: "image" to all existing attachment entries
UPDATE "Post"
SET "attachments" = (
  SELECT jsonb_agg(elem || jsonb_build_object('kind', 'image'))
  FROM jsonb_array_elements("attachments"::jsonb) elem
)
WHERE jsonb_typeof("attachments"::jsonb) = 'array'
  AND jsonb_array_length("attachments"::jsonb) > 0;
