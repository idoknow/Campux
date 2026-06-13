-- Add private message and admin reply counter columns to BotAccount
ALTER TABLE "BotAccount" ADD COLUMN "privateMessagesReceived" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "BotAccount" ADD COLUMN "adminRepliesSent" INTEGER NOT NULL DEFAULT 0;
