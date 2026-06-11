import type { Database } from "bun:sqlite";
import { formatDay, lastDays, loadInstanceTags } from "./db";

const DAY_MS = 24 * 60 * 60 * 1000;
const CHART_DAYS = 30;
// An instance heartbeats every ~2 h; two missed beats + jitter ≈ offline.
const ONLINE_WINDOW_MS = 5 * 60 * 60 * 1000;

export type StatsEnvScope = "production" | "all";

// ISO 3166-2:CN subdivision code (the part after "CN-") -> Chinese province
// name. Cloudflare's CF-Region-Code gives these for mainland visitors. Campux
// is a China-only product, so a province-level breakdown is the useful geo cut.
const CN_PROVINCES: Record<string, string> = {
  BJ: "北京", TJ: "天津", HE: "河北", SX: "山西", NM: "内蒙古",
  LN: "辽宁", JL: "吉林", HL: "黑龙江", SH: "上海", JS: "江苏",
  ZJ: "浙江", AH: "安徽", FJ: "福建", JX: "江西", SD: "山东",
  HA: "河南", HB: "湖北", HN: "湖南", GD: "广东", GX: "广西",
  HI: "海南", CQ: "重庆", SC: "四川", GZ: "贵州", YN: "云南",
  XZ: "西藏", SN: "陕西", GS: "甘肃", QH: "青海", NX: "宁夏",
  XJ: "新疆", TW: "台湾", HK: "香港", MO: "澳门",
};

// Cloudflare sometimes emits numeric region codes for CN (e.g. "11" = 北京).
const CN_NUMERIC: Record<string, string> = {
  "11": "北京", "12": "天津", "13": "河北", "14": "山西", "15": "内蒙古",
  "21": "辽宁", "22": "吉林", "23": "黑龙江", "31": "上海", "32": "江苏",
  "33": "浙江", "34": "安徽", "35": "福建", "36": "江西", "37": "山东",
  "41": "河南", "42": "湖北", "43": "湖南", "44": "广东", "45": "广西",
  "46": "海南", "50": "重庆", "51": "四川", "52": "贵州", "53": "云南",
  "54": "西藏", "61": "陕西", "62": "甘肃", "63": "青海", "64": "宁夏",
  "65": "新疆", "71": "台湾", "81": "香港", "82": "澳门",
};

export function regionLabel(country: string | null, region: string | null): string {
  if (!region) return "未知";
  if (country === "CN" || /^[0-9]/.test(region)) {
    return CN_PROVINCES[region] ?? CN_NUMERIC[region] ?? (country ? `${country}-${region}` : region);
  }
  return country ? `${country}-${region}` : region;
}

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

  // Province distribution: group geo-tagged instances by Chinese province
  // (mapped from country+region in code). Instances without a region code are
  // counted under "未知".
  const regionRows = db
    .query(
      `SELECT country, region, COUNT(*) AS count FROM instances
       WHERE last_seen_at >= ? ${envClause}
       GROUP BY country, region`,
    )
    .all(since(30 * DAY_MS)) as { country: string | null; region: string | null; count: number }[];
  const regionAgg = new Map<string, number>();
  for (const row of regionRows) {
    // only count rows that actually carry a region; instances with no geo data
    // are excluded rather than dumped into a giant "未知" bucket that dwarfs all.
    if (!row.region) continue;
    const label = regionLabel(row.country, row.region);
    regionAgg.set(label, (regionAgg.get(label) ?? 0) + row.count);
  }
  const regionDistribution = [...regionAgg.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, 12);

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
      province: row.region ? regionLabel(row.country, row.region) : null,
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
 * users): take the last value an instance reported per day, then sum positive
 * day-over-day deltas across instances. An instance's first observed day
 * contributes nothing (no baseline), a counter reset (restore, wipe) clamps to
 * zero instead of going negative, and a multi-day gap attributes the whole
 * catch-up to the day the instance reappears.
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
      `SELECT instance_id, day, MAX(${column}) AS metric FROM reports
       WHERE day >= ? ${envClause}
       GROUP BY instance_id, day
       ORDER BY instance_id ASC, day ASC`,
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
