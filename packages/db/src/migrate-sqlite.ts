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
const BROADCAST_NOTIFICATIONS_MIGRATION_NAME = "20260924120000_add_broadcast_notifications";
const TENANT_FEEDBACK_MIGRATION_NAME = "20260913140000_add_tenant_feedback";
const TENANT_FEEDBACK_MESSAGES_MIGRATION_NAME = "20260913160000_add_tenant_feedback_messages";

const USER_GRADUATION_MIGRATION_NAME = "20260925120000_add_user_graduation";
const POST_PENDING_TAGS_MIGRATION_NAME = "20261004000000_add_pending_tags";
const AI_REVIEW_STAGE1_MIGRATION_NAME = "20261023120000_restore_ai_review_stage1";
const AUTO_MODERATION_SCHEDULE_MIGRATION_NAME = "20261024120000_ai_auto_moderation_schedule_quota";
const PRIVATE_FORWARD_GROUP_MIGRATION_NAME = "20261029120000_add_private_forward_group";
const TENANT_PUBLISH_QUOTA_MIGRATION_NAME = "20261027120000_durable_tenant_publish_quota_reservations";

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
 * 广播通知的 SQLite 增量迁移：为老库补 Tenant 编号列与 TenantBroadcast /
 * TenantBroadcastVersion 两张新表（全新库由刷新后的 baseline 自带，迁移会幂等跳过）。
 * 与 Campaign 系列一致：SQLite 不建 enum，TenantRole 仍为 TEXT，由应用层校验取值。
 */
