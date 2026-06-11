import type { Database } from "bun:sqlite";
import { formatDay, lastDays, loadInstanceTags } from "./db";

const DAY_MS = 24 * 60 * 60 * 1000;
const CHART_DAYS = 30;
// An instance heartbeats every ~2 h; two missed beats + jitter ≈ offline.
const ONLINE_WINDOW_MS = 5 * 60 * 60 * 1000;

export type StatsEnvScope = "production" | "all";

// Province distribution and the per-instance province come straight from the
// `region` column, which the collector now fills with a resolved mainland-China
// province name (e.g. "广东省") via offline ip2region IP lookup at ingest time.
// No ISO-code mapping layer is needed any more.
export type DayPoint = { day: string; count: number };
export type DistributionEntry = { key: string; count: number };

export type InstanceSummary = {
  // Truncated on purpose: ingestion is authenticated by nothing but the random
  // instance UUID, so the full id must never leave the collector.
  idShort: string;
  name: string | null;
  // Operator-assigned annotations (separate from the self-reported `name`).
  label: string | null;
  note: string | null;
  version: string;
  deployMode: string;
  environment: string;
  country: string | null;
  region: string | null;
  province: string | null;
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
  regionDistribution: DistributionEntry[];
  sizeDistribution: DistributionEntry[];
  dailyActiveInstances: DayPoint[];
  dailyNewInstances: DayPoint[];
  dailyNewPosts: DayPoint[];
  dailyNewUsers: DayPoint[];
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

  // Province distribution: the `region` column already holds a resolved
  // mainland-China province name (filled at ingest via offline IP lookup), so we
  // can group on it directly. Instances with no resolved province (overseas /
  // private / unlocatable IP) carry NULL and are excluded rather than dumped
  // into a giant "未知" bucket that would dwarf the real provinces.
  const regionDistribution = (
    db
      .query(
        `SELECT region AS key, COUNT(*) AS count FROM instances
         WHERE last_seen_at >= ? AND region IS NOT NULL ${envClause}
         GROUP BY region ORDER BY count DESC, key ASC LIMIT 12`,
      )
      .all(since(30 * DAY_MS)) as DistributionEntry[]
  ).map((row) => ({ key: String(row.key), count: row.count }));

  // Instance size buckets by user count — a fleet-shape view (how many small
  // vs large deployments). Buckets are derived in SQL with a CASE expression so
  // the ordering key stays stable.
  const sizeRows = db
    .query(
      `SELECT CASE
                WHEN users < 100 THEN '0'
                WHEN users < 1000 THEN '1'
                WHEN users < 5000 THEN '2'
                WHEN users < 20000 THEN '3'
                ELSE '4'
              END AS bucket, COUNT(*) AS count
       FROM instances WHERE last_seen_at >= ? ${envClause}
       GROUP BY bucket ORDER BY bucket ASC`,
    )
    .all(since(30 * DAY_MS)) as { bucket: string; count: number }[];
  const SIZE_LABELS: Record<string, string> = {
    "0": "<100 用户",
    "1": "100–1k",
    "2": "1k–5k",
    "3": "5k–20k",
    "4": "20k+",
  };
  const sizeDistribution = sizeRows.map((row) => ({ key: SIZE_LABELS[row.bucket] ?? row.bucket, count: row.count }));

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

  const dailyNewPosts = fillDays(computeDailyCounterDeltas(db, "posts_total", envClause, now, chartDays));
  const dailyNewUsers = fillDays(computeDailyCounterDeltas(db, "users", envClause, now, chartDays));

  const tags = loadInstanceTags(db);
  const instances = (
    db
      .query(
        `SELECT instance_id, instance_name, version, deploy_mode, environment, country, region,
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
      region: string | null;
      tenants: number;
      users: number;
      posts_total: number;
      bots_enabled: number;
      first_seen_at: number;
      last_seen_at: number;
    }[]
  ).map((row) => {
    const tag = tags.get(row.instance_id);
    return {
      idShort: row.instance_id.slice(0, 8),
      name: row.instance_name,
      label: tag?.label ?? null,
      note: tag?.note ?? null,
      version: row.version,
      deployMode: row.deploy_mode,
      environment: row.environment,
      country: row.country,
      region: row.region,
      // `region` already holds the resolved Chinese province name.
      province: row.region ?? null,
      tenants: row.tenants,
      users: row.users,
      postsTotal: row.posts_total,
      botsEnabled: row.bots_enabled,
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
      online: row.last_seen_at >= since(ONLINE_WINDOW_MS),
    };
  });

  return {
    generatedAt: now.toISOString(),
    scope,
    totals,
    fleet: fleetRow,
    versionDistribution: distribution("version"),
    deployModeDistribution: distribution("deploy_mode"),
    regionDistribution,
    sizeDistribution,
    dailyActiveInstances,
    dailyNewInstances,
    dailyNewPosts,
    dailyNewUsers,
    instances,
  };
}

/**
 * Fleet-wide increase of a monotonic per-instance counter per day (posts or
 * users): walk each instance's reports in chronological order and sum positive
 * deltas between consecutive reports, attributing each delta to the day of the
 * later report. This captures intraday growth (multiple reports land in a day)
 * and same-day growth on an instance's first observed day — only the very first
 * report of an instance is a pure baseline that contributes nothing. A counter
 * reset (restore, wipe) clamps to zero instead of going negative, and a
 * multi-day gap attributes the whole catch-up to the day the instance reappears.
 *
 * A previous version grouped by (instance, day) taking the daily MAX and then
 * diffed day-over-day. That dropped all intraday growth and, crucially, lost the
 * entire first observed day — so a brand-new instance's same-day signups never
 * showed up. Consecutive-report deltas fix both.
 */
export function computeDailyCounterDeltas(
  db: Database,
  column: "posts_total" | "users",
  envClause: string,
  now: Date,
  chartDays: string[],
): DayPoint[] {
  const lookbackStart = formatDay(new Date(now.getTime() - (chartDays.length + 7) * DAY_MS));
  const rows = db
    .query(
      `SELECT instance_id, day, ${column} AS metric FROM reports
       WHERE day >= ? ${envClause}
       ORDER BY instance_id ASC, received_at ASC, id ASC`,
    )
    .all(lookbackStart) as { instance_id: string; day: string; metric: number }[];

  const perDay = new Map<string, number>();
  let currentInstance: string | null = null;
  let previousTotal: number | null = null;
  for (const row of rows) {
    if (row.instance_id !== currentInstance) {
      currentInstance = row.instance_id;
      previousTotal = null;
    }
    if (previousTotal !== null) {
      const delta = Math.max(0, row.metric - previousTotal);
      if (delta > 0) {
        perDay.set(row.day, (perDay.get(row.day) ?? 0) + delta);
      }
    }
    previousTotal = row.metric;
  }

  return chartDays.map((day) => ({ day, count: perDay.get(day) ?? 0 }));
}
