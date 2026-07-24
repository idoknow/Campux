-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "host" TEXT,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "themeColor" TEXT NOT NULL DEFAULT '#e0574f',
    "nextPostDisplayId" INTEGER NOT NULL DEFAULT 1,
    "readyAt" DATETIME,
    "archiveWarningAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "qqUin" BIGINT NOT NULL,
    "email" TEXT,
    "displayName" TEXT,
    "passwordHash" TEXT NOT NULL,
    "passwordChangeRequired" BOOLEAN NOT NULL DEFAULT false,
    "autoFollowOwnPosts" BOOLEAN NOT NULL DEFAULT true,
    "isTestAccount" BOOLEAN NOT NULL DEFAULT false,
    "systemRole" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "EmailVerificationCode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" DATETIME NOT NULL,
    "consumedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AccountSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "selectedTenantId" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AccountSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AccountSession_selectedTenantId_fkey" FOREIGN KEY ("selectedTenantId") REFERENCES "Tenant" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TenantMembership" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'submitter',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TenantMembership_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TenantMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TenantMetadata" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TenantMetadata_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OAuthClient" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientSecretHash" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "pkceRequired" BOOLEAN NOT NULL DEFAULT true,
    "redirectUris" JSONB NOT NULL DEFAULT '[]',
    "scopes" JSONB NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OAuthClient_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OAuthAuthorizationCode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "state" TEXT,
    "codeChallenge" TEXT,
    "codeChallengeMethod" TEXT NOT NULL DEFAULT 'S256',
    "expiresAt" DATETIME NOT NULL,
    "consumedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OAuthAuthorizationCode_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OAuthAuthorizationCode_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "OAuthClient" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OAuthAuthorizationCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OAuthAccessToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "refreshTokenHash" TEXT,
    "scope" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "refreshExpiresAt" DATETIME,
    "revokedAt" DATETIME,
    "lastUsedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OAuthAccessToken_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OAuthAccessToken_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "OAuthClient" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OAuthAccessToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Post" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "displayId" INTEGER NOT NULL,
    "legacyTenantSlug" TEXT,
    "legacyDisplayId" INTEGER,
    "legacyUuid" TEXT,
    "text" TEXT NOT NULL,
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "anonymous" BOOLEAN NOT NULL DEFAULT false,
    "anonymousAvatar" TEXT,
    "bgColor" TEXT,
    "textColor" TEXT,
    "font" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending_approval',
    "publishSummary" TEXT,
    "recallIgnored" BOOLEAN NOT NULL DEFAULT false,
    "recallIgnoredAt" DATETIME,
    "reviewQueueReminderSentAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Post_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Post_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PostTag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT NOT NULL DEFAULT '#e2e8f0',
    "status" TEXT NOT NULL DEFAULT 'active',
    "source" TEXT NOT NULL DEFAULT 'llm',
    "lastUsedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PostTag_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PostTagAssignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'llm',
    "confidence" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PostTagAssignment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PostTagAssignment_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "PostTag" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PostFollow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastPushedAt" DATETIME,
    "lastPushedCommentCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PostFollow_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PostFollow_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PostLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "actorId" TEXT,
    "oldStatus" TEXT,
    "newStatus" TEXT NOT NULL,
    "comment" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PostLog_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BotAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'onebot',
    "qqUin" BIGINT NOT NULL,
    "officialAppId" TEXT,
    "officialAppSecret" JSONB,
    "displayName" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "reviewGroupId" TEXT,
    "reviewNotificationEnabled" BOOLEAN NOT NULL DEFAULT false,
    "reviewQueueAutoReminderEnabled" BOOLEAN NOT NULL DEFAULT false,
    "reviewQueueReminderThresholdHours" INTEGER NOT NULL DEFAULT 6,
    "autoFriendRequestApprovalEnabled" BOOLEAN NOT NULL DEFAULT false,
    "connectionToken" TEXT NOT NULL,
    "publishTextTemplate" JSONB NOT NULL DEFAULT '{"includePostId":true,"includeAuthorMention":false,"includeLinks":false,"customText":""}',
    "userMessageReply" TEXT NOT NULL DEFAULT '首次私聊会自动注册 Campux 账号。
