-- 移除官方机器人凭证字段，新增个人QQ频道机器人(MCP直连)token。
-- 对应 schema.prisma BotAccount：删 officialAppId/officialAppSecret，加 personalQqToken(加密JSON)。
-- 由 prisma migrate diff --from-schema-datamodel 生成。
ALTER TABLE "BotAccount" DROP COLUMN "officialAppId",
DROP COLUMN "officialAppSecret",
ADD COLUMN     "personalQqToken" JSONB;