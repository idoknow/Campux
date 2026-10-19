-- 账号可恢复链路所需的字段：
-- 1) User.tokenVersion：改密时 +1，用于让旧登录会话一次性失效；
-- 2) AccountSession.tokenVersion：签发时记录当时的密码版本，与会话校验时比对；
-- 3) EmailVerificationCode.userId：按账号限流，并把密码重置码绑定到具体账号。
ALTER TABLE "User" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AccountSession" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "EmailVerificationCode" ADD COLUMN "userId" TEXT;

CREATE INDEX "EmailVerificationCode_userId_purpose_createdAt_idx" ON "EmailVerificationCode"("userId", "purpose", "createdAt");
