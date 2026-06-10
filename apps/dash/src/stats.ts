import type { Database } from "bun:sqlite";
import { formatDay, lastDays } from "./db";

const DAY_MS = 24 * 60 * 60 * 1000;
const CHART_DAYS = 30;
// An instance heartbeats every ~6 h; two missed beats + jitter ≈ offline.
const ONLINE_WINDOW_MS = 13 * 60 * 60 * 1000;

export type StatsEnvScope = "production" | "all";

export type DayPoint = { day: string; count: number };
export type DistributionEntry = { key: string; count: number };

export type InstanceSummary = {
  // Truncated on purpose: ingestion is authenticated by nothing but the random
  // instance UUID, so the full id must never leave the collector.
  idShort: string;
  name: string | null;
  version: string;
  deployMode: string;
  environment: string;
  country: string | null;
  tenants: number;
  users: number;
  postsTotal: number;
  botsEnabled: number;
  firstSeenAt: number;
  lastSeenAt: number;
  online: boolean;
};

export type DashStats = {
  generatedAt: string;
  scope: StatsEnvScope;
  totals: {
    instancesEver: number;
    active24h: number;
    active7d: number;
    active30d: number;
    nonProductionActive7d: number;
  };
  fleet: {
    tenants: number;
    users: number;
    postsTotal: number;
    botsEnabled: number;
  };
  versionDistribution: DistributionEntry[];
  deployModeDistribution: DistributionEntry[];
  dailyActiveInstances: DayPoint[];
  dailyNewInstances: DayPoint[];
  dailyNewPosts: DayPoint[];
  instances: InstanceSummary[];
};

type CountRow = { c: number };

