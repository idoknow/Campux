import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const baselinePath = resolve(repoRoot, "packages/db/prisma/sqlite-baseline.sql");

let _sqliteBaselineSql: string | null = null;

export function getSqliteBaselineSql(): string {
  if (_sqliteBaselineSql !== null) return _sqliteBaselineSql;
  try {
    _sqliteBaselineSql = readFileSync(baselinePath, "utf-8");
  } catch (err) {
    throw new Error(`failed to read SQLite baseline SQL from ${baselinePath}: ${err instanceof Error ? err.message : String(err)}`);
  }
  return _sqliteBaselineSql;
}