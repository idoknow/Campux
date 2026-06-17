#!/usr/bin/env bun
/**
 * 单可执行文件（standalone binary）入口。
 *
 * 仅用于 `bun build --compile`，普通的 `tsc` / Docker 构建不会引用本文件
 * （apps/server/tsconfig.json 通过 exclude 排除整个 standalone/ 目录）。
 *
 * 与 Docker 形态（`bun --cwd apps/server src/index.ts` + 磁盘上的 packages/db、
 * apps/web/dist、svg/）的差异，全部在这里抹平：
 *
 *   1. 解包内嵌的前端产物 / SVG 头像到一个临时目录，并用环境变量指给 server：
 *        CAMPUX_WEB_DIST_DIR / CAMPUX_SVG_DIR
 *   2. 用「自包含迁移器」执行内嵌迁移（无需 prisma CLI 与 packages/db 目录），
 *      然后让 server 跳过它自带的、会 spawn `bun prisma migrate deploy` 的迁移逻辑
 *      （CAMPUX_SKIP_AUTO_MIGRATE=1）。
 *   3. 之后 `import("../index")` 启动与 Docker 形态完全一致的 Fastify server。
 *
 * 设计原则：server 业务代码尽量不感知「是否 standalone」，只通过既有的环境变量开关
 * 适配，避免在主链路里散落分支。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import { applyEmbeddedMigrations } from "@campux/db/src/migrate";
import { loadConfig } from "@campux/config";
import {
  embeddedMigrations,
  embeddedSvgAvatars,
  embeddedWebAssets,
} from "./embedded-assets.generated";

const CAMPUX_BUILD_VERSION = process.env.CAMPUX_BUILD_VERSION ?? "dev";

function log(msg: string, extra?: Record<string, unknown>) {
  const payload = { level: "info", scope: "standalone", msg, ...extra };
  console.log(JSON.stringify(payload));
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
  // 资源解包根目录：默认临时目录，可用 CAMPUX_DATA_DIR 固定（避免每次启动重复解包）。
  const baseDir = process.env.CAMPUX_DATA_DIR
    ? join(process.env.CAMPUX_DATA_DIR, "assets")
    : join(tmpdir(), `campux-standalone-${CAMPUX_BUILD_VERSION}`);

  log("campux standalone starting", {
    version: CAMPUX_BUILD_VERSION,
    assetsDir: baseDir,
    webFiles: embeddedWebAssets.length,
    svgFiles: embeddedSvgAvatars.length,
    migrations: embeddedMigrations.length,
  });

  // 1) 解包内嵌资源并通过环境变量指给 server（仅在用户未显式覆盖时）。
  const { webDistDir, svgDir } = await extractAssets(baseDir);
  process.env.CAMPUX_WEB_DIST_DIR ??= webDistDir;
  process.env.CAMPUX_SVG_DIR ??= svgDir;

  // 2) 运行内嵌迁移（除非显式跳过），然后让 server 跳过它自带的 CLI 迁移路径。
  if (
    process.env.CAMPUX_SKIP_AUTO_MIGRATE !== "1" &&
    process.env.CAMPUX_SKIP_AUTO_MIGRATE !== "true"
  ) {
    const databaseUrl = process.env.DATABASE_URL ?? loadConfig().databaseUrl;
    if (!databaseUrl) {
      console.error(
        JSON.stringify({
          level: "error",
          scope: "standalone",
          msg: "DATABASE_URL 未配置，无法运行数据库迁移。请设置 DATABASE_URL 后重试。",
        }),
      );
      process.exit(1);
    }
    log("running embedded database migrations");
    try {
      const result = await applyEmbeddedMigrations(embeddedMigrations, databaseUrl, {
        info: (obj, msg) =>
          console.log(JSON.stringify({ level: "info", scope: "migrate", msg, ...(obj as object) })),
        warn: (obj, msg) =>
          console.warn(JSON.stringify({ level: "warn", scope: "migrate", msg, ...(obj as object) })),
        error: (obj, msg) =>
          console.error(JSON.stringify({ level: "error", scope: "migrate", msg, ...(obj as object) })),
      });
      log("embedded migrations done", {
        applied: result.applied.length,
        skipped: result.skipped.length,
      });
    } catch (err) {
      console.error(
        JSON.stringify({
          level: "error",
          scope: "standalone",
          msg: "数据库迁移失败，启动中止。",
          error: err instanceof Error ? err.message : String(err),
        }),
      );
      process.exit(1);
    }
  }
  // server 内部的迁移逻辑会 spawn `bun prisma ...`（standalone 形态下不存在），
  // 这里统一跳过——迁移已在上面完成。
  process.env.CAMPUX_SKIP_AUTO_MIGRATE = "1";

  // 3) 启动与 Docker 形态一致的 server。注意：必须在环境变量设置完成后再 import，
  //    因为 server 模块在顶层就会读取这些配置。
  await import("../index");
}

main().catch((err) => {
  console.error(
    JSON.stringify({
      level: "error",
      scope: "standalone",
      msg: "standalone 启动失败",
      error: err instanceof Error ? (err.stack ?? err.message) : String(err),
    }),
  );
  process.exit(1);
});
