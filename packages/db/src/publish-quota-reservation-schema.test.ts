import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "../prisma");
const migration = "20261027120000_durable_tenant_publish_quota_reservations";
const tableName = "TenantPublishQuotaReservation";
const uniqueIndex = `${tableName}_tenantId_postId_periodType_periodStart_key`;
const statusIndex = `${tableName}_tenantId_periodType_periodStart_status_idx`;
const expectedIndexes = [
  [uniqueIndex, true, ["tenantId", "postId", "periodType", "periodStart"]],
  [statusIndex, false, ["tenantId", "periodType", "periodStart", "status"]],
] as const;

type IndexListRow = { name: string; unique: number };
type IndexColumnRow = { seqno: number; name: string };
type ForeignKeyRow = { id: number; seq: number; table: string; from: string; to: string; on_delete: string };

function expectReservationSchema(db: Database): void {
  const table = db.query("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(tableName) as { sql: string } | null;
  expect(table).not.toBeNull();
  expect(table!.sql).toContain('FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id")');
  expect(table!.sql).toContain('FOREIGN KEY ("tenantId", "postId") REFERENCES "Post" ("tenantId", "id")');
  expect(table!.sql).toMatch(/CHECK\s*\(\s*"periodType"\s+IN\s*\('hourly',\s*'daily'\)\s*\)/);
  expect(table!.sql).toMatch(/CHECK\s*\(\s*"status"\s+IN\s*\('reserved',\s*'consumed',\s*'released'\)\s*\)/);

  const indexes = db.query(`PRAGMA index_list("${tableName}")`).all() as IndexListRow[];
  for (const [name, unique, columns] of expectedIndexes) {
    const index = indexes.find((candidate) => candidate.name === name);
    expect(index).toBeDefined();
    expect(index!.unique).toBe(Number(unique));
    const actualColumns = (db.query(`PRAGMA index_info("${name}")`).all() as IndexColumnRow[])
      .sort((a, b) => a.seqno - b.seqno).map(({ name: column }) => column);
    expect(actualColumns).toEqual(columns);
  }

  const foreignKeys = db.query(`PRAGMA foreign_key_list("${tableName}")`).all() as ForeignKeyRow[];
  const tenantFk = foreignKeys.filter(({ table }) => table === "Tenant");
  expect(tenantFk.map(({ from, to }) => [from, to])).toEqual([["tenantId", "id"]]);
  const postFk = foreignKeys.filter(({ table }) => table === "Post").sort((a, b) => a.seq - b.seq);
  expect(postFk.map(({ from, to }) => [from, to])).toEqual([["tenantId", "tenantId"], ["postId", "id"]]);
}

describe("durable publish quota reservation schema", () => {
  test("SQLite baseline enforces tenant-scoped references, enum values, uniqueness, and index order", () => {
    const db = new Database(":memory:");
    try {
      db.exec("PRAGMA foreign_keys=ON");
      db.exec(readFileSync(join(root, "sqlite-baseline.sql"), "utf8"));
      expectReservationSchema(db);
      expect(() => db.query(`INSERT INTO "TenantPublishQuotaReservation" ("id","tenantId","postId","periodType","periodStart","updatedAt") VALUES ('x','missing','missing','weekly',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).run()).toThrow();
    } finally { db.close(); }
  });

  test("SQL migration files retain the SQLite baseline's table, constraints, and index layout", () => {
    const db = new Database(":memory:");
    try {
      db.exec(`CREATE TABLE "Tenant" ("id" TEXT PRIMARY KEY); CREATE TABLE "Post" ("tenantId" TEXT NOT NULL, "id" TEXT NOT NULL, PRIMARY KEY ("tenantId", "id"));`);
      db.exec(readFileSync(join(root, "migrations", migration, "sqlite.sql"), "utf8"));
      expectReservationSchema(db);
    } finally { db.close(); }

    const sqlite = readFileSync(join(root, "migrations", migration, "sqlite.sql"), "utf8");
    const pg = readFileSync(join(root, "migrations", migration, "migration.sql"), "utf8");
    for (const sql of [sqlite, pg]) {
      expect(sql).toContain('FOREIGN KEY ("tenantId", "postId") REFERENCES "Post"("tenantId", "id")');
      expect(sql).toMatch(/CHECK\s*\(\s*"periodType"\s+IN\s*\('hourly',\s*'daily'\)\s*\)/);
      expect(sql).toMatch(/CHECK\s*\(\s*"status"\s+IN\s*\('reserved',\s*'consumed',\s*'released'\)\s*\)/);
      expect(sql).toContain(`UNIQUE INDEX "${uniqueIndex}"`);
      expect(sql).toContain(`INDEX "${statusIndex}"`);
    }
  });
});
