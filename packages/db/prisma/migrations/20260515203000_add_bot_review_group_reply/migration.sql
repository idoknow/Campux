ALTER TABLE "BotAccount"
ADD COLUMN "reviewGroupMessageReply" TEXT NOT NULL DEFAULT '审核命令：
#通过 <稿件id>
#拒绝 <理由> <稿件id>
#重发 <稿件id>
#登录 或 #刷新qzone cookies
#扫码登录';
