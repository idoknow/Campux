import { createHash, randomUUID } from "node:crypto";
import { SQL } from "bun";

/**
 * 自包含数据库迁移器（Self-contained migrator）
 *
 * 单可执行文件（`bun build --compile`）发布形态下，容器/仓库里没有 `prisma` CLI，
 * 也没有 `packages/db` 目录可供 `prisma migrate deploy` 读取。本模块把所有
 * prisma 迁移目录下的 migration.sql 在编译期内嵌为字符串，运行时直接连库执行，
 * 并写入与 Prisma **完全兼容**的 `_prisma_migrations` 记账表（checksum = sha256(migration.sql)，
 * 按 migration_name 去重）。
 *
 * 兼容性要点：
 * - 已被真正的 `prisma migrate deploy`（Docker 部署）应用过的迁移，这里按 name 跳过，不重复执行。
 * - 这里应用的迁移，之后用 `prisma migrate deploy` 也会被视为已应用（name + checksum 一致）。
 * - 每个迁移在一个事务内执行，全部成功才记账，失败则整条回滚（与 Prisma 默认一致）。
 *
 * 该模块只依赖 Bun 内置的 `SQL`（postgres 客户端），不需要 Prisma 引擎，所以可在迁移
 * 之前、Prisma Client 初始化之前安全运行。
 */

export interface EmbeddedMigration {
  /** 迁移目录名，如 `20260512132711_init`，与 Prisma 的 migration_name 对应。 */
  name: string;
  /** migration.sql 的原始文本（编译期内嵌）。 */
  sql: string;
}

export interface MigrateResult {
  applied: string[];
  skipped: string[];
}

export interface MigrateLogger {
  info: (obj: unknown, msg?: string) => void;
  warn?: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
}

const PRISMA_MIGRATIONS_DDL = `CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
  "id" VARCHAR(36) NOT NULL,
  "checksum" VARCHAR(64) NOT NULL,
  "finished_at" TIMESTAMPTZ,
  "migration_name" VARCHAR(255) NOT NULL,
  "logs" TEXT,
  "rolled_back_at" TIMESTAMPTZ,
  "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "applied_steps_count" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "_prisma_migrations_pkey" PRIMARY KEY ("id")
)`;

export function checksumOf(sql: string): string {
  return createHash("sha256").update(sql, "utf8").digest("hex");
}

/**
 * 把一段 SQL 脚本按 `;` 切分为可单独执行的语句，正确处理：
 * - 美元引用块 `$$ ... $$` / `$tag$ ... $tag$`（PL/pgSQL `DO`、函数体）
 * - 单引号字符串 `'...'`（含 `''` 转义）
 * - 双引号标识符 `"..."`
 * - 行注释 `-- ...` 与块注释 `/* ... *\/`
 *
 * Bun 的 `SQL.unsafe()` 走扩展协议（prepared statement），一次只能跑一条语句，
 * 因此发布前必须把多语句迁移切开逐条执行。
 */
export function splitSqlStatements(script: string): string[] {
  const statements: string[] = [];
  let current = "";
  let i = 0;
  const n = script.length;

  while (i < n) {
    const ch = script[i]!;
    const next = i + 1 < n ? script[i + 1] : "";

    // 行注释
    if (ch === "-" && next === "-") {
      current += ch;
      i++;
      while (i < n && script[i] !== "\n") {
        current += script[i];
        i++;
      }
      continue;
    }

    // 块注释
    if (ch === "/" && next === "*") {
      current += "/*";
      i += 2;
      while (i < n && !(script[i] === "*" && script[i + 1] === "/")) {
        current += script[i];
        i++;
      }
      if (i < n) {
        current += "*/";
        i += 2;
      }
      continue;
    }

    // 单引号字符串
    if (ch === "'") {
      current += ch;
      i++;
      while (i < n) {
        current += script[i];
        if (script[i] === "'") {
          if (script[i + 1] === "'") {
            // 转义的单引号
            current += script[i + 1];
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    // 双引号标识符
    if (ch === '"') {
      current += ch;
      i++;
      while (i < n) {
        current += script[i];
        if (script[i] === '"') {
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    // 美元引用块 $tag$ ... $tag$
    if (ch === "$") {
      const tagMatch = /^\$[A-Za-z0-9_]*\$/.exec(script.slice(i));
      if (tagMatch) {
        const tag = tagMatch[0];
        current += tag;
        i += tag.length;
        const endIdx = script.indexOf(tag, i);
        if (endIdx === -1) {
          // 未闭合，把剩余全部吞入
          current += script.slice(i);
          i = n;
        } else {
          current += script.slice(i, endIdx + tag.length);
          i = endIdx + tag.length;
        }
        continue;
      }
    }

    // 语句分隔
    if (ch === ";") {
      const trimmed = current.trim();
      if (hasExecutableSql(trimmed)) {
        statements.push(trimmed);
      }
      current = "";
      i++;
      continue;
    }

    current += ch;
    i++;
  }

  const tail = current.trim();
  if (hasExecutableSql(tail)) {
    statements.push(tail);
  }
  return statements;
}

/**
 * 判断一个 SQL 片段去掉注释/空白后是否还有可执行内容。
 * 纯注释片段（如 `-- foo`、`/* ... *\/`）不能丢给 prepared statement 协议执行，
 * 否则 Postgres 会报空查询/语法错误。
 */
function hasExecutableSql(fragment: string): boolean {
  const stripped = fragment
    .replace(/\/\*[\s\S]*?\*\//g, "") // 块注释
    .replace(/--[^\n]*/g, "") // 行注释
    .trim();
  return stripped.length > 0;
}

/**
 * 对照 `_prisma_migrations`，按顺序应用尚未执行的内嵌迁移。
 *
 * @param migrations 编译期内嵌的迁移列表（已按 name 升序）。
 * @param databaseUrl 目标库连接串。
 */
export async function applyEmbeddedMigrations(
  migrations: EmbeddedMigration[],
  databaseUrl: string,
  logger: MigrateLogger = console,
): Promise<MigrateResult> {
  const sql = new SQL(databaseUrl);
  const applied: string[] = [];
  const skipped: string[] = [];
  try {
    await sql.unsafe(PRISMA_MIGRATIONS_DDL);

    const rows = (await sql.unsafe(
      `SELECT migration_name FROM "_prisma_migrations" WHERE rolled_back_at IS NULL`,
    )) as Array<{ migration_name: string }>;
    const doneNames = new Set(rows.map((r) => r.migration_name));

    const ordered = [...migrations].sort((a, b) => a.name.localeCompare(b.name));

    for (const migration of ordered) {
      if (doneNames.has(migration.name)) {
        skipped.push(migration.name);
        continue;
      }

      const statements = splitSqlStatements(migration.sql);
      const checksum = checksumOf(migration.sql);
      const id = randomUUID();

      logger.info(
        { migration: migration.name, statements: statements.length },
        "applying embedded migration",
      );

      await sql.begin(async (tx: SQL) => {
        for (const statement of statements) {
          await tx.unsafe(statement);
        }
        await tx.unsafe(
          `INSERT INTO "_prisma_migrations"
             ("id", "checksum", "migration_name", "started_at", "finished_at", "applied_steps_count")
           VALUES ($1, $2, $3, now(), now(), $4)`,
          [id, checksum, migration.name, statements.length],
        );
      });

      applied.push(migration.name);
    }

    if (applied.length === 0) {
      logger.info({ skipped: skipped.length }, "no pending migrations to apply");
    } else {
      logger.info({ applied }, "embedded migrations completed");
    }
    return { applied, skipped };
  } finally {
    await sql.end();
  }
}
