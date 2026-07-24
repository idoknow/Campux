import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { applySqliteBaseline, sqliteFilePathFromUrl } from "./migrate-sqlite";

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

const BASELINE = `CREATE TABLE "Widget" ("id" TEXT PRIMARY KEY NOT NULL, "name" TEXT NOT NULL);
CREATE TABLE "Gadget" ("id" TEXT PRIMARY KEY NOT NULL, "meta" JSONB NOT NULL DEFAULT '{}');`;
const OLD_PRIVATE_REPLY = `发送 #注册账号 可以用当前 QQ 注册本校园墙账号。
发送 #重置密码 可以重置你的登录密码。`;
const NEW_PRIVATE_REPLY = `首次私聊会自动注册 Campux 账号。
发送 #投稿 开始投稿。
忘记密码时，请发送 #重置密码 获取新密码。`;

describe("sqliteFilePathFromUrl", () => {
  test("strips file: / sqlite: prefixes and query strings", () => {
    expect(sqliteFilePathFromUrl("file:./data/campux.db")).toBe("./data/campux.db");
    expect(sqliteFilePathFromUrl("file:/abs/x.db")).toBe("/abs/x.db");
    expect(sqliteFilePathFromUrl("sqlite://./y.db")).toBe("./y.db");
    expect(sqliteFilePathFromUrl("sqlite:/z.db")).toBe("/z.db");
    expect(sqliteFilePathFromUrl("file:/a.db?connection_limit=1")).toBe("/a.db");
    expect(sqliteFilePathFromUrl("/bare/path.db")).toBe("/bare/path.db");
  });
});