function applyBroadcastNotificationsSqliteMigration(
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

  if (doneNames.has(BROADCAST_NOTIFICATIONS_MIGRATION_NAME)) {
    skipped.push(BROADCAST_NOTIFICATIONS_MIGRATION_NAME);
    return;
  }

  const hasDisplayColumn =
    db
      .query(`SELECT 1 AS present FROM pragma_table_info('Tenant') WHERE name = 'nextBroadcastDisplayId'`)
      .get() !== null;
  const hasBroadcastTable =
    db
      .query(`SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'TenantBroadcast'`)
      .get() !== null;
  const hasVersionTable =
    db
      .query(`SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'TenantBroadcastVersion'`)
      .get() !== null;

  logger.info({ migration: BROADCAST_NOTIFICATIONS_MIGRATION_NAME }, "applying sqlite incremental migration");
  db.exec("BEGIN");
  try {
    if (!hasDisplayColumn) {
      db.exec(`ALTER TABLE "Tenant" ADD COLUMN "nextBroadcastDisplayId" INTEGER NOT NULL DEFAULT 1`);
    }
    if (!hasBroadcastTable) {
      db.exec(
        `CREATE TABLE "TenantBroadcast" (
           "id" TEXT NOT NULL PRIMARY KEY,
           "tenantId" TEXT NOT NULL,
           "displayId" INTEGER NOT NULL,
           "authorId" TEXT NOT NULL,
           "content" TEXT NOT NULL,
           "endsAt" DATETIME NOT NULL,
           "broadcastCount" INTEGER NOT NULL DEFAULT 0,
           "modified" BOOLEAN NOT NULL DEFAULT false,
           "removedAt" DATETIME,
           "removedById" TEXT,
           "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
           "updatedAt" DATETIME NOT NULL,
           CONSTRAINT "TenantBroadcast_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
           CONSTRAINT "TenantBroadcast_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
         )`,
      );
      db.exec(`CREATE UNIQUE INDEX "TenantBroadcast_tenantId_displayId_key" ON "TenantBroadcast"("tenantId", "displayId")`);
      db.exec(`CREATE INDEX "TenantBroadcast_tenantId_endsAt_idx" ON "TenantBroadcast"("tenantId", "endsAt")`);
      db.exec(`CREATE INDEX "TenantBroadcast_tenantId_authorId_idx" ON "TenantBroadcast"("tenantId", "authorId")`);
    }
    if (!hasVersionTable) {
      db.exec(
        `CREATE TABLE "TenantBroadcastVersion" (
           "id" TEXT NOT NULL PRIMARY KEY,
           "broadcastId" TEXT NOT NULL,
           "version" INTEGER NOT NULL,
           "content" TEXT NOT NULL,
           "changedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
           "endsAt" DATETIME NOT NULL,
           "broadcastCount" INTEGER NOT NULL DEFAULT 0,
           "changedById" TEXT NOT NULL,
           CONSTRAINT "TenantBroadcastVersion_broadcastId_fkey" FOREIGN KEY ("broadcastId") REFERENCES "TenantBroadcast" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
           CONSTRAINT "TenantBroadcastVersion_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
         )`,
      );
      db.exec(`CREATE UNIQUE INDEX "TenantBroadcastVersion_broadcastId_version_key" ON "TenantBroadcastVersion"("broadcastId", "version")`);
      db.exec(`CREATE INDEX "TenantBroadcastVersion_broadcastId_idx" ON "TenantBroadcastVersion"("broadcastId")`);
    }
    db.run(
      `INSERT INTO "_prisma_migrations"
         ("id","checksum","migration_name","started_at","finished_at","applied_steps_count")
       VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1)`,
      [
        randomUUID(),
        checksumOf(`ALTER TABLE "Tenant" ADD COLUMN "nextBroadcastDisplayId" INTEGER NOT NULL DEFAULT 1`),
        BROADCAST_NOTIFICATIONS_MIGRATION_NAME,
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
  }

  doneNames.add(BROADCAST_NOTIFICATIONS_MIGRATION_NAME);
  applied.push(BROADCAST_NOTIFICATIONS_MIGRATION_NAME);
  logger.info({ migration: BROADCAST_NOTIFICATIONS_MIGRATION_NAME }, "sqlite incremental migration applied");
}

/**
 * 毕业去向的 SQLite 增量迁移：为老库补 Tenant 编号列与 UserGraduation 表。
 * 与 Campaign / Broadcast 系列一致：SQLite 不建 enum，status 存为 TEXT。
 */
function applyUserGraduationSqliteMigration(
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

  if (doneNames.has(USER_GRADUATION_MIGRATION_NAME)) {
    skipped.push(USER_GRADUATION_MIGRATION_NAME);
    return;
  }

  const hasDisplayColumn =
    db
      .query(`SELECT 1 AS present FROM pragma_table_info('Tenant') WHERE name = 'nextGraduationDisplayId'`)
      .get() !== null;
  const hasGraduationTable =
    db
      .query(`SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'UserGraduation'`)
      .get() !== null;

  logger.info({ migration: USER_GRADUATION_MIGRATION_NAME }, "applying sqlite incremental migration");
  db.exec("BEGIN");
  try {
    if (!hasDisplayColumn) {
      db.exec(`ALTER TABLE "Tenant" ADD COLUMN "nextGraduationDisplayId" INTEGER NOT NULL DEFAULT 1`);
    }
    if (!hasGraduationTable) {
      db.exec(
        `CREATE TABLE "UserGraduation" (
           "id" TEXT NOT NULL PRIMARY KEY,
           "tenantId" TEXT NOT NULL,
           "displayId" INTEGER NOT NULL,
           "authorId" TEXT NOT NULL,
           "graduationYear" INTEGER NOT NULL,
           "classYear" INTEGER NOT NULL,
           "education" TEXT NOT NULL,
           "destination" TEXT NOT NULL,
           "status" TEXT NOT NULL DEFAULT 'pending_approval',
           "rejectReason" TEXT,
           "reviewedById" TEXT,
           "reviewedAt" DATETIME,
           "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
           "updatedAt" DATETIME NOT NULL,
           CONSTRAINT "UserGraduation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
           CONSTRAINT "UserGraduation_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
         )`,
      );
      db.exec(`CREATE UNIQUE INDEX "UserGraduation_tenantId_displayId_key" ON "UserGraduation"("tenantId", "displayId")`);
      db.exec(`CREATE INDEX "UserGraduation_tenantId_status_idx" ON "UserGraduation"("tenantId", "status")`);
      db.exec(`CREATE INDEX "UserGraduation_tenantId_graduationYear_idx" ON "UserGraduation"("tenantId", "graduationYear")`);
      db.exec(`CREATE INDEX "UserGraduation_tenantId_classYear_idx" ON "UserGraduation"("tenantId", "classYear")`);
      db.exec(`CREATE INDEX "UserGraduation_tenantId_destination_idx" ON "UserGraduation"("tenantId", "destination")`);
      db.exec(`CREATE INDEX "UserGraduation_tenantId_authorId_idx" ON "UserGraduation"("tenantId", "authorId")`);
    }
    db.run(
      `INSERT INTO "_prisma_migrations"
         ("id","checksum","migration_name","started_at","finished_at","applied_steps_count")
       VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1)`,
      [
        randomUUID(),
        checksumOf(`ALTER TABLE "Tenant" ADD COLUMN "nextGraduationDisplayId" INTEGER NOT NULL DEFAULT 1`),
        USER_GRADUATION_MIGRATION_NAME,
      ],
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  doneNames.add(USER_GRADUATION_MIGRATION_NAME);
  applied.push(USER_GRADUATION_MIGRATION_NAME);
  logger.info({ migration: USER_GRADUATION_MIGRATION_NAME }, "sqlite incremental migration applied");
}

/**
 * 应用 SQLite baseline 建库脚本及后续增量迁移（幂等）。
 *
 * @param baselineSql 内嵌的建库 DDL（sqlite-baseline.sql 文本）
 * @param databaseUrl 形如 `file:./data/campux.db`
 */

/**
 * TenantFeedback:意见反馈存档表。老库缺表时补建。
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
        "groupMessageId" TEXT,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "TenantFeedback_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "TenantFeedback_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
      )`);
      db.exec(`CREATE INDEX "TenantFeedback_tenantId_createdAt_idx" ON "TenantFeedback"("tenantId", "createdAt")`);
      db.exec(`CREATE INDEX "TenantFeedback_tenantId_authorId_createdAt_idx" ON "TenantFeedback"("tenantId", "authorId", "createdAt")`);
    }
    // 修复已有 TenantFeedback 表：补 groupMessageId 列与索引
    if (hasTable) {
      const groupCol = db
        .query(`SELECT 1 AS present FROM pragma_table_info('TenantFeedback') WHERE name = 'groupMessageId'`)
        .get() as { present: number } | null;
      if (!groupCol) {
        db.exec(`ALTER TABLE "TenantFeedback" ADD COLUMN "groupMessageId" TEXT`);
      }
      db.exec(`CREATE INDEX IF NOT EXISTS "TenantFeedback_tenantId_groupMessageId_idx" ON "TenantFeedback"("tenantId", "groupMessageId")`);
    }
    const checksumSeed = hasTable ? "create-tenant-feedback-present" : "create-tenant-feedback-missing";
    db.run(
      `INSERT INTO "_prisma_migrations"
         ("id","checksum","migration_name","started_at","finished_at","applied_steps_count")
       VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1)`,
      [randomUUID(), checksumOf(checksumSeed), TENANT_FEEDBACK_MIGRATION_NAME],
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
 * TenantFeedback.groupMessageId + TenantFeedbackMessage:意见对话。
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

  logger.info({ migration: TENANT_FEEDBACK_MESSAGES_MIGRATION_NAME }, "applying sqlite incremental migration");
  db.exec("BEGIN");
  try {
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
    const checksumSeed = hasMessageTable ? "feedback-messages-present" : "feedback-messages-created";
    db.run(
      `INSERT INTO "_prisma_migrations"
         ("id","checksum","migration_name","started_at","finished_at","applied_steps_count")
       VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1)`,
      [randomUUID(), checksumOf(checksumSeed), TENANT_FEEDBACK_MESSAGES_MIGRATION_NAME],
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
 * Post.pendingTags（审核队列标签暂存列）的 SQLite 增量迁移。
 * 老库没有该列时补上；新库由刷新后的 baseline 自带，迁移会幂等跳过。
 */
function applyPostPendingTagsSqliteMigration(
  db: Database,
  doneNames: Set<string>,
  applied: string[],
  skipped: string[],
  logger: SqliteMigrateLogger,
): void {
  const postTable = db
    .query(`SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'Post'`)
    .get() as { present: number } | null;
  if (!postTable) return;

  if (doneNames.has(POST_PENDING_TAGS_MIGRATION_NAME)) {
    skipped.push(POST_PENDING_TAGS_MIGRATION_NAME);
    return;
  }

  const pendingTagsColumn = db
    .query(`SELECT 1 AS present FROM pragma_table_info('Post') WHERE name = 'pendingTags'`)
    .get() as { present: number } | null;
  const hasColumn = pendingTagsColumn !== null;

  logger.info({ migration: POST_PENDING_TAGS_MIGRATION_NAME }, "applying sqlite incremental migration");
  db.exec("BEGIN");
  try {
    if (!hasColumn) {
      db.exec(`ALTER TABLE "Post" ADD COLUMN "pendingTags" TEXT`);
    }
    db.run(
      `INSERT INTO "_prisma_migrations"
         ("id","checksum","migration_name","started_at","finished_at","applied_steps_count")
       VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1)`,
      [
        randomUUID(),
        checksumOf(`ALTER TABLE "Post" ADD COLUMN "pendingTags" TEXT`),
        POST_PENDING_TAGS_MIGRATION_NAME,
      ],
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  doneNames.add(POST_PENDING_TAGS_MIGRATION_NAME);
  applied.push(POST_PENDING_TAGS_MIGRATION_NAME);
  logger.info({ migration: POST_PENDING_TAGS_MIGRATION_NAME }, "sqlite incremental migration applied");
}

function applyTenantPublishQuotaReservationSqliteMigration(db: Database, doneNames: Set<string>, applied: string[], skipped: string[], logger: SqliteMigrateLogger): void {
  if (doneNames.has(TENANT_PUBLISH_QUOTA_MIGRATION_NAME)) { skipped.push(TENANT_PUBLISH_QUOTA_MIGRATION_NAME); return; }
  const hasTable = db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='TenantPublishQuotaReservation'").get() !== null;
  if (!db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='Tenant'").get() || !db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='Post'").get()) return;
  logger.info({ migration: TENANT_PUBLISH_QUOTA_MIGRATION_NAME }, "applying sqlite incremental migration");
  db.exec("BEGIN");
  try {
    // 复合外键引用 Post(tenantId, id)，SQLite 要求被引用列必须是完整的唯一索引。
    // PG 侧由 20261023120000 迁移补的该约束，sqlite 全新基线也自带；但老库的
    // 增量升级路径此前从未创建它，缺了会让 PRAGMA foreign_key_check 报
    // "foreign key mismatch" 并回滚整个迁移。uuid 主键下 (tenantId, id) 不会重复。
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS "Post_tenantId_id_key" ON "Post"("tenantId", "id")`);
    if (!hasTable) db.exec(`CREATE TABLE "TenantPublishQuotaReservation" (
      "id" TEXT NOT NULL PRIMARY KEY, "tenantId" TEXT NOT NULL, "postId" TEXT NOT NULL,
      "periodType" TEXT NOT NULL CHECK ("periodType" IN ('hourly', 'daily')), "periodStart" DATETIME NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'reserved' CHECK ("status" IN ('reserved', 'consumed', 'released')),
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
      CONSTRAINT "TenantPublishQuotaReservation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "TenantPublishQuotaReservation_tenantId_postId_fkey" FOREIGN KEY ("tenantId", "postId") REFERENCES "Post"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE)`);
    else {
      const columns = db.query(`PRAGMA table_info("TenantPublishQuotaReservation")`).all() as Array<{ name: string }>;
      const indexes = db.query(`PRAGMA index_list("TenantPublishQuotaReservation")`).all() as Array<{ name: string; unique: number }>;
      const fks = db.query(`PRAGMA foreign_key_list("TenantPublishQuotaReservation")`).all() as Array<{ table: string; from: string; to: string; seq: number }>;
      const grouped = new Map<string, Array<{ from: string; to: string; seq: number }>>();
      for (const fk of fks) grouped.set(fk.table, [...(grouped.get(fk.table) ?? []), fk]);
      const postFk = (grouped.get("Post") ?? []).sort((a, b) => a.seq - b.seq);
      const tenantFk = (grouped.get("Tenant") ?? []).sort((a, b) => a.seq - b.seq);
      const indexColumns = (name: string) => (db.query(`PRAGMA index_info(${JSON.stringify(name)})`).all() as Array<{ seqno: number; name: string }>).sort((a, b) => a.seqno - b.seqno).map((column) => column.name);
      const required = ["id", "tenantId", "postId", "periodType", "periodStart", "status", "createdAt", "updatedAt"];
      if (required.some((name) => !columns.some((column) => column.name === name)) ||
        !indexes.some((index) => index.unique && index.name === "TenantPublishQuotaReservation_tenantId_postId_periodType_periodStart_key" && indexColumns(index.name).join(",") === "tenantId,postId,periodType,periodStart") ||
        !indexes.some((index) => !index.unique && index.name === "TenantPublishQuotaReservation_tenantId_periodType_periodStart_status_idx" && indexColumns(index.name).join(",") === "tenantId,periodType,periodStart,status") ||
        tenantFk.length !== 1 || tenantFk[0]?.from !== "tenantId" || tenantFk[0]?.to !== "id" ||
        postFk.length !== 2 || postFk[0]?.from !== "tenantId" || postFk[0]?.to !== "tenantId" || postFk[1]?.from !== "postId" || postFk[1]?.to !== "id") {
        throw new Error("Existing TenantPublishQuotaReservation table has an incompatible schema; refusing to mark migration applied");
      }
      const tableSql = (db.query(`SELECT sql FROM sqlite_master WHERE type='table' AND name='TenantPublishQuotaReservation'`).get() as { sql: string }).sql;
      if (!tableSql.includes("'hourly'") || !tableSql.includes("'daily'") || !tableSql.includes("'consumed'") || !tableSql.includes("'released'")) {
        throw new Error("Existing TenantPublishQuotaReservation table lacks period/status CHECK constraints");
      }
    }
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS "TenantPublishQuotaReservation_tenantId_postId_periodType_periodStart_key" ON "TenantPublishQuotaReservation"("tenantId", "postId", "periodType", "periodStart")`);
    db.exec(`CREATE INDEX IF NOT EXISTS "TenantPublishQuotaReservation_tenantId_periodType_periodStart_status_idx" ON "TenantPublishQuotaReservation"("tenantId", "periodType", "periodStart", "status")`);
    const violations = db.query("PRAGMA foreign_key_check").all();
    if (violations.length) throw new Error(`sqlite migration introduced ${violations.length} foreign-key violation(s)`);
    db.run(`INSERT INTO "_prisma_migrations" ("id","checksum","migration_name","started_at","finished_at","applied_steps_count") VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1)`, [randomUUID(), checksumOf("durable tenant publish quota reservations"), TENANT_PUBLISH_QUOTA_MIGRATION_NAME]);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  doneNames.add(TENANT_PUBLISH_QUOTA_MIGRATION_NAME); applied.push(TENANT_PUBLISH_QUOTA_MIGRATION_NAME);
}

/**
 * AI 审核一期的基础表（SchoolEntity / SchoolModelSnapshot / PostAiAnalysis / AiFeedback）。
 * 全新基线自带这些表；PG 由 20261023120000 迁移创建；但 sqlite 增量升级路径此前没有
 * 对应迁移，老库升级后会缺表并让 AI 审核/自动决策相关功能 P2021 报错。这里补上。
 */
function applyAiReviewStage1SqliteMigration(
  db: Database,
  doneNames: Set<string>,
  applied: string[],
  skipped: string[],
  logger: SqliteMigrateLogger,
): void {
  if (doneNames.has(AI_REVIEW_STAGE1_MIGRATION_NAME)) {
    skipped.push(AI_REVIEW_STAGE1_MIGRATION_NAME);
    return;
  }
  if (!db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='Tenant'").get()
    || !db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='Post'").get()) return;

  const hasTable = (name: string): boolean =>
    db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !== null;
  if (hasTable("PostAiAnalysis") && hasTable("AiFeedback") && hasTable("SchoolEntity") && hasTable("SchoolModelSnapshot")) {
    // 表已存在（全新基线安装，或中间版本建过表但缺复合外键依赖的唯一索引）：
    // 补齐缺失索引并记迁移账，避免重复建表。
    db.exec("BEGIN");
    try {
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS "Post_tenantId_id_key" ON "Post"("tenantId", "id")`);
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS "SchoolModelSnapshot_tenantId_id_key" ON "SchoolModelSnapshot"("tenantId", "id")`);
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS "PostAiAnalysis_tenantId_id_key" ON "PostAiAnalysis"("tenantId", "id")`);
      db.run(
        `INSERT INTO "_prisma_migrations"
           ("id","checksum","migration_name","started_at","finished_at","applied_steps_count")
         VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1)`,
        [randomUUID(), checksumOf("baseline-includes-ai-review-stage1"), AI_REVIEW_STAGE1_MIGRATION_NAME],
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    doneNames.add(AI_REVIEW_STAGE1_MIGRATION_NAME);
    skipped.push(AI_REVIEW_STAGE1_MIGRATION_NAME);
    return;
  }

  logger.info({ migration: AI_REVIEW_STAGE1_MIGRATION_NAME }, "applying sqlite incremental migration");
  db.exec("BEGIN");
  try {
    // PostAiAnalysis/AiFeedback 的复合外键引用 Post(id, tenantId)，SQLite 要求被引用列
    // 必须有完整唯一索引；老库和 PG 的 20261023120000 一样需要先补上它。
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS "Post_tenantId_id_key" ON "Post"("tenantId", "id")`);
    db.exec(`CREATE TABLE IF NOT EXISTS "SchoolEntity" (
      "id" TEXT NOT NULL PRIMARY KEY, "tenantId" TEXT NOT NULL, "type" TEXT NOT NULL, "name" TEXT NOT NULL,
      "aliases" JSONB NOT NULL DEFAULT '[]', "confidence" REAL NOT NULL DEFAULT 1,
      "sensitivity" TEXT NOT NULL DEFAULT 'normal', "source" TEXT NOT NULL DEFAULT 'admin',
      "evidence" JSONB NOT NULL DEFAULT '[]', "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL,
      CONSTRAINT "SchoolEntity_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    )`);
    db.exec(`CREATE TABLE IF NOT EXISTS "SchoolModelSnapshot" (
      "id" TEXT NOT NULL PRIMARY KEY, "tenantId" TEXT NOT NULL, "version" INTEGER NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'active', "summary" TEXT NOT NULL, "entities" JSONB NOT NULL,
      "riskMemory" JSONB NOT NULL DEFAULT '{}', "rules" JSONB NOT NULL, "metrics" JSONB NOT NULL DEFAULT '{}',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "SchoolModelSnapshot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    )`);
    db.exec(`CREATE TABLE IF NOT EXISTS "PostAiAnalysis" (
      "id" TEXT NOT NULL PRIMARY KEY, "tenantId" TEXT NOT NULL, "postId" TEXT NOT NULL,
      "modelSnapshotId" TEXT, "mode" TEXT NOT NULL DEFAULT 'assist', "version" INTEGER NOT NULL DEFAULT 1, "provider" TEXT NOT NULL, "model" TEXT NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'pending', "riskLevel" TEXT, "confidence" REAL,
      "categories" JSONB NOT NULL DEFAULT '[]', "sensitiveFindings" JSONB NOT NULL DEFAULT '[]',
      "suggestedAction" TEXT, "reasons" JSONB NOT NULL DEFAULT '[]', "rewrittenText" TEXT, "maskedText" TEXT,
      "rejectionReason" TEXT, "error" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL,
      CONSTRAINT "PostAiAnalysis_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "PostAiAnalysis_postId_tenantId_fkey" FOREIGN KEY ("postId", "tenantId") REFERENCES "Post" ("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "PostAiAnalysis_modelSnapshotId_tenantId_fkey" FOREIGN KEY ("modelSnapshotId", "tenantId") REFERENCES "SchoolModelSnapshot" ("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE
    )`);
    db.exec(`CREATE TABLE IF NOT EXISTS "AiFeedback" (
      "id" TEXT NOT NULL PRIMARY KEY, "tenantId" TEXT NOT NULL, "postId" TEXT NOT NULL,
      "analysisId" TEXT NOT NULL, "reviewerId" TEXT, "aiAction" TEXT, "humanAction" TEXT NOT NULL,
      "humanComment" TEXT, "matched" BOOLEAN NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "AiFeedback_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "AiFeedback_postId_tenantId_fkey" FOREIGN KEY ("postId", "tenantId") REFERENCES "Post" ("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "AiFeedback_analysisId_tenantId_fkey" FOREIGN KEY ("analysisId", "tenantId") REFERENCES "PostAiAnalysis" ("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "AiFeedback_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
    )`);
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS "SchoolEntity_tenantId_type_name_key" ON "SchoolEntity"("tenantId", "type", "name")`);
    db.exec(`CREATE INDEX IF NOT EXISTS "SchoolEntity_tenantId_type_sensitivity_idx" ON "SchoolEntity"("tenantId", "type", "sensitivity")`);
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS "SchoolModelSnapshot_tenantId_version_key" ON "SchoolModelSnapshot"("tenantId", "version")`);
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS "SchoolModelSnapshot_tenantId_id_key" ON "SchoolModelSnapshot"("tenantId", "id")`);
    db.exec(`CREATE INDEX IF NOT EXISTS "SchoolModelSnapshot_tenantId_createdAt_idx" ON "SchoolModelSnapshot"("tenantId", "createdAt")`);
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS "PostAiAnalysis_postId_tenantId_version_key" ON "PostAiAnalysis"("postId", "tenantId", "version")`);
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS "PostAiAnalysis_tenantId_id_key" ON "PostAiAnalysis"("tenantId", "id")`);
    db.exec(`CREATE INDEX IF NOT EXISTS "PostAiAnalysis_tenantId_status_createdAt_idx" ON "PostAiAnalysis"("tenantId", "status", "createdAt")`);
    db.exec(`CREATE INDEX IF NOT EXISTS "PostAiAnalysis_tenantId_postId_createdAt_idx" ON "PostAiAnalysis"("tenantId", "postId", "createdAt")`);
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS "AiFeedback_analysisId_key" ON "AiFeedback"("analysisId")`);
    db.exec(`CREATE INDEX IF NOT EXISTS "AiFeedback_tenantId_createdAt_idx" ON "AiFeedback"("tenantId", "createdAt")`);
    db.run(
      `INSERT INTO "_prisma_migrations"
         ("id","checksum","migration_name","started_at","finished_at","applied_steps_count")
       VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1)`,
      [randomUUID(), checksumOf("restore ai review stage1"), AI_REVIEW_STAGE1_MIGRATION_NAME],
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  doneNames.add(AI_REVIEW_STAGE1_MIGRATION_NAME);
  applied.push(AI_REVIEW_STAGE1_MIGRATION_NAME);
  logger.info({ migration: AI_REVIEW_STAGE1_MIGRATION_NAME }, "sqlite incremental migration applied");
}

function applyAutoModerationScheduleSqliteMigration(
  db: Database,
  doneNames: Set<string>,
  applied: string[],
  skipped: string[],
  logger: SqliteMigrateLogger,
): void {
  if (doneNames.has(AUTO_MODERATION_SCHEDULE_MIGRATION_NAME)) {
    skipped.push(AUTO_MODERATION_SCHEDULE_MIGRATION_NAME);
    return;
  }

  const hasTable = (name: string): boolean =>
    db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !== null;
  // A database predating these AI tables is not yet eligible for this migration.
  if (!hasTable("Tenant") || !hasTable("PostAiAnalysis") || !hasTable("AiFeedback")) return;

  logger.info({ migration: AUTO_MODERATION_SCHEDULE_MIGRATION_NAME }, "applying sqlite incremental migration");
  db.exec("BEGIN");
  try {
    const analysisColumns = new Set(
      (db.query(`PRAGMA table_info("PostAiAnalysis")`).all() as Array<{ name: string }>).map(({ name }) => name),
    );
    const additions = [
      ["autoDecision", "TEXT"],
      ["autoDecisionReason", "TEXT"],
      ["autoDecisionAt", "DATETIME"],
      ["autoDecisionExecuteAfter", "DATETIME"],
      ["autoDecisionCancelledAt", "DATETIME"],
      ["autoDecisionExecutingAt", "DATETIME"],
      ["autoDecisionLeaseAt", "DATETIME"],
    ] as const;
    for (const [name, type] of additions) {
      if (!analysisColumns.has(name)) db.exec(`ALTER TABLE "PostAiAnalysis" ADD COLUMN "${name}" ${type}`);
    }
    db.exec(`CREATE INDEX IF NOT EXISTS "PostAiAnalysis_tenantId_autoDecision_autoDecisionExecuteAfter_idx" ON "PostAiAnalysis"("tenantId", "autoDecision", "autoDecisionExecuteAfter")`);

    const feedbackColumns = new Set(
      (db.query(`PRAGMA table_info("AiFeedback")`).all() as Array<{ name: string }>).map(({ name }) => name),
    );
    if (!feedbackColumns.has("categories")) {
      db.exec(`ALTER TABLE "AiFeedback" ADD COLUMN "categories" TEXT NOT NULL DEFAULT '[]'`);
    }

    const violations = db.query("PRAGMA foreign_key_check").all();
    if (violations.length > 0) throw new Error(`sqlite migration introduced ${violations.length} foreign-key violation(s)`);

    db.run(
      `INSERT INTO "_prisma_migrations" ("id", "checksum", "migration_name", "started_at", "finished_at", "applied_steps_count")
       VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1)`,
      [randomUUID(), checksumOf("auto moderation durable schedule"), AUTO_MODERATION_SCHEDULE_MIGRATION_NAME],
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  doneNames.add(AUTO_MODERATION_SCHEDULE_MIGRATION_NAME);
  applied.push(AUTO_MODERATION_SCHEDULE_MIGRATION_NAME);
  logger.info({ migration: AUTO_MODERATION_SCHEDULE_MIGRATION_NAME }, "sqlite incremental migration applied");
}

function applyPrivateForwardGroupSqliteMigration(
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

  if (doneNames.has(PRIVATE_FORWARD_GROUP_MIGRATION_NAME)) {
    skipped.push(PRIVATE_FORWARD_GROUP_MIGRATION_NAME);
    return;
  }

  logger.info({ migration: PRIVATE_FORWARD_GROUP_MIGRATION_NAME }, "applying sqlite incremental migration");
  db.exec("BEGIN");
  try {
    const columns = new Set(
      (db.query(`PRAGMA table_info("BotAccount")`).all() as Array<{ name: string }>).map(({ name }) => name),
    );
    if (!columns.has("privateForwardGroupId")) {
      db.exec(`ALTER TABLE "BotAccount" ADD COLUMN "privateForwardGroupId" TEXT`);
    }
    // 升级前所有墙号的私聊消息都转发到审核群；迁移后沿用同一目标，避免静默丢失转发。
    db.exec(
      `UPDATE "BotAccount"
          SET "privateForwardGroupId" = "reviewGroupId"
        WHERE "privateForwardGroupId" IS NULL
          AND "reviewGroupId" IS NOT NULL`,
    );
    db.run(
      `INSERT INTO "_prisma_migrations"
         ("id","checksum","migration_name","started_at","finished_at","applied_steps_count")
       VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1)`,
      [
        randomUUID(),
        checksumOf(`ALTER TABLE "BotAccount" ADD COLUMN "privateForwardGroupId" TEXT`),
        PRIVATE_FORWARD_GROUP_MIGRATION_NAME,
      ],
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  doneNames.add(PRIVATE_FORWARD_GROUP_MIGRATION_NAME);
  applied.push(PRIVATE_FORWARD_GROUP_MIGRATION_NAME);
  logger.info({ migration: PRIVATE_FORWARD_GROUP_MIGRATION_NAME }, "sqlite incremental migration applied");
}

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
      for (const name of [FIRST_PRIVATE_MESSAGE_MIGRATION_NAME, LAST_PUBLISH_STARTED_AT_MIGRATION_NAME, REVIEW_QUEUE_REMINDER_AT_ALL_MIGRATION_NAME, VOTING_CAMPAIGNS_MIGRATION_NAME, CAMPAIGN_ADMIN_ONLY_MIGRATION_NAME, BROADCAST_NOTIFICATIONS_MIGRATION_NAME, TENANT_FEEDBACK_MIGRATION_NAME, TENANT_FEEDBACK_MESSAGES_MIGRATION_NAME, USER_GRADUATION_MIGRATION_NAME, POST_PENDING_TAGS_MIGRATION_NAME, TENANT_PUBLISH_QUOTA_MIGRATION_NAME]) {
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
    applyCampaignAdminOnlySqliteMigration(db, doneNames, applied, skipped, logger);
    applyTenantFeedbackSqliteMigration(db, doneNames, applied, skipped, logger);
    applyTenantFeedbackMessagesSqliteMigration(db, doneNames, applied, skipped, logger);
    applyBroadcastNotificationsSqliteMigration(db, doneNames, applied, skipped, logger);
    applyUserGraduationSqliteMigration(db, doneNames, applied, skipped, logger);
    applyPostPendingTagsSqliteMigration(db, doneNames, applied, skipped, logger);
    applyAiReviewStage1SqliteMigration(db, doneNames, applied, skipped, logger);
    applyAutoModerationScheduleSqliteMigration(db, doneNames, applied, skipped, logger);
    applyPrivateForwardGroupSqliteMigration(db, doneNames, applied, skipped, logger);
    applyTenantPublishQuotaReservationSqliteMigration(db, doneNames, applied, skipped, logger);
    return { applied, skipped };
  } finally {
    db.close();
  }
}
