import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { applySqliteBaseline, sqliteFilePathFromUrl } from "./migrate-sqlite";

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

const BASELINE = `CREATE TABLE "Widget" ("id" TEXT PRIMARY KEY NOT NULL, "name" TEXT NOT NULL);
CREATE TABLE "Gadget" ("id" TEXT PRIMARY KEY NOT NULL, "meta" JSONB NOT NULL DEFAULT '{}');`;

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
});
