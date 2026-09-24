import { describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { Database } from "bun:sqlite";
import { applySqliteBaseline, type SqliteMigrateLogger } from "@campux/db/src/migrate-sqlite";
import { getSqliteBaselineSql } from "./lib/sqlite-baseline";

const logger: SqliteMigrateLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
const BROADCAST_MIGRATION = "20260924120000_add_broadcast_notifications";
const dbPath = "/tmp/campux-broadcast-sqlite-check.db";

function tableExists(db: Database, name: string): boolean {
  return db.query(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(name) !== null;
}

describe("sqlite 广播通知增量迁移", () => {
  // 先删旧库，保证两个用例都从“全新库”开始（否则会复用上次运行的已记账状态）。
  try {
    unlinkSync(dbPath);
  } catch {
    // 库不存在时忽略。
  }

  test("新库：baseline 自带表，新迁移幂等跳过", () => {
    const result = applySqliteBaseline(getSqliteBaselineSql(), `file:${dbPath}`, logger);
    expect(result.applied).toContain("0_sqlite_baseline");
    expect(result.skipped).toContain(BROADCAST_MIGRATION);

    const db = new Database(dbPath);
    expect(tableExists(db, "TenantBroadcast")).toBe(true);
    expect(tableExists(db, "TenantBroadcastVersion")).toBe(true);
    db.close();
  });

  test("老库：新迁移能补出表与编号列并记账，且可重复运行", () => {
    const db = new Database(dbPath);
    db.exec("PRAGMA foreign_keys=OFF");
    db.exec("BEGIN");
    db.exec(`DROP TABLE IF EXISTS "TenantBroadcastVersion"`);
    db.exec(`DROP TABLE IF EXISTS "TenantBroadcast"`);
    db.exec(`ALTER TABLE "Tenant" DROP COLUMN "nextBroadcastDisplayId"`);
    db.exec(`DELETE FROM "_prisma_migrations" WHERE migration_name = '${BROADCAST_MIGRATION}'`);
    db.exec("COMMIT");
    db.exec("PRAGMA foreign_keys=ON");
    db.close();

    const upgraded = applySqliteBaseline(getSqliteBaselineSql(), `file:${dbPath}`, logger);
    expect(upgraded.applied).toContain(BROADCAST_MIGRATION);

    const db2 = new Database(dbPath);
    expect(tableExists(db2, "TenantBroadcast")).toBe(true);
    expect(tableExists(db2, "TenantBroadcastVersion")).toBe(true);
    expect(
      db2.query(`SELECT 1 FROM pragma_table_info('Tenant') WHERE name='nextBroadcastDisplayId'`).get(),
    ).not.toBeUndefined();
    expect(
      db2.query(`SELECT 1 FROM "_prisma_migrations" WHERE migration_name=? AND rolled_back_at IS NULL`).get(BROADCAST_MIGRATION),
    ).not.toBeUndefined();
    expect(db2.query("PRAGMA foreign_key_check").all().length).toBe(0);
    db2.close();

    const again = applySqliteBaseline(getSqliteBaselineSql(), `file:${dbPath}`, logger);
    expect(again.skipped).toContain(BROADCAST_MIGRATION);
    expect(again.applied).not.toContain(BROADCAST_MIGRATION);
  });
});
