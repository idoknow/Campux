#!/usr/bin/env bun
/**
 * 单可执行文件（standalone binary）入口。
 *
 * 仅用于 `bun build --compile`，普通的 `tsc` / Docker 构建不会引用本文件
 * （apps/server/tsconfig.json 通过 exclude 排除整个 standalone/ 目录）。
 *
 * 目标：产出一个「零外部依赖」的自包含二进制——默认用 SQLite + 本地文件系统存储，
 * 运行时不需要 PostgreSQL、不需要 MinIO/S3。也允许用户通过环境变量切回 PG + S3。
 *
 * 与 Docker 形态的差异全部在这里抹平：
 *   1. 数据目录：默认 ./data（可用 CAMPUX_DATA_DIR 固定）。SQLite 库、本地存储、解包的
 *      内嵌资源都放在这里。
 *   2. 默认 DATABASE_URL：未设置时指向 `file:<dataDir>/campux.db`（→ @campux/db 选 SQLite）。
 *   3. 默认存储：未设置 CAMPUX_STORAGE_DRIVER 时按 db provider 推断（sqlite→local），
 *      local 目录默认 `<dataDir>/uploads`。
 *   4. 内嵌 Prisma 查询引擎（.node）：bun --compile 不会自动带上，运行时按构建机绝对路径
 *      找不到会崩溃。这里解包到数据目录并设 PRISMA_QUERY_ENGINE_LIBRARY 指过去。
 *   5. 解包内嵌前端产物 / SVG 头像，用 CAMPUX_WEB_DIST_DIR / CAMPUX_SVG_DIR 指给 server。
 *   6. 跑迁移：SQLite 走内嵌 baseline（applySqliteBaseline）；PostgreSQL 走内嵌迁移器
 *      （applyEmbeddedMigrations）。然后 CAMPUX_SKIP_AUTO_MIGRATE=1 让 server 跳过它自带的
 *      会 spawn `bun prisma` 的迁移路径。
 *   7. `import("../index")` 启动与 Docker 形态完全一致的 Fastify server。
 *
 * 设计原则：server 业务代码尽量不感知「是否 standalone」，只通过既有环境变量开关适配。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { applyEmbeddedMigrations } from "@campux/db/src/migrate";
import { applySqliteBaseline } from "@campux/db/src/migrate-sqlite";
import { resolveDbProvider } from "@campux/db";
import {
  embeddedMigrations,
  embeddedQueryEngine,
  embeddedSqliteBaselineSql,
  embeddedSvgAvatars,
  embeddedWebAssets,
} from "./embedded-assets.generated";

const CAMPUX_BUILD_VERSION = process.env.CAMPUX_BUILD_VERSION ?? "dev";

function log(msg: string, extra?: Record<string, unknown>) {
  console.log(JSON.stringify({ level: "info", scope: "standalone", msg, ...extra }));
}
function logError(msg: string, extra?: Record<string, unknown>) {
  console.error(JSON.stringify({ level: "error", scope: "standalone", msg, ...extra }));
}

/** 把一个内嵌文件（Bun.file 句柄路径）写到目标磁盘路径。 */
async function extractFile(embeddedPath: string, destPath: string) {
  mkdirSync(dirname(destPath), { recursive: true });
  const bytes = await Bun.file(embeddedPath).arrayBuffer();
  writeFileSync(destPath, Buffer.from(bytes));
}

async function extractAssets(rootDir: string) {
  const webDistDir = join(rootDir, "web");
  const svgDir = join(rootDir, "svg");
  for (const entry of embeddedWebAssets) {
    await extractFile(entry.file, join(webDistDir, entry.path));
  }
  for (const entry of embeddedSvgAvatars) {
    await extractFile(entry.file, join(svgDir, entry.name));
  }
  return { webDistDir, svgDir };
}

