import { createHash, randomUUID } from "node:crypto";
import { Database } from "bun:sqlite";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";

/**
 * SQLite 自包含迁移器。
 *
 * 单文件 / 自托管 SQLite 形态下，数据库总是从零创建，因此不需要 PostgreSQL 那套
 * 46 步逐项迁移历史——只需把「派生出来的 baseline 建库 DDL」（scripts/generate-sqlite-schema.ts
 * 产出的 packages/db/prisma/sqlite-baseline.sql，编译期内嵌为文本）一次性应用即可。
 *
 * 记账：沿用与 Prisma 兼容的 `_prisma_migrations` 表，把 baseline 记作一条名为
 * `0_sqlite_baseline` 的迁移（checksum = sha256(baselineSql)）。重复启动时按 name 跳过，
 * 实现幂等。这样即便将来引入「sqlite 增量迁移目录」，也能与本 baseline 记账无缝衔接。
 *
 * 仅依赖 Bun 内置的 `bun:sqlite`，无需 Prisma 引擎，可在 Prisma Client 初始化之前安全运行。
 */

const SQLITE_BASELINE_NAME = "0_sqlite_baseline";

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

/**
 * 应用 SQLite baseline 建库脚本（幂等）。
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
  try {
    db.exec("PRAGMA foreign_keys=ON;");
    // SQLite 默认 journal；WAL 对单文件服务的并发读更友好。
    db.exec("PRAGMA journal_mode=WAL;");
    db.exec(PRISMA_MIGRATIONS_DDL_SQLITE);

    const done = db
      .query(`SELECT migration_name FROM "_prisma_migrations" WHERE rolled_back_at IS NULL`)
      .all() as Array<{ migration_name: string }>;
    const doneNames = new Set(done.map((r) => r.migration_name));

    if (doneNames.has(SQLITE_BASELINE_NAME)) {
      skipped.push(SQLITE_BASELINE_NAME);
      logger.info({ skipped: skipped.length }, "sqlite baseline already applied");
      return { applied, skipped };
    }

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

    applied.push(SQLITE_BASELINE_NAME);
    logger.info({ applied }, "sqlite baseline applied");
    return { applied, skipped };
  } finally {
    db.close();
  }
}
