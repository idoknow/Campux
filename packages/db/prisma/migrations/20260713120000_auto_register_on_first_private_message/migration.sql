ALTER TABLE "BotAccount"
ALTER COLUMN "userMessageReply" SET DEFAULT '首次私聊会自动注册 Campux 账号。
发送 #投稿 开始投稿。
忘记密码时，请发送 #重置密码 获取新密码。';

UPDATE "BotAccount"
SET "userMessageReply" = '首次私聊会自动注册 Campux 账号。
发送 #投稿 开始投稿。
忘记密码时，请发送 #重置密码 获取新密码。'
WHERE "userMessageReply" = '发送 #注册账号 可以用当前 QQ 注册本校园墙账号。
发送 #重置密码 可以重置你的登录密码。';