describe("applySqliteBaseline", () => {
  test("applies baseline, records bookkeeping, is idempotent", () => {
    const dir = mkdtempSync(join(tmpdir(), "campux-sqlite-mig-"));
    const dbPath = join(dir, "test.db");
    const url = `file:${dbPath}`;
    try {
      // first run applies
      const r1 = applySqliteBaseline(BASELINE, url, silentLogger);
      expect(r1.applied).toEqual(["0_sqlite_baseline"]);
      expect(r1.skipped).toEqual([]);

      // tables exist
      const db = new Database(dbPath);
      const tables = (
        db.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{ name: string }>
      ).map((r) => r.name);
      expect(tables).toContain("Widget");
      expect(tables).toContain("Gadget");
      expect(tables).toContain("_prisma_migrations");

      // bookkeeping recorded with a checksum
      const mig = db
        .query(`SELECT migration_name, checksum FROM "_prisma_migrations"`)
        .all() as Array<{ migration_name: string; checksum: string }>;
      expect(mig).toHaveLength(1);
      expect(mig[0]!.migration_name).toBe("0_sqlite_baseline");
      expect(mig[0]!.checksum).toMatch(/^[0-9a-f]{64}$/);
      db.close();

      // second run skips (idempotent)
      const r2 = applySqliteBaseline(BASELINE, url, silentLogger);
      expect(r2.applied).toEqual([]);
      expect(r2.skipped).toEqual(["0_sqlite_baseline"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("rolls back when baseline SQL is invalid (no partial state)", () => {
    const dir = mkdtempSync(join(tmpdir(), "campux-sqlite-mig-"));
    const dbPath = join(dir, "bad.db");
    const url = `file:${dbPath}`;
    try {
      const badSql = `CREATE TABLE "Ok" ("id" TEXT PRIMARY KEY); THIS IS NOT SQL;`;
      expect(() => applySqliteBaseline(badSql, url, silentLogger)).toThrow();

      // baseline must NOT be recorded as applied
      const db = new Database(dbPath);
      const migTableExists = db
        .query("SELECT name FROM sqlite_master WHERE type='table' AND name='_prisma_migrations'")
        .all();
      // _prisma_migrations is created before the transaction, but no baseline row committed
      if (migTableExists.length > 0) {
        const rows = db.query(`SELECT * FROM "_prisma_migrations"`).all();
        expect(rows).toHaveLength(0);
      }
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("upgrades an existing baseline database without overwriting customized replies", () => {
    const dir = mkdtempSync(join(tmpdir(), "campux-sqlite-upgrade-"));
    const dbPath = join(dir, "upgrade.db");
    const url = `file:${dbPath}`;
    const currentBaseline = readFileSync(join(import.meta.dir, "../prisma/sqlite-baseline.sql"), "utf8");
    const oldBaseline = currentBaseline
      .replace(NEW_PRIVATE_REPLY, OLD_PRIVATE_REPLY)
      .replace('    "lastPublishStartedAt" DATETIME,\n', "");
    expect(oldBaseline).not.toBe(currentBaseline);
    expect(oldBaseline).not.toContain('"lastPublishStartedAt"');

    try {
      const before = new Database(dbPath);
      before.exec(oldBaseline);
      before.exec(`CREATE TABLE "_prisma_migrations" (
        "id" TEXT PRIMARY KEY NOT NULL,
        "checksum" TEXT NOT NULL,
        "finished_at" DATETIME,
        "migration_name" TEXT NOT NULL,
        "logs" TEXT,
        "rolled_back_at" DATETIME,
        "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "applied_steps_count" INTEGER NOT NULL DEFAULT 0
      )`);
      before.run(
        `INSERT INTO "_prisma_migrations"
           ("id", "checksum", "migration_name", "finished_at", "applied_steps_count")
         VALUES (?, ?, ?, CURRENT_TIMESTAMP, 1)`,
        ["old-baseline", "old-checksum", "0_sqlite_baseline"],
      );
      before.run(
        `INSERT INTO "Tenant" ("id", "slug", "name", "updatedAt") VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
        ["tenant-1", "tenant-1", "Tenant 1"],
      );
      before.run(
        `INSERT INTO "BotAccount" ("id", "tenantId", "qqUin", "displayName", "connectionToken") VALUES (?, ?, ?, ?, ?)`,
        ["bot-default", "tenant-1", 10001, "Default", "token-default"],
      );
      before.run(
        `INSERT INTO "BotAccount" ("id", "tenantId", "qqUin", "displayName", "connectionToken", "userMessageReply") VALUES (?, ?, ?, ?, ?, ?)`,
        ["bot-custom", "tenant-1", 10002, "Custom", "token-custom", "tenant custom reply"],
      );
      before.close();

      const result = applySqliteBaseline(currentBaseline, url, silentLogger);
      expect(result.applied).toContain("20260713120000_auto_register_on_first_private_message");
      expect(result.applied).toContain("20260724090000_add_bot_last_publish_started_at");
      expect(result.skipped).toContain("0_sqlite_baseline");

      const after = new Database(dbPath);
      const replies = after
        .query(`SELECT "id", "userMessageReply" FROM "BotAccount" ORDER BY "id"`)
        .all() as Array<{ id: string; userMessageReply: string }>;
      expect(replies).toEqual([
        { id: "bot-custom", userMessageReply: "tenant custom reply" },
        { id: "bot-default", userMessageReply: NEW_PRIVATE_REPLY },
      ]);
      const column = after
        .query(`SELECT "dflt_value" FROM pragma_table_info('BotAccount') WHERE "name" = 'userMessageReply'`)
        .get() as { dflt_value: string };
      expect(column.dflt_value).toContain("首次私聊会自动注册 Campux 账号");
      const publishStartedColumn = after
        .query(`SELECT "name" FROM pragma_table_info('BotAccount') WHERE "name" = 'lastPublishStartedAt'`)
        .get();
      expect(publishStartedColumn).not.toBeNull();
      const migration = after
        .query(`SELECT "migration_name" FROM "_prisma_migrations" WHERE "migration_name" = ?`)
        .get("20260713120000_auto_register_on_first_private_message");
      expect(migration).not.toBeNull();
      const publishStartedMigration = after
        .query(`SELECT "migration_name" FROM "_prisma_migrations" WHERE "migration_name" = ?`)
        .get("20260724090000_add_bot_last_publish_started_at");
      expect(publishStartedMigration).not.toBeNull();
      expect(after.query("PRAGMA foreign_key_check").all()).toEqual([]);
      after.close();

      const repeated = applySqliteBaseline(currentBaseline, url, silentLogger);
      expect(repeated.applied).toEqual([]);
      expect(repeated.skipped).toContain("20260713120000_auto_register_on_first_private_message");
      expect(repeated.skipped).toContain("20260724090000_add_bot_last_publish_started_at");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