async function main() {
  // 数据根目录：默认 ./data（相对启动时的工作目录），可用 CAMPUX_DATA_DIR 覆盖。
  const dataDir = resolve(process.env.CAMPUX_DATA_DIR ?? "./data");
  mkdirSync(dataDir, { recursive: true });

  // 1) 默认 DATABASE_URL（未设置 → SQLite 单文件，零依赖）。
  if (!process.env.DATABASE_URL || process.env.DATABASE_URL.trim() === "") {
    process.env.DATABASE_URL = `file:${join(dataDir, "campux.db")}`;
  }
  const provider = resolveDbProvider(process.env.DATABASE_URL, process.env.CAMPUX_DB_PROVIDER);

  // 2) 默认本地存储目录（仅当未显式指定时；driver 的选择仍由 config 按 provider 推断）。
  process.env.CAMPUX_STORAGE_LOCAL_DIR ??= join(dataDir, "uploads");

  // 3) 解包内嵌 Prisma 查询引擎并设 PRISMA_QUERY_ENGINE_LIBRARY（修复 bun --compile 的
  //    「引擎按构建机绝对路径找不到」崩溃）。引擎与 provider 无关，两种数据库都需要它。
  const enginePath = join(dataDir, "engine", embeddedQueryEngine.name);
  await extractFile(embeddedQueryEngine.file, enginePath);
  process.env.PRISMA_QUERY_ENGINE_LIBRARY ??= enginePath;

  log("campux standalone starting", {
    version: CAMPUX_BUILD_VERSION,
    dataDir,
    dbProvider: provider,
    webFiles: embeddedWebAssets.length,
    svgFiles: embeddedSvgAvatars.length,
    migrations: embeddedMigrations.length,
    queryEngine: embeddedQueryEngine.name,
  });

  // 4) 解包前端产物 / SVG 头像并通过环境变量指给 server（仅在用户未显式覆盖时）。
  const { webDistDir, svgDir } = await extractAssets(join(dataDir, "assets"));
  process.env.CAMPUX_WEB_DIST_DIR ??= webDistDir;
  process.env.CAMPUX_SVG_DIR ??= svgDir;

  // 5) 跑迁移（除非显式跳过）。
  if (process.env.CAMPUX_SKIP_AUTO_MIGRATE !== "1" && process.env.CAMPUX_SKIP_AUTO_MIGRATE !== "true") {
    const databaseUrl = process.env.DATABASE_URL!;
    try {
      if (provider === "sqlite") {
        log("applying embedded sqlite baseline");
        const result = applySqliteBaseline(embeddedSqliteBaselineSql, databaseUrl, {
          info: (obj, msg) =>
            console.log(JSON.stringify({ level: "info", scope: "migrate", msg, ...(obj as object) })),
          warn: (obj, msg) =>
            console.warn(JSON.stringify({ level: "warn", scope: "migrate", msg, ...(obj as object) })),
          error: (obj, msg) =>
            console.error(JSON.stringify({ level: "error", scope: "migrate", msg, ...(obj as object) })),
        });
        log("sqlite baseline done", { applied: result.applied.length, skipped: result.skipped.length });
      } else {
        log("running embedded postgres migrations");
        const result = await applyEmbeddedMigrations(embeddedMigrations, databaseUrl, {
          info: (obj, msg) =>
            console.log(JSON.stringify({ level: "info", scope: "migrate", msg, ...(obj as object) })),
          warn: (obj, msg) =>
            console.warn(JSON.stringify({ level: "warn", scope: "migrate", msg, ...(obj as object) })),
          error: (obj, msg) =>
            console.error(JSON.stringify({ level: "error", scope: "migrate", msg, ...(obj as object) })),
        });
        log("postgres migrations done", { applied: result.applied.length, skipped: result.skipped.length });
      }
    } catch (err) {
      logError("数据库迁移失败，启动中止。", {
        error: err instanceof Error ? err.message : String(err),
      });
      process.exit(1);
    }
  }
  // server 内部的迁移逻辑会 spawn `bun prisma ...`（standalone 形态下不存在），统一跳过。
  process.env.CAMPUX_SKIP_AUTO_MIGRATE = "1";

  // 6) 启动与 Docker 形态一致的 server（必须在环境变量都设置完成后再 import）。
  await import("../index");
}

main().catch((err) => {
  logError("standalone 启动失败", {
    error: err instanceof Error ? (err.stack ?? err.message) : String(err),
  });
  process.exit(1);
});
