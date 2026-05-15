import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyBaseLogger } from "fastify";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const dbPackageDir = resolve(repoRoot, "packages/db");

export async function runDatabaseMigrations(logger: Pick<FastifyBaseLogger, "info" | "error"> = console) {
  if (process.env.CAMPUX_SKIP_AUTO_MIGRATE === "1" || process.env.CAMPUX_SKIP_AUTO_MIGRATE === "true") {
    logger.info("database migration skipped by CAMPUX_SKIP_AUTO_MIGRATE");
    return;
  }

  logger.info("running database migrations");
  const proc = Bun.spawn(["bun", "--cwd", dbPackageDir, "prisma", "migrate", "deploy"], {
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
}
