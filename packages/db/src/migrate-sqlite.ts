import { createHash, randomUUID } from "node:crypto";
import { Database } from "bun:sqlite";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";

/**
 * SQLite 自包含迁移器。
 *
 * 单文件 / 自托管 SQLite 形态以派生 baseline 建库，并在每次启动时继续执行本文件登记的
 * 增量迁移。baseline 由 scripts/generate-sqlite-schema.ts 生成并在编译期内嵌。
 *
 * 记账：沿用与 Prisma 兼容的 `_prisma_migrations` 表，把 baseline 记作一条名为
 * `0_sqlite_baseline` 的迁移（checksum = sha256(baselineSql)）。重复启动时按 name 跳过，
 * 实现幂等。这样即便将来引入「sqlite 增量迁移目录」，也能与本 baseline 记账无缝衔接。
 *
 * 仅依赖 Bun 内置的 `bun:sqlite`，无需 Prisma 引擎，可在 Prisma Client 初始化之前安全运行。
 */

const SQLITE_BASELINE_NAME = "0_sqlite_baseline";
const FIRST_PRIVATE_MESSAGE_MIGRATION_NAME = "20260713120000_auto_register_on_first_private_message";
const LAST_PUBLISH_STARTED_AT_MIGRATION_NAME = "20260724090000_add_bot_last_publish_started_at";
const REVIEW_QUEUE_REMINDER_AT_ALL_MIGRATION_NAME = "20260815120000_add_bot_review_queue_reminder_at_all";
const VOTING_CAMPAIGNS_MIGRATION_NAME = "20260906120000_add_voting_campaigns";
const CAMPAIGN_ADMIN_ONLY_MIGRATION_NAME = "20260906150000_add_campaign_admin_only";
const OAUTH_IDENTITY_MIGRATION_NAME = "20260907120000_add_oauth_identity";
const PERSONAL_QQ_TOKEN_MIGRATION_NAME = "20260909000000_add_personal_qq_token";
const CAMPAIGN_TABLES_MIGRATION_NAME = "20260913120000_add_campaign_tables_sqlite";
const TENANT_FEEDBACK_MIGRATION_NAME = "20260913140000_add_tenant_feedback";
const TENANT_FEEDBACK_MESSAGES_MIGRATION_NAME = "20260913160000_add_tenant_feedback_messages";
const OLD_PRIVATE_MESSAGE_REPLY = `发送 #注册账号 可以用当前 QQ 注册本校园墙账号。
发送 #重置密码 可以重置你的登录密码。`;
const NEW_PRIVATE_MESSAGE_REPLY = `首次私聊会自动注册 Campux 账号。
发送 #投稿 开始投稿。
忘记密码时，请发送 #重置密码 获取新密码。`;

const PRISMA_MIGRATIONS_DDL_SQLITE = `CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "checksum" TEXT NOT NULL,
  "finished_at" DATETIME,
  "migration_name" TEXT NOT NULL,
  "logs" TEXT,
  "rolled_back_at" DATETIME,
  "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "applied_steps_count" INTEGER NOT NULL DEFAULT 0
)`;

export interface SqliteMigrateResult {
  applied: string[];
  skipped: string[];
}

export interface SqliteMigrateLogger {
  info: (obj: unknown, msg?: string) => void;
  warn?: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
}

function checksumOf(sql: string): string {
  return createHash("sha256").update(sql, "utf8").digest("hex");
}

/**
 * 把 `file:/path/to.db` / `sqlite:/path` / 裸路径 归一化为磁盘文件路径。
 * 支持 `file:./data/campux.db`（相对当前工作目录）与 `file:/abs/path.db`（绝对）。
 */
export function sqliteFilePathFromUrl(databaseUrl: string): string {
  let p = databaseUrl.trim();
  if (p.startsWith("file:")) p = p.slice("file:".length);
  else if (p.startsWith("sqlite://")) p = p.slice("sqlite://".length);
  else if (p.startsWith("sqlite:")) p = p.slice("sqlite:".length);
  // 去掉可能的查询串（?connection_limit=... 之类，SQLite 用不到）
  const q = p.indexOf("?");
  if (q >= 0) p = p.slice(0, q);
  return p;
}

function sqlStringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function applyFirstPrivateMessageSqliteMigration(
  db: Database,
  doneNames: Set<string>,
  applied: string[],
  skipped: string[],
  logger: SqliteMigrateLogger,
): void {
  const botTable = db
    .query(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'BotAccount'`)
    .get() as { sql: string } | null;
  // Small migration-unit tests and pre-Campux databases may not contain this product table.
  if (!botTable) return;

  if (doneNames.has(FIRST_PRIVATE_MESSAGE_MIGRATION_NAME)) {
    skipped.push(FIRST_PRIVATE_MESSAGE_MIGRATION_NAME);
    return;
  }

  const oldDefault = `DEFAULT ${sqlStringLiteral(OLD_PRIVATE_MESSAGE_REPLY)}`;
  const newDefault = `DEFAULT ${sqlStringLiteral(NEW_PRIVATE_MESSAGE_REPLY)}`;
  const schemaObjects = db
    .query(
      `SELECT type, name, sql FROM sqlite_master
       WHERE tbl_name = 'BotAccount' AND type IN ('index', 'trigger') AND sql IS NOT NULL
       ORDER BY type, name`,
    )
    .all() as Array<{ type: string; name: string; sql: string }>;

  logger.info({ migration: FIRST_PRIVATE_MESSAGE_MIGRATION_NAME }, "applying sqlite incremental migration");
  // Rebuilding a referenced table requires foreign_keys=OFF outside the transaction. The
  // transaction plus foreign_key_check still makes the operation atomic and integrity-checked.
  db.exec("PRAGMA foreign_keys=OFF");
  db.exec("BEGIN");
  try {
    // The DDL stored in sqlite_master may use ' literals or '' escaped form; we check by SQL content.
    const currentDefault = (
      db.query(`SELECT "dflt_value" FROM pragma_table_info('BotAccount') WHERE name = 'userMessageReply'`).get() as { dflt_value: string | null } | null
    )?.dflt_value ?? null;
    if (currentDefault === newDefault || currentDefault === sqlStringLiteral(newDefault)) {
      // Already on the new default — nothing to do.
    } else if (botTable.sql.includes(oldDefault)) {
      const temporaryTable = "BotAccount__first_private_message_migration";
      const createSql = botTable.sql
        .replace(/^CREATE TABLE\s+"?BotAccount"?/i, `CREATE TABLE ${quoteIdentifier(temporaryTable)}`)
        .replace(oldDefault, newDefault);
      if (createSql === botTable.sql || !createSql.includes(newDefault)) {
        throw new Error("could not rewrite BotAccount userMessageReply default");
      }

      const columns = (
        db.query(`SELECT name FROM pragma_table_info('BotAccount') ORDER BY cid`).all() as Array<{ name: string }>
      ).map((row) => quoteIdentifier(row.name));
      const columnList = columns.join(", ");
      db.exec(createSql);
      db.exec(
        `INSERT INTO ${quoteIdentifier(temporaryTable)} (${columnList}) SELECT ${columnList} FROM "BotAccount"`,
      );
      db.exec(`DROP TABLE "BotAccount"`);
      db.exec(`ALTER TABLE ${quoteIdentifier(temporaryTable)} RENAME TO "BotAccount"`);
      for (const schemaObject of schemaObjects) {
        db.exec(schemaObject.sql);
      }
    } else {
      throw new Error("BotAccount userMessageReply has an unrecognized default; refusing unsafe schema rewrite");
    }

    db.run(`UPDATE "BotAccount" SET "userMessageReply" = ? WHERE "userMessageReply" = ?`, [
      NEW_PRIVATE_MESSAGE_REPLY,
      OLD_PRIVATE_MESSAGE_REPLY,
    ]);
    db.run(
      `INSERT INTO "_prisma_migrations"
         ("id","checksum","migration_name","started_at","finished_at","applied_steps_count")
       VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1)`,
      [
        randomUUID(),
        checksumOf(`${oldDefault}\n${newDefault}`),
        FIRST_PRIVATE_MESSAGE_MIGRATION_NAME,
      ],
    );
    const violations = db.query("PRAGMA foreign_key_check").all();
    if (violations.length > 0) {
      throw new Error(`sqlite migration introduced ${violations.length} foreign-key violation(s)`);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.exec("PRAGMA foreign_keys=ON");
  }

  doneNames.add(FIRST_PRIVATE_MESSAGE_MIGRATION_NAME);
  applied.push(FIRST_PRIVATE_MESSAGE_MIGRATION_NAME);
  logger.info({ migration: FIRST_PRIVATE_MESSAGE_MIGRATION_NAME }, "sqlite incremental migration applied");
}

function applyLastPublishStartedAtSqliteMigration(
  db: Database,
  doneNames: Set<string>,
  applied: string[],
  skipped: string[],
  logger: SqliteMigrateLogger,
): void {
  const botTable = db
    .query(`SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'BotAccount'`)
    .get() as { present: number } | null;
  if (!botTable) return;

  if (doneNames.has(LAST_PUBLISH_STARTED_AT_MIGRATION_NAME)) {
    skipped.push(LAST_PUBLISH_STARTED_AT_MIGRATION_NAME);
    return;
  }

  const publishStartedColumn = db
    .query(`SELECT 1 AS present FROM pragma_table_info('BotAccount') WHERE name = 'lastPublishStartedAt'`)
    .get() as { present: number } | null;
  const hasColumn = publishStartedColumn !== null;

  logger.info({ migration: LAST_PUBLISH_STARTED_AT_MIGRATION_NAME }, "applying sqlite incremental migration");
  db.exec("BEGIN");
  try {
    if (!hasColumn) {
      db.exec(`ALTER TABLE "BotAccount" ADD COLUMN "lastPublishStartedAt" DATETIME`);
    }
    db.run(
      `INSERT INTO "_prisma_migrations"
         ("id","checksum","migration_name","started_at","finished_at","applied_steps_count")
       VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1)`,
      [
        randomUUID(),
        checksumOf(`ALTER TABLE "BotAccount" ADD COLUMN "lastPublishStartedAt" DATETIME`),
        LAST_PUBLISH_STARTED_AT_MIGRATION_NAME,
      ],
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  doneNames.add(LAST_PUBLISH_STARTED_AT_MIGRATION_NAME);
  applied.push(LAST_PUBLISH_STARTED_AT_MIGRATION_NAME);
  logger.info({ migration: LAST_PUBLISH_STARTED_AT_MIGRATION_NAME }, "sqlite incremental migration applied");
}

function applyReviewQueueReminderAtAllSqliteMigration(
  db: Database,
  doneNames: Set<string>,
  applied: string[],
  skipped: string[],
  logger: SqliteMigrateLogger,
): void {
  const botTable = db
    .query(`SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'BotAccount'`)
    .get() as { present: number } | null;
  if (!botTable) return;

  if (doneNames.has(REVIEW_QUEUE_REMINDER_AT_ALL_MIGRATION_NAME)) {
    skipped.push(REVIEW_QUEUE_REMINDER_AT_ALL_MIGRATION_NAME);
    return;
  }

  const reminderAtAllColumn = db
    .query(`SELECT 1 AS present FROM pragma_table_info('BotAccount') WHERE name = 'reviewQueueReminderAtAll'`)
    .get() as { present: number } | null;
  const hasColumn = reminderAtAllColumn !== null;

  logger.info({ migration: REVIEW_QUEUE_REMINDER_AT_ALL_MIGRATION_NAME }, "applying sqlite incremental migration");
  db.exec("BEGIN");
  try {
    if (!hasColumn) {
      db.exec(`ALTER TABLE "BotAccount" ADD COLUMN "reviewQueueReminderAtAll" BOOLEAN NOT NULL DEFAULT false`);
    }
    db.run(
      `INSERT INTO "_prisma_migrations"
         ("id","checksum","migration_name","started_at","finished_at","applied_steps_count")
       VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1)`,
      [
        randomUUID(),
        checksumOf(`ALTER TABLE "BotAccount" ADD COLUMN "reviewQueueReminderAtAll" BOOLEAN NOT NULL DEFAULT false`),
        REVIEW_QUEUE_REMINDER_AT_ALL_MIGRATION_NAME,
      ],
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  doneNames.add(REVIEW_QUEUE_REMINDER_AT_ALL_MIGRATION_NAME);
  applied.push(REVIEW_QUEUE_REMINDER_AT_ALL_MIGRATION_NAME);
  logger.info({ migration: REVIEW_QUEUE_REMINDER_AT_ALL_MIGRATION_NAME }, "sqlite incremental migration applied");
}

/**
 * Campaign.adminOnly「仅管理可见」开关的 SQLite 增量迁移。
 * 老库没有该列时补上；新库由刷新后的 baseline 自带，迁移会幂等跳过。
 */
function applyCampaignAdminOnlySqliteMigration(
  db: Database,
  doneNames: Set<string>,
  applied: string[],
  skipped: string[],
  logger: SqliteMigrateLogger,
): void {
  const campaignTable = db
    .query(`SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'Campaign'`)
    .get() as { present: number } | null;
  if (!campaignTable) return;

  if (doneNames.has(CAMPAIGN_ADMIN_ONLY_MIGRATION_NAME)) {
    skipped.push(CAMPAIGN_ADMIN_ONLY_MIGRATION_NAME);
    return;
  }

  const adminOnlyColumn = db
    .query(`SELECT 1 AS present FROM pragma_table_info('Campaign') WHERE name = 'adminOnly'`)
    .get() as { present: number } | null;
  const hasColumn = adminOnlyColumn !== null;

  logger.info({ migration: CAMPAIGN_ADMIN_ONLY_MIGRATION_NAME }, "applying sqlite incremental migration");
  db.exec("BEGIN");
  try {
    if (!hasColumn) {
      db.exec(`ALTER TABLE "Campaign" ADD COLUMN "adminOnly" BOOLEAN NOT NULL DEFAULT false`);
    }
    db.run(
      `INSERT INTO "_prisma_migrations"
         ("id","checksum","migration_name","started_at","finished_at","applied_steps_count")
       VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1)`,
      [
        randomUUID(),
        checksumOf(`ALTER TABLE "Campaign" ADD COLUMN "adminOnly" BOOLEAN NOT NULL DEFAULT false`),
        CAMPAIGN_ADMIN_ONLY_MIGRATION_NAME,
      ],
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  doneNames.add(CAMPAIGN_ADMIN_ONLY_MIGRATION_NAME);
  applied.push(CAMPAIGN_ADMIN_ONLY_MIGRATION_NAME);
  logger.info({ migration: CAMPAIGN_ADMIN_ONLY_MIGRATION_NAME }, "sqlite incremental migration applied");
}

/**
 * 竞选表的 SQLite 增量迁移：只补 Tenant 的编号列；Campaign / CampaignOption /
 * CampaignVote 三张全新表由刷新后的 baseline DDL 创建（SQLite 不建 enum，
 * status 为 TEXT 并靠应用层校验取值）。
 */
function applyVotingCampaignsSqliteMigration(
  db: Database,
  doneNames: Set<string>,
  applied: string[],
  skipped: string[],
  logger: SqliteMigrateLogger,
): void {
  const tenantTable = db
    .query(`SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'Tenant'`)
    .get() as { present: number } | null;
  if (!tenantTable) return;

  if (doneNames.has(VOTING_CAMPAIGNS_MIGRATION_NAME)) {
    skipped.push(VOTING_CAMPAIGNS_MIGRATION_NAME);
    return;
  }

  const displayColumn = db
    .query(`SELECT 1 AS present FROM pragma_table_info('Tenant') WHERE name = 'nextCampaignDisplayId'`)
    .get() as { present: number } | null;
  const hasColumn = displayColumn !== null;

  logger.info({ migration: VOTING_CAMPAIGNS_MIGRATION_NAME }, "applying sqlite incremental migration");
  db.exec("BEGIN");
  try {
    if (!hasColumn) {
      db.exec(`ALTER TABLE "Tenant" ADD COLUMN "nextCampaignDisplayId" INTEGER NOT NULL DEFAULT 1`);
    }
    db.run(
      `INSERT INTO "_prisma_migrations"
         ("id","checksum","migration_name","started_at","finished_at","applied_steps_count")
       VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1)`,
      [
        randomUUID(),
        checksumOf(`ALTER TABLE "Tenant" ADD COLUMN "nextCampaignDisplayId" INTEGER NOT NULL DEFAULT 1`),
        VOTING_CAMPAIGNS_MIGRATION_NAME,
      ],
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  doneNames.add(VOTING_CAMPAIGNS_MIGRATION_NAME);
  applied.push(VOTING_CAMPAIGNS_MIGRATION_NAME);
  logger.info({ migration: VOTING_CAMPAIGNS_MIGRATION_NAME }, "sqlite incremental migration applied");
}

/**
 * OAuthIdentity（聚合登录身份绑定）：老库缺表时补建。
 */
function applyOAuthIdentitySqliteMigration(
  db: Database,
  doneNames: Set<string>,
  applied: string[],
  skipped: string[],
  logger: SqliteMigrateLogger,
): void {
  const userTable = db
    .query(`SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'User'`)
    .get() as { present: number } | null;
  // Minimal migration-unit tests and pre-Campux databases may not contain User.
  if (!userTable) return;

  if (doneNames.has(OAUTH_IDENTITY_MIGRATION_NAME)) {
    skipped.push(OAUTH_IDENTITY_MIGRATION_NAME);
    return;
  }

  const table = db
    .query(`SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'OAuthIdentity'`)
    .get() as { present: number } | null;
  const hasTable = table !== null;

  logger.info({ migration: OAUTH_IDENTITY_MIGRATION_NAME }, "applying sqlite incremental migration");
  db.exec("BEGIN");
  try {
    if (!hasTable) {
      db.exec(`CREATE TABLE "OAuthIdentity" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "userId" TEXT NOT NULL,
        "provider" TEXT NOT NULL,
        "providerUserId" TEXT NOT NULL,
        "name" TEXT,
        "avatar" TEXT,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "OAuthIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
      )`);
      db.exec(`CREATE INDEX "OAuthIdentity_userId_idx" ON "OAuthIdentity"("userId")`);
      db.exec(`CREATE UNIQUE INDEX "OAuthIdentity_provider_providerUserId_key" ON "OAuthIdentity"("provider", "providerUserId")`);
    }
    // Bound as ? below — static seed only (not SQL interpolation).
    const checksumSeed = hasTable ? "create-oauth-identity-present" : "create-oauth-identity-missing";
    db.run(
      `INSERT INTO "_prisma_migrations"
         ("id","checksum","migration_name","started_at","finished_at","applied_steps_count")
       VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1)`,
      [
        randomUUID(),
        checksumOf(checksumSeed),
        OAUTH_IDENTITY_MIGRATION_NAME,
      ],
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  doneNames.add(OAUTH_IDENTITY_MIGRATION_NAME);
  applied.push(OAUTH_IDENTITY_MIGRATION_NAME);
  logger.info({ migration: OAUTH_IDENTITY_MIGRATION_NAME }, "sqlite incremental migration applied");
}

/**
 * BotAccount.personalQqToken：个人 QQ 频道机器人 token。
 * 仅 ADD COLUMN；officialAppId/officialAppSecret 若仍存在则保留（客户端不再读取）。
 */
function applyPersonalQqTokenSqliteMigration(
  db: Database,
  doneNames: Set<string>,
  applied: string[],
  skipped: string[],
  logger: SqliteMigrateLogger,
): void {
  const botTable = db
    .query(`SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'BotAccount'`)
    .get() as { present: number } | null;
  if (!botTable) return;

  if (doneNames.has(PERSONAL_QQ_TOKEN_MIGRATION_NAME)) {
    skipped.push(PERSONAL_QQ_TOKEN_MIGRATION_NAME);
    return;
  }

  const column = db
    .query(`SELECT 1 AS present FROM pragma_table_info('BotAccount') WHERE name = 'personalQqToken'`)
    .get() as { present: number } | null;
  const hasColumn = column !== null;

  logger.info({ migration: PERSONAL_QQ_TOKEN_MIGRATION_NAME }, "applying sqlite incremental migration");
  db.exec("BEGIN");
  try {
    if (!hasColumn) {
      db.exec(`ALTER TABLE "BotAccount" ADD COLUMN "personalQqToken" JSONB`);
    }
    const checksumSeed = hasColumn ? "alter-bot-personalQqToken-present" : "alter-bot-personalQqToken-missing";
    db.run(
      `INSERT INTO "_prisma_migrations"
         ("id","checksum","migration_name","started_at","finished_at","applied_steps_count")
       VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1)`,
      [
        randomUUID(),
        checksumOf(checksumSeed),
        PERSONAL_QQ_TOKEN_MIGRATION_NAME,
      ],
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  doneNames.add(PERSONAL_QQ_TOKEN_MIGRATION_NAME);
  applied.push(PERSONAL_QQ_TOKEN_MIGRATION_NAME);
  logger.info({ migration: PERSONAL_QQ_TOKEN_MIGRATION_NAME }, "sqlite incremental migration applied");
}

/**
 * Campaign / CampaignOption / CampaignVote：老库缺表时按 baseline DDL 补建。
 * 仅补 Tenant 列的 20260906120000 迁移无法为旧库创建这三张表。
 */
function applyCampaignTablesSqliteMigration(
  db: Database,
  doneNames: Set<string>,
  applied: string[],
  skipped: string[],
  logger: SqliteMigrateLogger,
): void {
  const tenantTable = db
    .query(`SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'Tenant'`)
    .get() as { present: number } | null;
  if (!tenantTable) return;

  if (doneNames.has(CAMPAIGN_TABLES_MIGRATION_NAME)) {
    skipped.push(CAMPAIGN_TABLES_MIGRATION_NAME);
    return;
  }

  const campaignTable = db
    .query(`SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'Campaign'`)
    .get() as { present: number } | null;
  const hasTable = campaignTable !== null;

  logger.info({ migration: CAMPAIGN_TABLES_MIGRATION_NAME }, "applying sqlite incremental migration");
  db.exec("BEGIN");
  try {
    if (!hasTable) {
      db.exec(`CREATE TABLE "Campaign" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "tenantId" TEXT NOT NULL,
        "displayId" INTEGER NOT NULL,
        "authorId" TEXT NOT NULL,
        "title" TEXT NOT NULL,
        "coverAttachment" JSONB,
        "anonymous" BOOLEAN NOT NULL DEFAULT false,
        "votesPerPerson" INTEGER NOT NULL DEFAULT 1,
        "allowStackOnOption" BOOLEAN NOT NULL DEFAULT false,
        "showVoterDetails" BOOLEAN NOT NULL DEFAULT true,
        "durationHours" INTEGER NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'pending_approval',
        "adminOnly" BOOLEAN NOT NULL DEFAULT false,
        "rejectReason" TEXT,
        "startsAt" DATETIME,
        "endsAt" DATETIME,
        "takenDownAt" DATETIME,
        "takenDownById" TEXT,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL,
        CONSTRAINT "Campaign_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "Campaign_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
      )`);
      db.exec(`CREATE TABLE "CampaignOption" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "campaignId" TEXT,
        "sortOrder" INTEGER NOT NULL DEFAULT 0,
        "label" TEXT NOT NULL,
        "imageAttachment" JSONB,
        "voteTotal" INTEGER NOT NULL DEFAULT 0,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "CampaignOption_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE SET NULL ON UPDATE CASCADE
      )`);
      db.exec(`CREATE TABLE "CampaignVote" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "campaignId" TEXT NOT NULL,
        "optionId" TEXT NOT NULL,
        "voterId" TEXT NOT NULL,
        "count" INTEGER NOT NULL,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "CampaignVote_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "CampaignVote_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "CampaignOption" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "CampaignVote_voterId_fkey" FOREIGN KEY ("voterId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
      )`);
      db.exec(`CREATE UNIQUE INDEX "Campaign_tenantId_displayId_key" ON "Campaign"("tenantId", "displayId")`);
      db.exec(`CREATE INDEX "Campaign_tenantId_status_endsAt_idx" ON "Campaign"("tenantId", "status", "endsAt")`);
      db.exec(`CREATE INDEX "Campaign_tenantId_authorId_status_idx" ON "Campaign"("tenantId", "authorId", "status")`);
      db.exec(`CREATE UNIQUE INDEX "CampaignOption_campaignId_sortOrder_key" ON "CampaignOption"("campaignId", "sortOrder")`);
      db.exec(`CREATE INDEX "CampaignOption_campaignId_idx" ON "CampaignOption"("campaignId")`);
      db.exec(`CREATE UNIQUE INDEX "CampaignVote_campaignId_voterId_optionId_key" ON "CampaignVote"("campaignId", "voterId", "optionId")`);
      db.exec(`CREATE INDEX "CampaignVote_campaignId_voterId_idx" ON "CampaignVote"("campaignId", "voterId")`);
      db.exec(`CREATE INDEX "CampaignVote_optionId_idx" ON "CampaignVote"("optionId")`);
    }
    const checksumSeed = hasTable ? "create-campaign-tables-present" : "create-campaign-tables-missing";
    db.run(
      `INSERT INTO "_prisma_migrations"
         ("id","checksum","migration_name","started_at","finished_at","applied_steps_count")
       VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1)`,
      [
        randomUUID(),
        checksumOf(checksumSeed),
        CAMPAIGN_TABLES_MIGRATION_NAME,
      ],
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  doneNames.add(CAMPAIGN_TABLES_MIGRATION_NAME);
  applied.push(CAMPAIGN_TABLES_MIGRATION_NAME);
  logger.info({ migration: CAMPAIGN_TABLES_MIGRATION_NAME }, "sqlite incremental migration applied");
}

/**
 * TenantFeedback：意见反馈存档表。老库缺表时补建。
 */
function applyTenantFeedbackSqliteMigration(
  db: Database,
  doneNames: Set<string>,
  applied: string[],
  skipped: string[],
  logger: SqliteMigrateLogger,
): void {
  const tenantTable = db
    .query(`SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'Tenant'`)
    .get() as { present: number } | null;
  if (!tenantTable) return;

  if (doneNames.has(TENANT_FEEDBACK_MIGRATION_NAME)) {
    skipped.push(TENANT_FEEDBACK_MIGRATION_NAME);
    return;
  }

  const table = db
    .query(`SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'TenantFeedback'`)
    .get() as { present: number } | null;
  const hasTable = table !== null;

  logger.info({ migration: TENANT_FEEDBACK_MIGRATION_NAME }, "applying sqlite incremental migration");
  db.exec("BEGIN");
  try {
    if (!hasTable) {
      db.exec(`CREATE TABLE "TenantFeedback" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "tenantId" TEXT NOT NULL,
        "authorId" TEXT NOT NULL,
        "content" TEXT NOT NULL,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "TenantFeedback_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "TenantFeedback_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
      )`);
      db.exec(`CREATE INDEX "TenantFeedback_tenantId_createdAt_idx" ON "TenantFeedback"("tenantId", "createdAt")`);
      db.exec(`CREATE INDEX "TenantFeedback_tenantId_authorId_createdAt_idx" ON "TenantFeedback"("tenantId", "authorId", "createdAt")`);
    }
    const checksumSeed = hasTable ? "create-tenant-feedback-present" : "create-tenant-feedback-missing";
    db.run(
      `INSERT INTO "_prisma_migrations"
         ("id","checksum","migration_name","started_at","finished_at","applied_steps_count")
       VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1)`,
      [
        randomUUID(),
        checksumOf(checksumSeed),
        TENANT_FEEDBACK_MIGRATION_NAME,
      ],
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  doneNames.add(TENANT_FEEDBACK_MIGRATION_NAME);
  applied.push(TENANT_FEEDBACK_MIGRATION_NAME);
  logger.info({ migration: TENANT_FEEDBACK_MIGRATION_NAME }, "sqlite incremental migration applied");
}

/**
 * TenantFeedback.groupMessageId + TenantFeedbackMessage：意见对话。
 */
function applyTenantFeedbackMessagesSqliteMigration(
  db: Database,
  doneNames: Set<string>,
  applied: string[],
  skipped: string[],
  logger: SqliteMigrateLogger,
): void {
  const feedbackTable = db
    .query(`SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'TenantFeedback'`)
    .get() as { present: number } | null;
  if (!feedbackTable) return;

  if (doneNames.has(TENANT_FEEDBACK_MESSAGES_MIGRATION_NAME)) {
    skipped.push(TENANT_FEEDBACK_MESSAGES_MIGRATION_NAME);
    return;
  }

  const messageTable = db
    .query(`SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'TenantFeedbackMessage'`)
    .get() as { present: number } | null;
  const hasMessageTable = messageTable !== null;
  const groupMessageColumn = db
    .query(`SELECT 1 AS present FROM pragma_table_info('TenantFeedback') WHERE name = 'groupMessageId'`)
    .get() as { present: number } | null;
  const hasGroupColumn = groupMessageColumn !== null;

  logger.info({ migration: TENANT_FEEDBACK_MESSAGES_MIGRATION_NAME }, "applying sqlite incremental migration");
  db.exec("BEGIN");
  try {
    if (!hasGroupColumn) {
      db.exec(`ALTER TABLE "TenantFeedback" ADD COLUMN "groupMessageId" TEXT`);
    }
    if (!hasMessageTable) {
      db.exec(`CREATE TABLE "TenantFeedbackMessage" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "feedbackId" TEXT NOT NULL,
        "tenantId" TEXT NOT NULL,
        "role" TEXT NOT NULL,
        "authorId" TEXT,
        "authorLabel" TEXT,
        "content" TEXT NOT NULL,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "TenantFeedbackMessage_feedbackId_fkey" FOREIGN KEY ("feedbackId") REFERENCES "TenantFeedback" ("id") ON DELETE CASCADE ON UPDATE CASCADE
      )`);
      db.exec(`CREATE INDEX "TenantFeedbackMessage_feedbackId_createdAt_idx" ON "TenantFeedbackMessage"("feedbackId", "createdAt")`);
      db.exec(`CREATE INDEX "TenantFeedbackMessage_tenantId_createdAt_idx" ON "TenantFeedbackMessage"("tenantId", "createdAt")`);
    }
    const indexSql = `CREATE INDEX IF NOT EXISTS "TenantFeedback_tenantId_groupMessageId_idx" ON "TenantFeedback"("tenantId", "groupMessageId")`;
    db.exec(indexSql);
    const checksumSeed = hasGroupColumn && hasMessageTable
      ? "feedback-messages-present"
      : "feedback-messages-created";
    db.run(
      `INSERT INTO "_prisma_migrations"
         ("id","checksum","migration_name","started_at","finished_at","applied_steps_count")
       VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1)`,
      [
        randomUUID(),
        checksumOf(checksumSeed),
        TENANT_FEEDBACK_MESSAGES_MIGRATION_NAME,
      ],
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  doneNames.add(TENANT_FEEDBACK_MESSAGES_MIGRATION_NAME);
  applied.push(TENANT_FEEDBACK_MESSAGES_MIGRATION_NAME);
  logger.info({ migration: TENANT_FEEDBACK_MESSAGES_MIGRATION_NAME }, "sqlite incremental migration applied");
}

/**
 * 应用 SQLite baseline 建库脚本及后续增量迁移（幂等）。
 *
 * @param baselineSql 内嵌的建库 DDL（sqlite-baseline.sql 文本）
 * @param databaseUrl 形如 `file:./data/campux.db`
 */
export function applySqliteBaseline(
  baselineSql: string,
  databaseUrl: string,
  logger: SqliteMigrateLogger = console,
): SqliteMigrateResult {
  const filePath = sqliteFilePathFromUrl(databaseUrl);
  if (filePath !== ":memory:") {
    mkdirSync(dirname(filePath), { recursive: true });
  }

  const db = new Database(filePath);
  const applied: string[] = [];
  const skipped: string[] = [];
  const doneNames = new Set<string>();
  try {
    db.exec("PRAGMA foreign_keys=ON;");
    // SQLite 默认 journal；WAL 对单文件服务的并发读更友好。
    db.exec("PRAGMA journal_mode=WAL;");
    db.exec(PRISMA_MIGRATIONS_DDL_SQLITE);

    const done = db
      .query(`SELECT migration_name FROM "_prisma_migrations" WHERE rolled_back_at IS NULL`)
      .all() as Array<{ migration_name: string }>;
    for (const row of done) {
      doneNames.add(row.migration_name);
    }

    if (doneNames.has(SQLITE_BASELINE_NAME)) {
      skipped.push(SQLITE_BASELINE_NAME);
      logger.info({ skipped: skipped.length }, "sqlite baseline already applied");
    } else {
      const checksum = checksumOf(baselineSql);
      const id = randomUUID();

      logger.info({ migration: SQLITE_BASELINE_NAME }, "applying sqlite baseline schema");

      // bun:sqlite 的 exec 支持多语句；整个 baseline 在一个事务里执行，失败回滚。
      db.exec("BEGIN");
      try {
        db.exec(baselineSql);
        db.run(
          `INSERT INTO "_prisma_migrations"
             ("id","checksum","migration_name","started_at","finished_at","applied_steps_count")
           VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1)`,
          [id, checksum, SQLITE_BASELINE_NAME],
        );
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }

      doneNames.add(SQLITE_BASELINE_NAME);
      applied.push(SQLITE_BASELINE_NAME);
      // When the baseline was just applied fresh, the incremental migrations
      // are already embedded in the baseline schema. Record them as done so
      // they are skipped below.
      for (const name of [
        FIRST_PRIVATE_MESSAGE_MIGRATION_NAME,
        LAST_PUBLISH_STARTED_AT_MIGRATION_NAME,
        REVIEW_QUEUE_REMINDER_AT_ALL_MIGRATION_NAME,
        VOTING_CAMPAIGNS_MIGRATION_NAME,
        CAMPAIGN_ADMIN_ONLY_MIGRATION_NAME,
        OAUTH_IDENTITY_MIGRATION_NAME,
        PERSONAL_QQ_TOKEN_MIGRATION_NAME,
        CAMPAIGN_TABLES_MIGRATION_NAME,
        TENANT_FEEDBACK_MIGRATION_NAME,
        TENANT_FEEDBACK_MESSAGES_MIGRATION_NAME,
      ]) {
        if (!doneNames.has(name)) {
          doneNames.add(name);
          skipped.push(name);
          db.run(
            `INSERT INTO "_prisma_migrations"
               ("id","checksum","migration_name","started_at","finished_at","applied_steps_count")
             VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1)`,
            [randomUUID(), checksumOf(`baseline-includes-${name}`), name],
          );
        }
      }
      logger.info({ applied }, "sqlite baseline applied");
    }

    applyFirstPrivateMessageSqliteMigration(db, doneNames, applied, skipped, logger);
    applyLastPublishStartedAtSqliteMigration(db, doneNames, applied, skipped, logger);
    applyReviewQueueReminderAtAllSqliteMigration(db, doneNames, applied, skipped, logger);
    applyVotingCampaignsSqliteMigration(db, doneNames, applied, skipped, logger);
    applyOAuthIdentitySqliteMigration(db, doneNames, applied, skipped, logger);
    applyPersonalQqTokenSqliteMigration(db, doneNames, applied, skipped, logger);
    applyCampaignTablesSqliteMigration(db, doneNames, applied, skipped, logger);
    applyCampaignAdminOnlySqliteMigration(db, doneNames, applied, skipped, logger);
    applyTenantFeedbackSqliteMigration(db, doneNames, applied, skipped, logger);
    applyTenantFeedbackMessagesSqliteMigration(db, doneNames, applied, skipped, logger);
    return { applied, skipped };
  } finally {
    db.close();
  }
}
