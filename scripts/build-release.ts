#!/usr/bin/env bun
/**
 * Campux 单可执行文件（standalone binary）发布构建脚本。
 *
 * 产出一个自包含的可执行文件：内嵌前端产物、SVG 头像、数据库迁移、Prisma 查询引擎、
 * sharp、argon2 等，运行时只需要一个可达的 PostgreSQL（外部依赖见 README/docs）。
 *
 * 用法：
 *   bun run scripts/build-release.ts                 # 为当前主机 OS/架构构建
 *   bun run scripts/build-release.ts --version v1.2.3 # 指定版本号（默认取 git 描述）
 *   bun run scripts/build-release.ts --out release    # 指定输出目录（默认 release/）
 *
 * ⚠️ 原生插件（Prisma 引擎 / sharp / argon2）是按平台编译的二进制，无法跨平台交叉编译。
 *    每个目标平台必须在「对应架构的原生 runner」上构建——CI 用 native-runner 矩阵实现
 *    （见 .github/workflows/release.yml）。本脚本只为运行它的主机平台产出可用产物。
 *
 * 退出码非 0 表示构建失败。
 */
import { mkdirSync, rmSync, existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { $ } from "bun";

const repoRoot = resolve(import.meta.dirname!, "..");

// ── 参数解析 ───────────────────────────────────────
function arg(name: string, fallback?: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx !== -1 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return fallback;
}

// ── 平台标识 ───────────────────────────────────────
const PLATFORM_MAP: Record<string, string> = {
  linux: "linux",
  darwin: "darwin",
  win32: "windows",
};
const ARCH_MAP: Record<string, string> = {
  x64: "x64",
  arm64: "arm64",
};

const hostOs = PLATFORM_MAP[process.platform];
const hostArch = ARCH_MAP[process.arch];
if (!hostOs || !hostArch) {
  console.error(`不支持的主机平台：${process.platform}/${process.arch}`);
  process.exit(1);
}
const isWindows = hostOs === "windows";

async function gitVersion(): Promise<string> {
  try {
    const tag = (await $`git -C ${repoRoot} describe --tags --always --dirty`.quiet()).stdout
      .toString()
      .trim();
    return tag || "dev";
  } catch {
    return "dev";
  }
}

async function main() {
  const version = arg("version") ?? process.env.CAMPUX_BUILD_VERSION ?? (await gitVersion());
  const outDir = resolve(repoRoot, arg("out", "release")!);

  const binBase = `campux-${hostOs}-${hostArch}`;
  const binName = isWindows ? `${binBase}.exe` : binBase;
  const outFile = join(outDir, binName);

  console.log(`▶ 构建 Campux standalone：${binName}  (version=${version})`);

  mkdirSync(outDir, { recursive: true });
  if (existsSync(outFile)) rmSync(outFile);

  // 1) 前端构建
  console.log("  [1/6] 构建前端 (bun --cwd apps/web build)…");
  await $`bun --cwd ${join(repoRoot, "apps/web")} build`.cwd(repoRoot);

  // 2) Prisma client 生成（postgres，确保内嵌的类型/引擎为最新）
  console.log("  [2/6] 生成 Prisma Client (bun run db:generate)…");
  await $`bun --cwd ${join(repoRoot, "packages/db")} prisma generate`.cwd(repoRoot);

  // 3) 生成 SQLite schema + client + baseline DDL（单文件默认走 sqlite）
  console.log("  [3/6] 生成 SQLite client + baseline (db:sqlite:generate)…");
  await $`bun ${join(repoRoot, "scripts/generate-sqlite-schema.ts")}`.cwd(repoRoot);

  // 4) 生成内嵌资源清单（前端产物 + SVG + 迁移 + sqlite baseline + Prisma 引擎）
  console.log("  [4/6] 生成内嵌资源清单…");
  await $`bun ${join(repoRoot, "scripts/generate-embedded-assets.ts")}`.cwd(repoRoot);

  // 5) 编译单文件
  console.log("  [5/6] 编译单可执行文件 (bun build --compile)…");
  const entry = join(repoRoot, "apps/server/src/standalone/entry.ts");
  // chromium-bidi 是 playwright 的可选 BiDi 传输，未安装；外部化避免打包解析失败。
  // 原生插件（prisma 引擎 / sharp / argon2）让 bun 自动内嵌（已验证可用）。
  const buildArgs = [
    "build",
    entry,
    "--compile",
    "--target=bun",
    "--external",
    "chromium-bidi",
    "--define",
    `process.env.CAMPUX_BUILD_VERSION=${JSON.stringify(version)}`,
    "--outfile",
    outFile,
  ];
  if (isWindows) buildArgs.push("--windows-hide-console");

  const proc = Bun.spawn(["bun", ...buildArgs], {
    cwd: repoRoot,
    stdout: "inherit",
    stderr: "inherit",
    env: { ...process.env, CAMPUX_BUILD_VERSION: version },
  });
  const code = await proc.exited;
  if (code !== 0) {
    console.error(`✗ 编译失败，退出码 ${code}`);
    process.exit(code);
  }

  // 6) 校验和
  console.log("  [6/6] 计算 SHA256 校验和…");
  const bytes = await Bun.file(outFile).arrayBuffer();
  const sha = createHash("sha256").update(Buffer.from(bytes)).digest("hex");
  const shaFile = `${outFile}.sha256`;
  await Bun.write(shaFile, `${sha}  ${binName}\n`);

  const sizeMb = (statSync(outFile).size / 1024 / 1024).toFixed(1);
  console.log(`\n✓ 完成：${outFile}`);
  console.log(`  大小：${sizeMb} MiB`);
  console.log(`  SHA256：${sha}`);
  console.log(`  校验和文件：${shaFile}`);
}

main().catch((err) => {
  console.error("构建脚本异常：", err);
  process.exit(1);
});
