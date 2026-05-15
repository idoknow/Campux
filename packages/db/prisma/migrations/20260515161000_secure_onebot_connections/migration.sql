DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "BotAccount"
    GROUP BY "qqUin"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Bot QQ must be globally unique before enabling OneBot connection tokens';
  END IF;
END $$;

ALTER TABLE "BotAccount"
ADD COLUMN IF NOT EXISTS "connectionToken" TEXT;

UPDATE "BotAccount"
SET "connectionToken" = md5(random()::text || clock_timestamp()::text || id)
WHERE "connectionToken" IS NULL OR "connectionToken" = '';

ALTER TABLE "BotAccount"
ALTER COLUMN "connectionToken" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "BotAccount_qqUin_key" ON "BotAccount"("qqUin");
CREATE UNIQUE INDEX IF NOT EXISTS "BotAccount_connectionToken_key" ON "BotAccount"("connectionToken");