export function computeStats(db: Database, scope: StatsEnvScope, now: Date): DashStats {
  // Charts and fleet totals exclude dev/test instances unless explicitly asked
  // for everything — a developer running the pipeline locally must not move
  // production numbers.
  const envClause = scope === "production" ? "AND environment = 'production'" : "";
  const since = (ms: number) => now.getTime() - ms;

  const countInstances = (where: string, ...params: (string | number)[]) =>
    (db.query(`SELECT COUNT(*) AS c FROM instances WHERE 1=1 ${where}`).get(...params) as CountRow).c;

  const totals = {
    instancesEver: countInstances(envClause),
    active24h: countInstances(`${envClause} AND last_seen_at >= ?`, since(DAY_MS)),
    active7d: countInstances(`${envClause} AND last_seen_at >= ?`, since(7 * DAY_MS)),
    active30d: countInstances(`${envClause} AND last_seen_at >= ?`, since(30 * DAY_MS)),
    nonProductionActive7d: countInstances(`AND environment != 'production' AND last_seen_at >= ?`, since(7 * DAY_MS)),
  };

  const fleetRow = db
    .query(
      `SELECT COALESCE(SUM(tenants), 0) AS tenants, COALESCE(SUM(users), 0) AS users,
              COALESCE(SUM(posts_total), 0) AS postsTotal, COALESCE(SUM(bots_enabled), 0) AS botsEnabled
       FROM instances WHERE last_seen_at >= ? ${envClause}`,
    )
    .get(since(30 * DAY_MS)) as DashStats["fleet"];

  const distribution = (column: "version" | "deploy_mode"): DistributionEntry[] =>
    (
      db
        .query(
          `SELECT ${column} AS key, COUNT(*) AS count FROM instances
           WHERE last_seen_at >= ? ${envClause}
           GROUP BY ${column} ORDER BY count DESC, key ASC LIMIT 12`,
        )
        .all(since(30 * DAY_MS)) as DistributionEntry[]
    ).map((row) => ({ key: String(row.key), count: row.count }));

  const chartDays = lastDays(now, CHART_DAYS);
  const firstChartDay = chartDays[0]!;

  const fillDays = (rows: { day: string; count: number }[]): DayPoint[] => {
    const byDay = new Map(rows.map((row) => [row.day, row.count]));
    return chartDays.map((day) => ({ day, count: byDay.get(day) ?? 0 }));
  };

  const dailyActiveInstances = fillDays(
    db
      .query(
        `SELECT day, COUNT(DISTINCT instance_id) AS count FROM reports
         WHERE day >= ? ${envClause} GROUP BY day`,
      )
      .all(firstChartDay) as { day: string; count: number }[],
  );

  const dailyNewInstances = fillDays(
    db
      .query(
        `SELECT first_seen_day AS day, COUNT(*) AS count FROM instances
         WHERE first_seen_day >= ? ${envClause} GROUP BY first_seen_day`,
      )
      .all(firstChartDay) as { day: string; count: number }[],
  );

  const dailyNewPosts = fillDays(computeDailyNewPosts(db, envClause, now, chartDays));

  const instances = (
    db
      .query(
        `SELECT instance_id, instance_name, version, deploy_mode, environment, country,
                tenants, users, posts_total, bots_enabled, first_seen_at, last_seen_at
         FROM instances WHERE last_seen_at >= ? ${envClause}
         ORDER BY last_seen_at DESC LIMIT 300`,
      )
      .all(since(30 * DAY_MS)) as {
      instance_id: string;
      instance_name: string | null;
      version: string;
      deploy_mode: string;
      environment: string;
      country: string | null;
      tenants: number;
      users: number;
      posts_total: number;
      bots_enabled: number;
      first_seen_at: number;
      last_seen_at: number;
    }[]
  ).map((row) => ({
    idShort: row.instance_id.slice(0, 8),
    name: row.instance_name,
    version: row.version,
    deployMode: row.deploy_mode,
    environment: row.environment,
    country: row.country,
    tenants: row.tenants,
    users: row.users,
    postsTotal: row.posts_total,
    botsEnabled: row.bots_enabled,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    online: row.last_seen_at >= since(ONLINE_WINDOW_MS),
  }));

  return {
    generatedAt: now.toISOString(),
    scope,
    totals,
    fleet: fleetRow,
    versionDistribution: distribution("version"),
    deployModeDistribution: distribution("deploy_mode"),
    dailyActiveInstances,
    dailyNewInstances,
    dailyNewPosts,
    instances,
  };
}

/**
 * Fleet-wide posts created per day, derived from each instance's monotonic
 * postsTotal counter: take the last value an instance reported per day, then
 * sum positive day-over-day deltas across instances. An instance's first
 * observed day contributes nothing (no baseline), a counter reset (restore,
 * wipe) clamps to zero instead of going negative, and a multi-day gap
 * attributes the whole catch-up to the day the instance reappears.
 */
export function computeDailyNewPosts(db: Database, envClause: string, now: Date, chartDays: string[]): DayPoint[] {
  const lookbackStart = formatDay(new Date(now.getTime() - (chartDays.length + 7) * DAY_MS));
  const rows = db
    .query(
      `SELECT instance_id, day, MAX(posts_total) AS posts_total FROM reports
       WHERE day >= ? ${envClause}
       GROUP BY instance_id, day
       ORDER BY instance_id ASC, day ASC`,
    )
    .all(lookbackStart) as { instance_id: string; day: string; posts_total: number }[];

  const perDay = new Map<string, number>();
  let currentInstance: string | null = null;
  let previousTotal: number | null = null;
  for (const row of rows) {
    if (row.instance_id !== currentInstance) {
      currentInstance = row.instance_id;
      previousTotal = null;
    }
    if (previousTotal !== null) {
      const delta = Math.max(0, row.posts_total - previousTotal);
      if (delta > 0) {
        perDay.set(row.day, (perDay.get(row.day) ?? 0) + delta);
      }
    }
    previousTotal = row.posts_total;
  }

  return chartDays.map((day) => ({ day, count: perDay.get(day) ?? 0 }));
}
