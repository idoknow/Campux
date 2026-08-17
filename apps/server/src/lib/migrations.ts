import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import type { FastifyBaseLogger } from "fastify";
import { resolveDbProvider, applySqliteBaseline } from "@campux/db";
import { getSqliteBaselineSql } from "./sqlite-baseline";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const dbPackageDir = resolve(repoRoot, "packages/db");

function resolveBunBinary(): string {
  const npmGlobalBun = join(
    process.env.APPDATA ?? join(process.env.USERPROFILE ?? "C:\\Users\\Default", "AppData\\Roaming"),
    "npm",
    "node_modules",
    "bun",
    "bin",
    "bun.exe",
  );
  if (existsSync(npmGlobalBun)) return npmGlobalBun;
  return "bun";
}

export async function runDatabaseMigrations(logger: Pick<FastifyBaseLogger, "info" | "warn" | "error"> = console) {
  if (process.env.CAMPUX_SKIP_AUTO_MIGRATE === "1" || process.env.CAMPUX_SKIP_AUTO_MIGRATE === "true") {
    logger.info("database migration skipped by CAMPUX_SKIP_AUTO_MIGRATE");
    return;
  }

  logger.info("running database migrations");

  const databaseUrl = process.env.DATABASE_URL ?? "";
  if (!databaseUrl) {
    throw new Error("DATABASE_URL environment variable is required but not set");
  }
  const provider = resolveDbProvider(databaseUrl, process.env.CAMPUX_DB_PROVIDER);

  if (provider === "sqlite") {
    const results = applySqliteBaseline(getSqliteBaselineSql(), databaseUrl, {
      info: (_obj, msg) => logger.info(msg),
      warn: (_obj, msg) => logger.warn(msg),
      error: (_obj, msg) => logger.error(msg),
    });
    logger.info({ applied: results.applied.length, skipped: results.skipped.length }, "sqlite baseline applied");
    return;
  }

  // PostgreSQL: spawn prisma migrate deploy.
  const bunExe = resolveBunBinary();
  const bunGlobal = (globalThis as any).Bun;
  if (bunGlobal && typeof bunGlobal.spawn === "function") {
    const proc: any = bunGlobal.spawn([bunExe, "--cwd", dbPackageDir, "prisma", "migrate", "deploy"], {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    });
    const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    if (stdout.trim()) {
      logger.info({ output: stdout.trim() }, "database migration output");
    }
    if (exitCode !== 0) {
      if (stderr.trim()) {
        logger.error({ output: stderr.trim() }, "database migration stderr");
      }
      throw new Error(`database migration failed with exit code ${exitCode}`);
    }
    if (stderr.trim()) {
      logger.info({ output: stderr.trim() }, "database migration stderr");
    }
    logger.info("database migrations completed");
    return;
  }

  // Fallback to node child_process.spawn for environments without Bun
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const cp = spawn(bunExe, ["--cwd", dbPackageDir, "prisma", "migrate", "deploy"], { cwd: repoRoot, env: process.env });
    let stdout = "";
    let stderr = "";
    if (cp.stdout) {
      cp.stdout.on("data", (chunk) => (stdout += String(chunk)));
    }
    if (cp.stderr) {
      cp.stderr.on("data", (chunk) => (stderr += String(chunk)));
    }
    cp.on("error", (err) => rejectPromise(err));
    cp.on("close", (code) => {
      if (stdout.trim()) logger.info({ output: stdout.trim() }, "database migration output");
      if (code !== 0) {
        if (stderr.trim()) logger.error({ output: stderr.trim() }, "database migration stderr");
        rejectPromise(new Error(`database migration failed with exit code ${code}`));
        return;
      }
      if (stderr.trim()) logger.info({ output: stderr.trim() }, "database migration stderr");
      logger.info("database migrations completed");
      resolvePromise();
    });
  });
}
