ALTER TABLE "BotAccount"
ADD COLUMN "userMessageReply" TEXT NOT NULL DEFAULT '发送 #注册账号 可以用当前 QQ 注册本校园墙账号。
发送 #重置密码 可以重置你的登录密码。';

ALTER TABLE "BotAccount"
ADD COLUMN "userMessageReplyCooldownSeconds" INTEGER NOT NULL DEFAULT 60;
