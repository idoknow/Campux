ALTER TABLE "PublishTarget"
ADD COLUMN IF NOT EXISTS "qzoneRefreshMode" TEXT NOT NULL DEFAULT 'protocol';
