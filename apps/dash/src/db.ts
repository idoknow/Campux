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
  region         TEXT,
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

-- Operator-assigned annotations, kept in a SEPARATE table on purpose: the
-- ingest upsert rewrites the whole instances row on every heartbeat, so a tag
-- stored there would be clobbered. These are written only by an authenticated
-- operator (CAMPUX_DASH_ADMIN_KEY), never by the anonymous report endpoint.
CREATE TABLE IF NOT EXISTS instance_tags (
  instance_id TEXT PRIMARY KEY,
  label       TEXT,
  note        TEXT,
  updated_at  INTEGER NOT NULL
);
`;

export function openDashDatabase(path: string): Database {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec(schema);
  // Lightweight forward migrations for existing databases (CREATE TABLE IF NOT
  // EXISTS won't add a new column). Each ALTER is wrapped because SQLite has no
  // "ADD COLUMN IF NOT EXISTS"; a duplicate-column error just means it's done.
  for (const alter of ["ALTER TABLE instances ADD COLUMN region TEXT"]) {
    try {
      db.exec(alter);
    } catch {
      /* column already exists */
    }
  }
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
  // Resolved mainland-China province name (e.g. "广东省"), derived at ingest from
  // the reporting IP via offline ip2region lookup. null for overseas / private /
  // unlocatable IPs. Optional: older callers / tests may omit it.
  region?: string | null;
};

export function ingestReport(db: Database, report: TelemetryReport, meta: IngestMeta): void {
  const receivedAt = meta.receivedAt.getTime();
  const day = formatDay(meta.receivedAt);
  const ingest = db.transaction(() => {
    db.query(
      `INSERT INTO instances (
         instance_id, instance_name, first_seen_at, first_seen_day, last_seen_at, report_count,
         version, environment, deploy_mode, country, region,
         tenants, users, posts_total, posts_last_24h, bots_enabled, last_payload
       ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(instance_id) DO UPDATE SET
         instance_name = excluded.instance_name,
         last_seen_at = excluded.last_seen_at,
         report_count = instances.report_count + 1,
         version = excluded.version,
         environment = excluded.environment,
         deploy_mode = excluded.deploy_mode,
         country = COALESCE(excluded.country, instances.country),
         region = COALESCE(excluded.region, instances.region),
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
      meta.region ?? null,
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

export type InstanceTag = {
  label: string | null;
  note: string | null;
  updatedAt: number;
};

// Operators address instances by the 8-char short id shown on the dashboard;
// the full UUID is the ingest credential and never leaves the collector. Map a
// short id (or a full id) back to the canonical instance_id, refusing to act
// when a prefix is ambiguous or unknown.
export type ResolveResult =
  | { ok: true; instanceId: string }
  | { ok: false; reason: "not_found" | "ambiguous" };

export function resolveInstanceId(db: Database, idOrShort: string): ResolveResult {
  const needle = idOrShort.trim().toLowerCase();
  if (!needle) {
    return { ok: false, reason: "not_found" };
  }
  // Exact match first — an operator pasting a full id should always win.
  const exact = db.query(`SELECT instance_id FROM instances WHERE instance_id = ?`).get(needle) as
    | { instance_id: string }
    | undefined;
  if (exact) {
    return { ok: true, instanceId: exact.instance_id };
  }
  const matches = db
    .query(`SELECT instance_id FROM instances WHERE instance_id LIKE ? LIMIT 2`)
    .all(needle + "%") as { instance_id: string }[];
  if (matches.length === 0) {
    return { ok: false, reason: "not_found" };
  }
  if (matches.length > 1) {
    return { ok: false, reason: "ambiguous" };
  }
  return { ok: true, instanceId: matches[0]!.instance_id };
}

// Upsert an operator tag. Empty label and empty note together delete the row so
// "clear both fields" leaves no dangling record. Returns the stored tag, or null
// when it was cleared.
export function setInstanceTag(
  db: Database,
  instanceId: string,
  input: { label?: string | null | undefined; note?: string | null | undefined },
  now: Date,
): InstanceTag | null {
  const norm = (v: string | null | undefined): string | null => {
    if (v === undefined || v === null) {
      return null;
    }
    const trimmed = v.trim().slice(0, 80);
    return trimmed.length > 0 ? trimmed : null;
  };
  const label = norm(input.label);
  const note = input.note === undefined || input.note === null ? null : input.note.trim().slice(0, 280) || null;

  if (label === null && note === null) {
    db.query(`DELETE FROM instance_tags WHERE instance_id = ?`).run(instanceId);
    return null;
  }

  db.query(
    `INSERT INTO instance_tags (instance_id, label, note, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(instance_id) DO UPDATE SET
       label = excluded.label,
       note = excluded.note,
       updated_at = excluded.updated_at`,
  ).run(instanceId, label, note, now.getTime());
  return { label, note, updatedAt: now.getTime() };
}

export function getInstanceTag(db: Database, instanceId: string): InstanceTag | null {
  const row = db.query(`SELECT label, note, updated_at FROM instance_tags WHERE instance_id = ?`).get(instanceId) as
    | { label: string | null; note: string | null; updated_at: number }
    | undefined;
  return row ? { label: row.label, note: row.note, updatedAt: row.updated_at } : null;
}

// All tags as a map keyed by full instance_id, for joining onto the stats view
// without an N+1 per-instance lookup.
export function loadInstanceTags(db: Database): Map<string, InstanceTag> {
  const rows = db.query(`SELECT instance_id, label, note, updated_at FROM instance_tags`).all() as {
    instance_id: string;
    label: string | null;
    note: string | null;
    updated_at: number;
  }[];
  return new Map(rows.map((r) => [r.instance_id, { label: r.label, note: r.note, updatedAt: r.updated_at }]));
}
