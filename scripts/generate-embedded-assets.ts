#!/usr/bin/env bun
/**
 * 生成单可执行文件（standalone binary）所需的「内嵌资源清单」。
 *
 * `bun build --compile` 只能内嵌「被静态 import 语句引用」的文件（`with { type: "file" | "text" }`），
 * 不支持运行时 glob。所以发布前由本脚本扫描以下三类资源，生成一个带显式静态 import 的
 * TypeScript 清单文件 `apps/server/src/standalone/embedded-assets.generated.ts`：
 *
 *   1. 前端构建产物  apps/web/dist/**          → 运行时解包到临时目录并以 CAMPUX_WEB_DIST_DIR 指向
 *   2. 匿名头像 SVG  svg/*.svg                 → 同上，CAMPUX_SVG_DIR 指向
 *   3. 数据库迁移    packages/db/prisma/migrations/<name>/migration.sql
 *                                              → 以文本内嵌，运行时由自包含迁移器执行
 *
 * 用法：bun run scripts/generate-embedded-assets.ts
 * 由 scripts/build-release.ts 在每次 compile 前自动调用，保证清单与当前产物一致。
 */
import { readdirSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname!, "..");
const outFile = resolve(repoRoot, "apps/server/src/standalone/embedded-assets.generated.ts");
const outDir = resolve(repoRoot, "apps/server/src/standalone");

const webDistDir = resolve(repoRoot, "apps/web/dist");
const svgDir = resolve(repoRoot, "svg");
const migrationsDir = resolve(repoRoot, "packages/db/prisma/migrations");

function walk(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

/** 把绝对路径转成「从生成文件目录出发」的相对 import 路径（始终以 ./ 或 ../ 开头）。 */
function importSpecifier(absPath: string): string {
  let rel = relative(outDir, absPath).split("\\").join("/");
  if (!rel.startsWith(".")) rel = `./${rel}`;
  return rel;
}

// ── 1. 前端构建产物 ─────────────────────────────────
const webFiles = walk(webDistDir).sort();
if (webFiles.length === 0) {
  console.error(
    `[generate-embedded-assets] apps/web/dist 为空或不存在，请先运行 \`bun --cwd apps/web build\`。`,
  );
  process.exit(1);
}

// ── 2. 匿名头像 SVG ────────────────────────────────
const svgFiles = walk(svgDir)
  .filter((f) => f.endsWith(".svg"))
  .sort();

// ── 3. 数据库迁移 ──────────────────────────────────
const migrationNames = readdirSync(migrationsDir)
  .filter((name) => {
    try {
      return statSync(resolve(migrationsDir, name)).isDirectory();
    } catch {
      return false;
    }
  })
  .sort();
const migrations = migrationNames
  .map((name) => ({ name, sql: resolve(migrationsDir, name, "migration.sql") }))
  .filter((m) => {
    try {
      return statSync(m.sql).isFile();
    } catch {
      return false;
    }
  });

// ── 生成 TS 源 ─────────────────────────────────────
const lines: string[] = [];
lines.push("// 本文件由 scripts/generate-embedded-assets.ts 自动生成，请勿手动编辑。");
lines.push("// This file is auto-generated. Do not edit by hand.");
lines.push("// 它只在 `bun build --compile` 的 standalone 入口里被引用，普通 tsc 构建会排除它。");
lines.push("/* eslint-disable */");
lines.push("");

const webImports: string[] = [];
webFiles.forEach((abs, idx) => {
  const rel = relative(webDistDir, abs).split("\\").join("/");
  lines.push(`import web_${idx} from ${JSON.stringify(importSpecifier(abs))} with { type: "file" };`);
  webImports.push(`  { path: ${JSON.stringify(rel)}, file: web_${idx} },`);
});
lines.push("");

const svgImports: string[] = [];
svgFiles.forEach((abs, idx) => {
  const base = abs.split("/").pop()!;
  lines.push(`import svg_${idx} from ${JSON.stringify(importSpecifier(abs))} with { type: "file" };`);
  svgImports.push(`  { name: ${JSON.stringify(base)}, file: svg_${idx} },`);
});
lines.push("");

const migImports: string[] = [];
migrations.forEach((m, idx) => {
  lines.push(`import mig_${idx} from ${JSON.stringify(importSpecifier(m.sql))} with { type: "text" };`);
  migImports.push(`  { name: ${JSON.stringify(m.name)}, sql: mig_${idx} },`);
});
lines.push("");

lines.push("/** 运行时需要写到磁盘的内嵌文件：file 为 Bun 内嵌文件路径，可用 Bun.file() 读取。 */");
lines.push("export interface EmbeddedFileEntry {");
lines.push("  /** 相对路径（含子目录），如 `assets/index-xxx.js`。 */");
lines.push("  path: string;");
lines.push("  /** Bun 内嵌文件句柄路径。 */");
lines.push("  file: string;");
lines.push("}");
lines.push("");
lines.push("export const embeddedWebAssets: EmbeddedFileEntry[] = [");
lines.push(...webImports);
lines.push("];");
lines.push("");
lines.push("export const embeddedSvgAvatars: { name: string; file: string }[] = [");
lines.push(...svgImports);
lines.push("];");
lines.push("");
lines.push("export const embeddedMigrations: { name: string; sql: string }[] = [");
lines.push(...migImports);
lines.push("];");
lines.push("");

await Bun.write(outFile, lines.join("\n"));

console.log(
  `[generate-embedded-assets] 已生成 ${relative(repoRoot, outFile)}：` +
    `${webFiles.length} 个前端文件、${svgFiles.length} 个 SVG、${migrations.length} 个迁移。`,
);
