import { readFileSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import Fastify, { type FastifyRequest } from "fastify";
import type { Database } from "bun:sqlite";
import { parseTelemetryReport } from "@campux/telemetry";
import { ingestReport, resolveInstanceId, setInstanceTag } from "./db";
import { computeStats, type StatsEnvScope } from "./stats";

// Ingestion abuse guards. The endpoint is anonymous and open by design, so the
// budget is generous for real instances (one report per ~6 h) and tight enough
// that a spammer cannot bloat the database quickly.
const MIN_REPORT_SPACING_MS = 60 * 1000; // per instance id
const IP_WINDOW_MS = 60 * 60 * 1000;
const IP_WINDOW_MAX_REPORTS = 120; // per IP per hour
const LIMITER_SWEEP_INTERVAL_MS = 10 * 60 * 1000;

export type DashServerOptions = {
  db: Database;
  accessKey?: string | undefined;
  adminKey?: string | undefined;
  logger?: boolean | object;
  now?: () => Date;
};

type IpWindow = { windowStart: number; count: number };

export function createDashServer({ db, accessKey, adminKey, logger = false, now = () => new Date() }: DashServerOptions) {
  const app = Fastify({
    logger,
    bodyLimit: 64 * 1024,
    // dash.campux.top terminates TLS at a reverse proxy / CDN; trust it for
    // request.ip so the per-IP limiter sees real client addresses.
    trustProxy: true,
  });

  const lastAcceptedByInstance = new Map<string, number>();
  const reportsByIp = new Map<string, IpWindow>();

  const limiterSweep = setInterval(() => {
    const cutoff = now().getTime() - IP_WINDOW_MS;
    for (const [instanceId, acceptedAt] of lastAcceptedByInstance) {
      if (acceptedAt < cutoff) {
        lastAcceptedByInstance.delete(instanceId);
      }
    }
    for (const [ip, window] of reportsByIp) {
      if (window.windowStart < cutoff) {
        reportsByIp.delete(ip);
      }
    }
  }, LIMITER_SWEEP_INTERVAL_MS);
  app.addHook("onClose", async () => clearInterval(limiterSweep));

  function ipAllowed(ip: string, nowMs: number): boolean {
    const window = reportsByIp.get(ip);
    if (!window || nowMs - window.windowStart >= IP_WINDOW_MS) {
      reportsByIp.set(ip, { windowStart: nowMs, count: 1 });
      return true;
    }
    window.count += 1;
    return window.count <= IP_WINDOW_MAX_REPORTS;
  }

  app.post("/api/v1/report", async (request, reply) => {
    const receivedAt = now();
    if (!ipAllowed(request.ip, receivedAt.getTime())) {
      return reply.code(429).send({ ok: false, error: "rate limited" });
    }

    const parsed = parseTelemetryReport(request.body);
    if (!parsed.ok) {
      return reply.code(400).send({ ok: false, error: parsed.error });
    }

    const lastAccepted = lastAcceptedByInstance.get(parsed.report.instanceId);
    if (lastAccepted !== undefined && receivedAt.getTime() - lastAccepted < MIN_REPORT_SPACING_MS) {
      return reply.send({ ok: true, skipped: "too_frequent" });
    }
    lastAcceptedByInstance.set(parsed.report.instanceId, receivedAt.getTime());

    ingestReport(db, parsed.report, {
      receivedAt,
      country: parseCountry(request.headers["cf-ipcountry"]),
    });
    return reply.send({ ok: true });
  });

  app.get("/api/v1/stats", async (request, reply) => {
    if (!authorized(request, accessKey)) {
      return reply.code(401).send({ ok: false, error: "access key required" });
    }
    const scope: StatsEnvScope = (request.query as { env?: string }).env === "all" ? "all" : "production";
    return reply.send(computeStats(db, scope, now()));
  });

  // Operator instance tagging. Gated by CAMPUX_DASH_ADMIN_KEY; when that env is
  // unset the routes 404 so a public dashboard exposes no write surface at all.
  // The :id path segment is the 8-char short id shown on the dashboard (a full
  // id also works); the full UUID is never required and never echoed back.
  app.put<{ Params: { id: string }; Body: unknown }>("/api/v1/instances/:id/tag", async (request, reply) => {
    if (!adminKey) {
      return reply.code(404).send({ ok: false, error: "not found" });
    }
    if (!adminAuthorized(request, adminKey)) {
      return reply.code(401).send({ ok: false, error: "admin key required" });
    }
    const resolved = resolveInstanceId(db, request.params.id);
    if (!resolved.ok) {
      const code = resolved.reason === "ambiguous" ? 409 : 404;
      return reply.code(code).send({ ok: false, error: resolved.reason });
    }
    const body = (request.body ?? {}) as { label?: unknown; note?: unknown };
    if (
      (body.label !== undefined && body.label !== null && typeof body.label !== "string") ||
      (body.note !== undefined && body.note !== null && typeof body.note !== "string")
    ) {
      return reply.code(400).send({ ok: false, error: "label and note must be strings" });
    }
    const tag = setInstanceTag(
      db,
      resolved.instanceId,
      { label: (body.label as string | null | undefined) ?? undefined, note: (body.note as string | null | undefined) ?? undefined },
      now(),
    );
    return reply.send({ ok: true, tag });
  });

  app.delete<{ Params: { id: string } }>("/api/v1/instances/:id/tag", async (request, reply) => {
    if (!adminKey) {
      return reply.code(404).send({ ok: false, error: "not found" });
    }
    if (!adminAuthorized(request, adminKey)) {
      return reply.code(401).send({ ok: false, error: "admin key required" });
    }
    const resolved = resolveInstanceId(db, request.params.id);
    if (!resolved.ok) {
      const code = resolved.reason === "ambiguous" ? 409 : 404;
      return reply.code(code).send({ ok: false, error: resolved.reason });
    }
    setInstanceTag(db, resolved.instanceId, { label: null, note: null }, now());
    return reply.send({ ok: true, tag: null });
  });

  app.get("/api/health", async () => ({ ok: true, service: "campux-dash" }));

  // The dashboard shell is always served; with an access key configured it
  // renders a key prompt until /api/v1/stats accepts the key.
  const dashboardHtml = readFileSync(new URL("./dashboard.html", import.meta.url), "utf8");
  app.get("/", async (_request, reply) => reply.header("content-type", "text/html; charset=utf-8").send(dashboardHtml));

  return app;
}

function parseCountry(header: string | string[] | undefined): string | null {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) {
    return null;
  }
  const country = value.toUpperCase();
  // "XX" (unknown) and "T1" (Tor) are Cloudflare pseudo-countries; drop them.
  return /^[A-Z]{2}$/.test(country) && country !== "XX" && country !== "T1" ? country : null;
}

function authorized(request: FastifyRequest, accessKey: string | undefined): boolean {
  if (!accessKey) {
    return true;
  }
  const header = request.headers.authorization;
  const bearer = typeof header === "string" && header.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
  const provided = bearer ?? (request.query as { key?: string }).key ?? "";
  const a = Buffer.from(provided);
  const b = Buffer.from(accessKey);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Admin (write) auth is deliberately stricter than read auth: there is no
// "unset = open" fallback (callers already 404 when adminKey is unset), and the
// key is taken only from the X-Admin-Key header or Authorization: Bearer — never
// a query string, so it does not end up in proxy/CDN access logs.
function adminAuthorized(request: FastifyRequest, adminKey: string): boolean {
  const headerKey = request.headers["x-admin-key"];
  const fromHeader = Array.isArray(headerKey) ? headerKey[0] : headerKey;
  const auth = request.headers.authorization;
  const bearer = typeof auth === "string" && auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : null;
  const provided = fromHeader ?? bearer ?? "";
  const a = Buffer.from(provided);
  const b = Buffer.from(adminKey);
  return a.length === b.length && timingSafeEqual(a, b);
}