发送 #投稿 开始投稿。
忘记密码时，请发送 #重置密码 获取新密码。',
    "userMessageReplyCooldownSeconds" INTEGER NOT NULL DEFAULT 60,
    "reviewGroupMessageReply" TEXT NOT NULL DEFAULT '审核命令：
#通过 <稿件id>
#拒绝 <理由> <稿件id>
#重发 <稿件id>
#登录 或 #刷新qzone cookies
#扫码登录',
    "privateMessagesReceived" INTEGER NOT NULL DEFAULT 0,
    "adminRepliesSent" INTEGER NOT NULL DEFAULT 0,
    "lastSeenAt" DATETIME,
    "lastPublishStartedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BotAccount_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BotSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "botAccountId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'qzone',
    "domain" TEXT NOT NULL DEFAULT 'user.qzone.qq.com',
    "cookies" JSONB NOT NULL,
    "rawCookies" TEXT,
    "refreshedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME,
    "healthStatus" TEXT NOT NULL DEFAULT 'unchecked',
    "healthCheckedAt" DATETIME,
    "healthMessage" TEXT,
    "healthFailureCount" INTEGER NOT NULL DEFAULT 0,
    "healthInvalidNotifiedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BotSession_botAccountId_fkey" FOREIGN KEY ("botAccountId") REFERENCES "BotAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QZoneVisitorSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "botAccountId" TEXT NOT NULL,
    "sessionId" TEXT,
    "date" DATETIME NOT NULL,
    "todayCount" INTEGER NOT NULL,
    "totalCount" INTEGER NOT NULL,
    "checkedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "QZoneVisitorSnapshot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QZoneVisitorSnapshot_botAccountId_fkey" FOREIGN KEY ("botAccountId") REFERENCES "BotAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BotFriendSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "botAccountId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "friendCount" INTEGER NOT NULL,
    "checkedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BotFriendSnapshot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BotFriendSnapshot_botAccountId_fkey" FOREIGN KEY ("botAccountId") REFERENCES "BotAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PublishTarget" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "botAccountId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'qzone',
    "displayName" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "publishDelaySeconds" INTEGER NOT NULL DEFAULT 10,
    "failurePolicy" TEXT NOT NULL DEFAULT 'block_post',
    "qzoneRefreshMode" TEXT NOT NULL DEFAULT 'protocol',
    CONSTRAINT "PublishTarget_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PublishTarget_botAccountId_fkey" FOREIGN KEY ("botAccountId") REFERENCES "BotAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PublishAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "publishTargetId" TEXT NOT NULL,
    "batchId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "verbose" JSONB,
    "nextRunAt" DATETIME,
    "externalId" TEXT,
    "qzoneTid" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PublishAttempt_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PublishAttempt_publishTargetId_fkey" FOREIGN KEY ("publishTargetId") REFERENCES "PublishTarget" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PublishAttempt_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "PublishBatch" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PublishBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'collecting',
    "imageCount" INTEGER NOT NULL DEFAULT 0,
    "flushedAt" DATETIME,
    "lastItemAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PublishBatch_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PublishBatchItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "batchId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "imageCount" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PublishBatchItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "PublishBatch" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PublishBatchItem_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QZonePostMetric" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "publishAttemptId" TEXT NOT NULL,
    "publishTargetId" TEXT NOT NULL,
    "botAccountId" TEXT NOT NULL,
    "qzoneTid" TEXT NOT NULL,
    "visitorCount" INTEGER,
    "likeCount" INTEGER,
    "commentCount" INTEGER,
    "forwardCount" INTEGER,
    "comments" JSONB,
    "lastError" TEXT,
    "lastVerbose" JSONB,
    "checkedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "QZonePostMetric_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QZonePostMetric_publishAttemptId_fkey" FOREIGN KEY ("publishAttemptId") REFERENCES "PublishAttempt" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BanRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "operatorId" TEXT,
    "comment" TEXT NOT NULL,
    "startsAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "detail" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TenantAiSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "mode" TEXT NOT NULL DEFAULT 'local',
    "provider" TEXT NOT NULL DEFAULT 'openai_compatible',
    "baseUrl" TEXT NOT NULL DEFAULT 'https://api.openai.com/v1',
    "model" TEXT NOT NULL DEFAULT 'gpt-4.1-mini',
    "apiKeySecret" JSONB,
    "temperature" REAL NOT NULL DEFAULT 0.2,
    "timeoutSeconds" INTEGER NOT NULL DEFAULT 30,
    "rules" JSONB NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TenantAiSettings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_host_key" ON "Tenant"("host");

