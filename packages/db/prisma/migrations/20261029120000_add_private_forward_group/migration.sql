-- 用户私聊消息转发目标群。
-- 留空（NULL）表示不转发；管理员可在「管理 → 机器人」里改为其他群。
ALTER TABLE "BotAccount" ADD COLUMN IF NOT EXISTS "privateForwardGroupId" TEXT;

-- 保持既有行为：已经配置审核群的墙号，迁移后默认继续转发到审核群。
UPDATE "BotAccount"
   SET "privateForwardGroupId" = "reviewGroupId"
 WHERE "privateForwardGroupId" IS NULL
   AND "reviewGroupId" IS NOT NULL;
