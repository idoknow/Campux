#!/usr/bin/env bun
/**
 * 从「权威的 PostgreSQL schema」(packages/db/prisma/schema.prisma) 派生出
 * 一份等价的 **SQLite** schema，并据此：
 *
 *   1. 生成 SQLite 版 Prisma Client 到 packages/db/generated/sqlite/
 *   2. 用 `prisma migrate diff` 产出一份 **baseline DDL**（单文件 SQLite 建库脚本），
 *      并修正 Prisma SQLite 连接器的一个 DDL bug：`Json @default("[]"/"{...}")` 会被
 *      渲染成 `JSONB DEFAULT []`（字面量未加引号），SQLite 解析器直接报
 *      `unrecognized token "{"`。这里把这些默认值字面量用单引号包成合法 SQLite 文本默认值。
 *
 * 为什么要派生而不是手写两份 schema：模型/字段会持续演进，两份手写必然漂移。
 * 单一来源 = postgres schema，sqlite 形态只是「同一数据模型的另一种方言」。
 *
 * 设计取舍：
 * - Postgres 形态保留完整的 46 步迁移历史（生产库需要平滑演进）。
 * - SQLite 形态面向「全新自托管单文件部署」，库总是从零创建，因此只需 **一份 baseline
 *   建库 DDL**，不需要逐步迁移历史。后续 schema 演进时重新跑本脚本即可刷新 baseline。
 *   （若将来需要对已存在的 SQLite 库做在线迁移，可再引入 sqlite 迁移目录；当前 YAGNI。）
 *
 * 用法：bun run scripts/generate-sqlite-schema.ts
 *   --check   只校验「现有产物与当前 postgres schema 一致」，不写盘（CI 用）。
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { $ } from "bun";

const repoRoot = resolve(import.meta.dirname!, "..");
const dbDir = join(repoRoot, "packages/db");
const pgSchemaPath = join(dbDir, "prisma/schema.prisma");
const sqliteSchemaPath = join(dbDir, "prisma/schema.sqlite.prisma");
const generatedDir = join(dbDir, "generated/sqlite");
const baselineDdlPath = join(dbDir, "prisma/sqlite-baseline.sql");

const checkOnly = process.argv.includes("--check");

/**
 * 把权威的 postgres schema 文本转换为等价的 sqlite schema 文本。
 * 仅替换 generator/datasource 头部，模型/枚举原样保留（SQLite 连接器会把
 * enum 退化为 TEXT、Json 退化为 JSONB-as-TEXT，已实测全字段类型可用）。
 */
function derivePgToSqlite(pgSchema: string): string {
  const header = `generator client {
  provider = "prisma-client-js"
  output   = "../generated/sqlite"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}
`;
  // 砍掉原 generator + datasource 头部（从第一个 enum/model 之前），拼接新头部。
  const bodyStart = pgSchema.search(/^\s*(enum|model)\s+/m);
  if (bodyStart < 0) {
    throw new Error("无法在 schema.prisma 中定位第一个 enum/model 声明");
  }
  return header + "\n" + pgSchema.slice(bodyStart);
}

/**
 * 修正 Prisma SQLite 连接器的 Json 默认值 DDL bug。
 * 把 `"col" JSONB[ NOT NULL] DEFAULT <[...]|{...}>` 中的未加引号字面量
 * 包成单引号 SQLite 文本默认值（内部单引号转义为 '')。
 */
function fixJsonDefaults(ddl: string): string {
  return ddl
    .split("\n")
    .map((line) => {
      const m = /(JSONB(?: NOT NULL)?) DEFAULT (\[.*\]|\{.*\})(,?)\s*$/.exec(line);
      if (!m) return line;
      const lit = m[2]!;
      const comma = m[3]!;
      const escaped = lit.replace(/'/g, "''");
      return line.slice(0, m.index) + `${m[1]} DEFAULT '${escaped}'${comma}`;
    })
    .join("\n");
}

async function main() {
  const pgSchema = readFileSync(pgSchemaPath, "utf8");
  const sqliteSchema = derivePgToSqlite(pgSchema);

  // 1) 写 sqlite schema 文件
  if (checkOnly) {
    const existing = existsSync(sqliteSchemaPath) ? readFileSync(sqliteSchemaPath, "utf8") : "";
    if (existing.trim() !== sqliteSchema.trim()) {
      console.error(
        "[generate-sqlite-schema] schema.sqlite.prisma 与当前 postgres schema 不一致，请运行 `bun run db:sqlite:generate` 后提交。",
      );
      process.exit(1);
    }
  } else {
    writeFileSync(sqliteSchemaPath, sqliteSchema);
  }

  // 2) 生成 baseline DDL（from-empty diff → SQLite 建库脚本），并修正 Json 默认值
  const prismaBin = join(dbDir, "node_modules/.bin/prisma");
  const rawDdl = (
    await $`${prismaBin} migrate diff --from-empty --to-schema-datamodel ${sqliteSchemaPath} --script`
      .cwd(dbDir)
      .quiet()
  ).stdout.toString();
  const fixedDdl = fixJsonDefaults(rawDdl);

  if (checkOnly) {
    const existing = existsSync(baselineDdlPath) ? readFileSync(baselineDdlPath, "utf8") : "";
    if (existing.trim() !== fixedDdl.trim()) {
      console.error(
        "[generate-sqlite-schema] sqlite-baseline.sql 与当前 schema 不一致，请运行 `bun run db:sqlite:generate` 后提交。",
      );
      process.exit(1);
    }
    console.log("[generate-sqlite-schema] --check 通过：sqlite schema 与 baseline 均最新。");
    return;
  }

  writeFileSync(baselineDdlPath, fixedDdl);

  // 3) 生成 sqlite Prisma Client
  if (existsSync(generatedDir)) rmSync(generatedDir, { recursive: true, force: true });
  mkdirSync(generatedDir, { recursive: true });
  // 生成时需要一个 DATABASE_URL（sqlite），但不会真正连库。
  await $`${prismaBin} generate --schema ${sqliteSchemaPath}`
    .cwd(dbDir)
    .env({ ...process.env, DATABASE_URL: "file:./dev-sqlite.db" });

  const tableCount = (fixedDdl.match(/CREATE TABLE/g) ?? []).length;
  console.log(
    `[generate-sqlite-schema] 完成：\n` +
      `  schema  → ${sqliteSchemaPath}\n` +
      `  baseline→ ${baselineDdlPath} (${tableCount} 张表)\n` +
      `  client  → ${generatedDir}`,
  );
}

main().catch((err) => {
  console.error("[generate-sqlite-schema] 失败：", err);
  process.exit(1);
});