-- CreateIndex
CREATE UNIQUE INDEX "User_qqUin_key" ON "User"("qqUin");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "EmailVerificationCode_email_purpose_createdAt_idx" ON "EmailVerificationCode"("email", "purpose", "createdAt");

-- CreateIndex
CREATE INDEX "EmailVerificationCode_expiresAt_idx" ON "EmailVerificationCode"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "AccountSession_tokenHash_key" ON "AccountSession"("tokenHash");

-- CreateIndex
CREATE INDEX "AccountSession_userId_idx" ON "AccountSession"("userId");

-- CreateIndex
CREATE INDEX "AccountSession_expiresAt_idx" ON "AccountSession"("expiresAt");

-- CreateIndex
CREATE INDEX "TenantMembership_userId_idx" ON "TenantMembership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TenantMembership_tenantId_userId_key" ON "TenantMembership"("tenantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "TenantMetadata_tenantId_key_key" ON "TenantMetadata"("tenantId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "OAuthClient_clientId_key" ON "OAuthClient"("clientId");

-- CreateIndex
CREATE INDEX "OAuthClient_tenantId_enabled_idx" ON "OAuthClient"("tenantId", "enabled");

-- CreateIndex
CREATE INDEX "OAuthClient_tenantId_name_idx" ON "OAuthClient"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "OAuthAuthorizationCode_codeHash_key" ON "OAuthAuthorizationCode"("codeHash");

-- CreateIndex
CREATE INDEX "OAuthAuthorizationCode_tenantId_clientId_expiresAt_idx" ON "OAuthAuthorizationCode"("tenantId", "clientId", "expiresAt");

-- CreateIndex
CREATE INDEX "OAuthAuthorizationCode_userId_createdAt_idx" ON "OAuthAuthorizationCode"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OAuthAccessToken_tokenHash_key" ON "OAuthAccessToken"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "OAuthAccessToken_refreshTokenHash_key" ON "OAuthAccessToken"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "OAuthAccessToken_tenantId_clientId_expiresAt_idx" ON "OAuthAccessToken"("tenantId", "clientId", "expiresAt");

-- CreateIndex
CREATE INDEX "OAuthAccessToken_userId_createdAt_idx" ON "OAuthAccessToken"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Post_tenantId_status_createdAt_idx" ON "Post"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Post_tenantId_status_reviewQueueReminderSentAt_idx" ON "Post"("tenantId", "status", "reviewQueueReminderSentAt");

-- CreateIndex
CREATE UNIQUE INDEX "Post_tenantId_displayId_key" ON "Post"("tenantId", "displayId");

-- CreateIndex
CREATE UNIQUE INDEX "Post_tenantId_legacyDisplayId_key" ON "Post"("tenantId", "legacyDisplayId");

-- CreateIndex
CREATE INDEX "PostTag_tenantId_status_updatedAt_idx" ON "PostTag"("tenantId", "status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PostTag_tenantId_name_key" ON "PostTag"("tenantId", "name");

-- CreateIndex
CREATE INDEX "PostTagAssignment_tenantId_tagId_idx" ON "PostTagAssignment"("tenantId", "tagId");

-- CreateIndex
CREATE INDEX "PostTagAssignment_tenantId_postId_idx" ON "PostTagAssignment"("tenantId", "postId");

-- CreateIndex
CREATE UNIQUE INDEX "PostTagAssignment_postId_tagId_key" ON "PostTagAssignment"("postId", "tagId");

-- CreateIndex
CREATE INDEX "PostFollow_userId_idx" ON "PostFollow"("userId");

-- CreateIndex
CREATE INDEX "PostFollow_postId_idx" ON "PostFollow"("postId");

-- CreateIndex
CREATE UNIQUE INDEX "PostFollow_postId_userId_key" ON "PostFollow"("postId", "userId");

-- CreateIndex
CREATE INDEX "PostLog_tenantId_postId_createdAt_idx" ON "PostLog"("tenantId", "postId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BotAccount_tenantId_qqUin_key" ON "BotAccount"("tenantId", "qqUin");

-- CreateIndex
CREATE UNIQUE INDEX "BotAccount_connectionToken_key" ON "BotAccount"("connectionToken");

-- CreateIndex
CREATE INDEX "BotSession_botAccountId_refreshedAt_idx" ON "BotSession"("botAccountId", "refreshedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BotSession_botAccountId_type_domain_key" ON "BotSession"("botAccountId", "type", "domain");

-- CreateIndex
CREATE INDEX "QZoneVisitorSnapshot_tenantId_date_idx" ON "QZoneVisitorSnapshot"("tenantId", "date");

-- CreateIndex
CREATE INDEX "QZoneVisitorSnapshot_botAccountId_checkedAt_idx" ON "QZoneVisitorSnapshot"("botAccountId", "checkedAt");

-- CreateIndex
CREATE UNIQUE INDEX "QZoneVisitorSnapshot_botAccountId_date_key" ON "QZoneVisitorSnapshot"("botAccountId", "date");

-- CreateIndex
CREATE INDEX "BotFriendSnapshot_tenantId_date_idx" ON "BotFriendSnapshot"("tenantId", "date");

-- CreateIndex
CREATE INDEX "BotFriendSnapshot_botAccountId_checkedAt_idx" ON "BotFriendSnapshot"("botAccountId", "checkedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BotFriendSnapshot_botAccountId_date_key" ON "BotFriendSnapshot"("botAccountId", "date");

-- CreateIndex
CREATE INDEX "PublishTarget_tenantId_enabled_idx" ON "PublishTarget"("tenantId", "enabled");

-- CreateIndex
CREATE INDEX "PublishAttempt_tenantId_status_nextRunAt_idx" ON "PublishAttempt"("tenantId", "status", "nextRunAt");

-- CreateIndex
CREATE INDEX "PublishAttempt_batchId_idx" ON "PublishAttempt"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "PublishAttempt_postId_publishTargetId_key" ON "PublishAttempt"("postId", "publishTargetId");

-- CreateIndex
CREATE UNIQUE INDEX "PublishAttempt_batchId_publishTargetId_key" ON "PublishAttempt"("batchId", "publishTargetId");

-- CreateIndex
CREATE INDEX "PublishBatch_tenantId_status_lastItemAt_idx" ON "PublishBatch"("tenantId", "status", "lastItemAt");

-- CreateIndex
CREATE INDEX "PublishBatchItem_batchId_position_idx" ON "PublishBatchItem"("batchId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "PublishBatchItem_batchId_postId_key" ON "PublishBatchItem"("batchId", "postId");

-- CreateIndex
CREATE UNIQUE INDEX "PublishBatchItem_postId_key" ON "PublishBatchItem"("postId");

-- CreateIndex
CREATE UNIQUE INDEX "QZonePostMetric_publishAttemptId_key" ON "QZonePostMetric"("publishAttemptId");

-- CreateIndex
CREATE INDEX "QZonePostMetric_tenantId_postId_idx" ON "QZonePostMetric"("tenantId", "postId");

-- CreateIndex
CREATE INDEX "QZonePostMetric_tenantId_checkedAt_idx" ON "QZonePostMetric"("tenantId", "checkedAt");

-- CreateIndex
CREATE INDEX "QZonePostMetric_botAccountId_checkedAt_idx" ON "QZonePostMetric"("botAccountId", "checkedAt");

-- CreateIndex
CREATE INDEX "BanRecord_tenantId_userId_endsAt_idx" ON "BanRecord"("tenantId", "userId", "endsAt");

-- CreateIndex
CREATE INDEX "BanRecord_tenantId_endsAt_idx" ON "BanRecord"("tenantId", "endsAt");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_createdAt_idx" ON "AuditLog"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TenantAiSettings_tenantId_key" ON "TenantAiSettings"("tenantId");

