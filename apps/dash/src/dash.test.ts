import { afterEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import type { TelemetryReport } from "@campux/telemetry";
import { formatDay, ingestReport, lastDays, openDashDatabase, pruneOldReports } from "./db";
import { computeStats } from "./stats";
import { createDashServer } from "./server";

const NOW = new Date("2026-06-10T15:00:00+08:00");
const DAY_MS = 24 * 60 * 60 * 1000;

type ReportOverrides = Omit<Partial<TelemetryReport>, "counts"> & { counts?: Partial<TelemetryReport["counts"]> };

function report(overrides: ReportOverrides = {}): TelemetryReport {
  const { counts, ...rest } = overrides;
  return {
    schemaVersion: 1,
    instanceId: "11111111-1111-4111-8111-111111111111",
    reportedAt: NOW.toISOString(),
    version: "main-ab12cd3",
    environment: "production",
    deployMode: "single",
    setupCompleted: true,
    uptimeSeconds: 3600,
    runtime: { bunVersion: "1.3.12", platform: "linux", arch: "x64", inDocker: true },
    counts: {
      tenants: 1,
      users: 100,
      postsTotal: 1000,
      postsLast24h: 10,
      memberships: 100,
      botsEnabled: 1,
      publishTargets: 1,
      ...counts,
    },
    features: { emailConfigured: false, aiTenants: 0 },
    ...rest,
  };
}

const openDbs: Database[] = [];
function freshDb(): Database {
  const db = openDashDatabase(":memory:");
  openDbs.push(db);
  return db;
}
afterEach(() => {
  while (openDbs.length > 0) {
    openDbs.pop()!.close();
  }
});

describe("ingestReport", () => {
  test("first report creates the instance snapshot and a heartbeat row", () => {
    const db = freshDb();
    ingestReport(db, report(), { receivedAt: NOW, country: "CN" });
    const instance = db.query("SELECT * FROM instances").get() as Record<string, unknown>;
    expect(instance.instance_id).toBe("11111111-1111-4111-8111-111111111111");
    expect(instance.report_count).toBe(1);
    expect(instance.country).toBe("CN");
    expect(instance.first_seen_day).toBe(formatDay(NOW));
    expect((db.query("SELECT COUNT(*) AS c FROM reports").get() as { c: number }).c).toBe(1);
  });

  test("repeat reports update the snapshot in place and keep first_seen", () => {
    const db = freshDb();
    ingestReport(db, report({ counts: { postsTotal: 1000 } }), { receivedAt: new Date(NOW.getTime() - DAY_MS), country: "CN" });
    ingestReport(db, report({ version: "main-ff99001", counts: { postsTotal: 1040 } }), { receivedAt: NOW, country: null });
    const instance = db.query("SELECT * FROM instances").get() as Record<string, unknown>;
    expect((db.query("SELECT COUNT(*) AS c FROM instances").get() as { c: number }).c).toBe(1);
    expect(instance.report_count).toBe(2);
    expect(instance.version).toBe("main-ff99001");
    expect(instance.posts_total).toBe(1040);
    expect(instance.first_seen_at).toBe(NOW.getTime() - DAY_MS);
    // country survives a report that arrived without CDN geo headers
    expect(instance.country).toBe("CN");
  });

  test("pruneOldReports trims heartbeats but keeps instance snapshots", () => {
    const db = freshDb();
    ingestReport(db, report(), { receivedAt: new Date(NOW.getTime() - 500 * DAY_MS), country: null });
    ingestReport(db, report(), { receivedAt: NOW, country: null });
    expect(pruneOldReports(db, 400, NOW)).toBe(1);
    expect((db.query("SELECT COUNT(*) AS c FROM reports").get() as { c: number }).c).toBe(1);
    expect((db.query("SELECT COUNT(*) AS c FROM instances").get() as { c: number }).c).toBe(1);
  });
});

describe("computeStats", () => {
  test("activity windows, fleet sums and distributions", () => {
    const db = freshDb();
    const otherId = "22222222-2222-4222-8222-222222222222";
    const staleId = "33333333-3333-4333-8333-333333333333";
    ingestReport(db, report(), { receivedAt: NOW, country: "CN" });
    ingestReport(db, report({ instanceId: otherId, deployMode: "multi", version: "v2.1.0", counts: { users: 50, postsTotal: 200 } }), {
      receivedAt: new Date(NOW.getTime() - 3 * DAY_MS),
      country: null,
    });
    ingestReport(db, report({ instanceId: staleId }), { receivedAt: new Date(NOW.getTime() - 60 * DAY_MS), country: null });

    const stats = computeStats(db, "production", NOW);
    expect(stats.totals.instancesEver).toBe(3);
    expect(stats.totals.active24h).toBe(1);
    expect(stats.totals.active7d).toBe(2);
    expect(stats.totals.active30d).toBe(2);
    expect(stats.fleet.users).toBe(150);
    expect(stats.fleet.postsTotal).toBe(1200);
    expect(stats.versionDistribution).toEqual([
      { key: "main-ab12cd3", count: 1 },
      { key: "v2.1.0", count: 1 },
    ]);
    expect(stats.deployModeDistribution.map((d) => d.key).sort()).toEqual(["multi", "single"]);
    expect(stats.instances).toHaveLength(2);
    expect(stats.instances[0]!.idShort).toBe("11111111");
    expect(stats.instances[0]!.idShort.length).toBe(8);
    expect(stats.instances[0]!.online).toBe(true);
    expect(stats.instances[1]!.online).toBe(false);
  });

  test("non-production instances are excluded from the default scope but counted separately", () => {
    const db = freshDb();
    ingestReport(db, report(), { receivedAt: NOW, country: null });
    ingestReport(db, report({ instanceId: "44444444-4444-4444-8444-444444444444", environment: "development" }), {
      receivedAt: NOW,
      country: null,
    });
    const production = computeStats(db, "production", NOW);
    expect(production.totals.instancesEver).toBe(1);
    expect(production.totals.nonProductionActive7d).toBe(1);
    expect(computeStats(db, "all", NOW).totals.instancesEver).toBe(2);
  });

  test("daily new posts come from per-instance counter deltas", () => {
    const db = freshDb();
    const a = "11111111-1111-4111-8111-111111111111";
    const b = "22222222-2222-4222-8222-222222222222";
    const at = (daysAgo: number, hour = 9) => new Date(NOW.getTime() - daysAgo * DAY_MS + hour * 60 * 60 * 1000 - 9 * 60 * 60 * 1000);

    // instance a: baseline 2 days ago (1000), +40 yesterday, +10 more later the
    // same day (same-day max wins), +5 today
    ingestReport(db, report({ instanceId: a, counts: { postsTotal: 1000 } }), { receivedAt: at(2), country: null });
    ingestReport(db, report({ instanceId: a, counts: { postsTotal: 1040 } }), { receivedAt: at(1, 6), country: null });
    ingestReport(db, report({ instanceId: a, counts: { postsTotal: 1050 } }), { receivedAt: at(1, 18), country: null });
    ingestReport(db, report({ instanceId: a, counts: { postsTotal: 1055 } }), { receivedAt: at(0), country: null });
    // instance b: counter reset yesterday (database restore) must clamp to 0, then +3 today
    ingestReport(db, report({ instanceId: b, counts: { postsTotal: 500 } }), { receivedAt: at(2), country: null });
    ingestReport(db, report({ instanceId: b, counts: { postsTotal: 80 } }), { receivedAt: at(1, 12), country: null });
    ingestReport(db, report({ instanceId: b, counts: { postsTotal: 83 } }), { receivedAt: at(0), country: null });

    const stats = computeStats(db, "production", NOW);
    const byDay = new Map(stats.dailyNewPosts.map((p) => [p.day, p.count]));
    expect(byDay.get(formatDay(at(1)))).toBe(50); // 40 + 10, reset clamped to 0
    expect(byDay.get(formatDay(at(0)))).toBe(8); // 5 + 3
    expect(byDay.get(formatDay(at(2)))).toBe(0); // baselines contribute nothing
  });

  test("charts are zero-filled across the full window", () => {
    const db = freshDb();
    const stats = computeStats(db, "production", NOW);
    expect(stats.dailyActiveInstances).toHaveLength(30);
    expect(stats.dailyActiveInstances.every((p) => p.count === 0)).toBe(true);
    expect(stats.dailyActiveInstances[29]!.day).toBe(formatDay(NOW));
    expect(lastDays(NOW, 30)[0]).toBe(stats.dailyActiveInstances[0]!.day);
  });
});

describe("collector HTTP API", () => {
  test("accepts a valid report and rejects malformed ones", async () => {
    const db = freshDb();
    const app = createDashServer({ db, now: () => NOW });
    const ok = await app.inject({ method: "POST", url: "/api/v1/report", payload: report() });
    expect(ok.statusCode).toBe(200);
    expect(JSON.parse(ok.body)).toEqual({ ok: true });

    const bad = await app.inject({ method: "POST", url: "/api/v1/report", payload: { hello: "world" } });
    expect(bad.statusCode).toBe(400);

    const oversized = await app.inject({
      method: "POST",
      url: "/api/v1/report",
      payload: report({ counts: { postsTotal: 10_000_000_000 } }),
    });
    expect(oversized.statusCode).toBe(400);
    await app.close();
  });

  test("ignores reports arriving faster than the per-instance spacing", async () => {
    const db = freshDb();
    const app = createDashServer({ db, now: () => NOW });
    await app.inject({ method: "POST", url: "/api/v1/report", payload: report() });
    const second = await app.inject({ method: "POST", url: "/api/v1/report", payload: report() });
    expect(JSON.parse(second.body)).toEqual({ ok: true, skipped: "too_frequent" });
    expect((db.query("SELECT COUNT(*) AS c FROM reports").get() as { c: number }).c).toBe(1);
    await app.close();
  });

  test("stores the CDN country header when present", async () => {
    const db = freshDb();
    const app = createDashServer({ db, now: () => NOW });
    await app.inject({ method: "POST", url: "/api/v1/report", payload: report(), headers: { "cf-ipcountry": "cn" } });
    expect((db.query("SELECT country FROM instances").get() as { country: string }).country).toBe("CN");
    await app.close();
  });

  test("stats endpoint enforces the access key when configured", async () => {
    const db = freshDb();
    const app = createDashServer({ db, accessKey: "sekrit", now: () => NOW });
    expect((await app.inject({ method: "GET", url: "/api/v1/stats" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/v1/stats", headers: { authorization: "Bearer nope" } })).statusCode).toBe(401);
    const authed = await app.inject({ method: "GET", url: "/api/v1/stats", headers: { authorization: "Bearer sekrit" } });
    expect(authed.statusCode).toBe(200);
    expect((JSON.parse(authed.body) as { scope: string }).scope).toBe("production");
    // reporting must keep working without any key
    expect((await app.inject({ method: "POST", url: "/api/v1/report", payload: report() })).statusCode).toBe(200);
    await app.close();
  });

  test("serves the dashboard shell at /", async () => {
    const db = freshDb();
    const app = createDashServer({ db, now: () => NOW });
    const page = await app.inject({ method: "GET", url: "/" });
    expect(page.statusCode).toBe(200);
    expect(page.headers["content-type"]).toContain("text/html");
    expect(page.body).toContain("Campux 遥测");
    await app.close();
  });
});
