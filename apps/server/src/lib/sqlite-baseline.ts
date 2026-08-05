import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const baselinePath = resolve(repoRoot, "packages/db/prisma/sqlite-baseline.sql");

export const sqliteBaselineSql = readFileSync(baselinePath, "utf-8");