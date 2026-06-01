import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import type { FastifyBaseLogger } from "fastify";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const dbPackageDir = resolve(repoRoot, "packages/db");

export async function runDatabaseMigrations(logger: Pick<FastifyBaseLogger, "info" | "error"> = console) {
  if (process.env.CAMPUX_SKIP_AUTO_MIGRATE === "1" || process.env.CAMPUX_SKIP_AUTO_MIGRATE === "true") {
    logger.info("database migration skipped by CAMPUX_SKIP_AUTO_MIGRATE");
    return;
  }

  logger.info("running database migrations");
  const bunGlobal = (globalThis as any).Bun;
  if (bunGlobal && typeof bunGlobal.spawn === "function") {
    const proc: any = bunGlobal.spawn(["bun", "--cwd", dbPackageDir, "prisma", "migrate", "deploy"], {
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
    const cp = spawn("bun", ["--cwd", dbPackageDir, "prisma", "migrate", "deploy"], { cwd: repoRoot, env: process.env });
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
