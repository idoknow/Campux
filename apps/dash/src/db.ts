import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { TelemetryReport } from "@campux/telemetry";

// Two tables: `instances` is the current snapshot per installation (one row per
// anonymous instance id), `reports` is the heartbeat time series the charts
// aggregate over. Reports carry only the columns the dashboard queries; the
// full latest payload is kept on the instance row for debugging.
const schema = `
CREATE TABLE IF NOT EXISTS instances (
  instance_id    TEXT PRIMARY KEY,
  instance_name  TEXT,
  first_seen_at  INTEGER NOT NULL,
  first_seen_day TEXT NOT NULL,
  last_seen_at   INTEGER NOT NULL,
  report_count   INTEGER NOT NULL DEFAULT 0,
  version        TEXT NOT NULL,
  environment    TEXT NOT NULL,
  deploy_mode    TEXT NOT NULL,
  country        TEXT,
  tenants        INTEGER NOT NULL DEFAULT 0,
  users          INTEGER NOT NULL DEFAULT 0,
  posts_total    INTEGER NOT NULL DEFAULT 0,
  posts_last_24h INTEGER NOT NULL DEFAULT 0,
  bots_enabled   INTEGER NOT NULL DEFAULT 0,
  last_payload   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS instances_last_seen_idx ON instances(last_seen_at);

CREATE TABLE IF NOT EXISTS reports (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  instance_id    TEXT NOT NULL,
  received_at    INTEGER NOT NULL,
  day            TEXT NOT NULL,
  environment    TEXT NOT NULL,
  version        TEXT NOT NULL,
  deploy_mode    TEXT NOT NULL,
  tenants        INTEGER NOT NULL,
  users          INTEGER NOT NULL,
  posts_total    INTEGER NOT NULL,
  posts_last_24h INTEGER NOT NULL,
  bots_enabled   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS reports_day_idx ON reports(day, instance_id);
CREATE INDEX IF NOT EXISTS reports_instance_idx ON reports(instance_id, received_at);
`;

export function openDashDatabase(path: string): Database {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec(schema);
  return db;
}

// Day bucket key in process-local time. The dash process is pinned to
// Asia/Shanghai (same convention as the main server) so fleet days line up
// with Chinese calendar days.
export function formatDay(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${m}-${d}`;
}

// Ascending list of the `count` day keys ending at `now`'s day.
export function lastDays(now: Date, count: number): string[] {
  const days: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    days.push(formatDay(new Date(now.getTime() - i * 24 * 60 * 60 * 1000)));
  }
  return days;
}

export type IngestMeta = {
  receivedAt: Date;
  // ISO 3166-1 alpha-2, from the CDN edge (e.g. CF-IPCountry) when available.
  country: string | null;
};

export function ingestReport(db: Database, report: TelemetryReport, meta: IngestMeta): void {
  const receivedAt = meta.receivedAt.getTime();
  const day = formatDay(meta.receivedAt);
  const ingest = db.transaction(() => {
    db.query(
      `INSERT INTO instances (
         instance_id, instance_name, first_seen_at, first_seen_day, last_seen_at, report_count,
         version, environment, deploy_mode, country,
         tenants, users, posts_total, posts_last_24h, bots_enabled, last_payload
       ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(instance_id) DO UPDATE SET
         instance_name = excluded.instance_name,
         last_seen_at = excluded.last_seen_at,
         report_count = instances.report_count + 1,
         version = excluded.version,
         environment = excluded.environment,
         deploy_mode = excluded.deploy_mode,
         country = COALESCE(excluded.country, instances.country),
         tenants = excluded.tenants,
         users = excluded.users,
         posts_total = excluded.posts_total,
         posts_last_24h = excluded.posts_last_24h,
         bots_enabled = excluded.bots_enabled,
         last_payload = excluded.last_payload`,
    ).run(
      report.instanceId,
      report.instanceName ?? null,
      receivedAt,
      day,
      receivedAt,
      report.version,
      report.environment,
      report.deployMode,
      meta.country,
      report.counts.tenants,
      report.counts.users,
      report.counts.postsTotal,
      report.counts.postsLast24h,
      report.counts.botsEnabled,
      JSON.stringify(report),
    );

    db.query(
      `INSERT INTO reports (
         instance_id, received_at, day, environment, version, deploy_mode,
         tenants, users, posts_total, posts_last_24h, bots_enabled
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      report.instanceId,
      receivedAt,
      day,
      report.environment,
      report.version,
      report.deployMode,
      report.counts.tenants,
      report.counts.users,
      report.counts.postsTotal,
      report.counts.postsLast24h,
      report.counts.botsEnabled,
    );
  });
  ingest();
}

// Raw heartbeat retention. Instance snapshot rows are never pruned — "instances
// ever seen" should stay correct indefinitely.
export function pruneOldReports(db: Database, retentionDays: number, now: Date): number {
  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  const result = db.query(`DELETE FROM reports WHERE received_at < ?`).run(cutoff);
  return result.changes;
}
