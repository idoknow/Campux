ALTER TABLE "BotAccount"
ADD COLUMN IF NOT EXISTS "publishTextTemplate" JSONB NOT NULL DEFAULT '{"includePostId":true,"includeAuthorMention":false,"includeLinks":false,"customText":""}';
