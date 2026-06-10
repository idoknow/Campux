import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import type { FastifyBaseLogger } from "fastify";
import type { CampuxConfig } from "@campux/config";
import { TELEMETRY_SCHEMA_VERSION, type TelemetryReport } from "@campux/telemetry";
import { prisma } from "../lib/prisma";
import { getDeployMode, isSetupCompleted } from "../lib/deploy-mode";

export const TELEMETRY_INSTANCE_ID_KEY = "telemetry_instance_id";

const reportIntervalMs = 2 * 60 * 60 * 1000; // heartbeat; central "active in 24h" tolerates several missed beats
const intervalJitterMs = 30 * 60 * 1000; // ±15 min so the fleet does not stampede the collector
const initialDelayMs = 2 * 60 * 1000; // let migrations/queue/bots settle before the boot report
const failureRetryDelayMs = 30 * 60 * 1000;
const sendTimeoutMs = 15_000;

export type TelemetryGate = {
  disabled: boolean;
  endpoint: string;
  endpointExplicit: boolean;
  nodeEnv: "development" | "test" | "production";
};

/**
 * Decide whether and where to report. Returns the full report URL, or null
 * when reporting must stay off:
 * - operator opted out via CAMPUX_TELEMETRY_DISABLED
 * - test runs, always
 * - dev instances, unless an endpoint was set explicitly (so local pipelines
 *   can be exercised against a local collector without polluting fleet stats)
 * - endpoint that is not a valid http(s) URL
 */
export function resolveTelemetryTarget(gate: TelemetryGate): string | null {
  if (gate.disabled || gate.nodeEnv === "test") {
    return null;
  }
  if (gate.nodeEnv !== "production" && !gate.endpointExplicit) {
    return null;
  }
  let base: URL;
  try {
    base = new URL(gate.endpoint);
  } catch {
    return null;
  }
  if (base.protocol !== "https:" && base.protocol !== "http:") {
    return null;
  }
  const path = base.pathname.replace(/\/+$/, "");
  return `${base.origin}${path}/api/v1/report`;
}

// The stable anonymous identity of this installation: a random UUID minted on
// first report and persisted in the SystemSetting KV store. Carries no
// information about the deployment; deleting the row simply mints a new one.
export async function getOrCreateTelemetryInstanceId(): Promise<string> {
  const existing = await prisma.systemSetting.findUnique({ where: { key: TELEMETRY_INSTANCE_ID_KEY } });
  if (typeof existing?.value === "string" && existing.value.length > 0) {
    return existing.value;
  }
  const instanceId = randomUUID();
  await prisma.systemSetting.upsert({
    where: { key: TELEMETRY_INSTANCE_ID_KEY },
    create: { key: TELEMETRY_INSTANCE_ID_KEY, value: instanceId },
    update: { value: instanceId },
  });
  return instanceId;
}

export type TelemetrySnapshot = {
  instanceId: string;
  instanceName: string | undefined;
  version: string;
  environment: "development" | "test" | "production";
  deployMode: "single" | "multi";
  setupCompleted: boolean;
  uptimeSeconds: number;
  emailConfigured: boolean;
  counts: TelemetryReport["counts"];
  aiTenants: number;
};

// Pure assembly so the payload shape is unit-testable without a database.
export function buildTelemetryReport(snapshot: TelemetrySnapshot, now: Date): TelemetryReport {
  const instanceName = snapshot.instanceName?.trim().slice(0, 64);
  return {
    schemaVersion: TELEMETRY_SCHEMA_VERSION,
    instanceId: snapshot.instanceId,
    ...(instanceName ? { instanceName } : {}),
    reportedAt: now.toISOString(),
    version: snapshot.version.slice(0, 64) || "dev",
    environment: snapshot.environment,
    deployMode: snapshot.deployMode,
    setupCompleted: snapshot.setupCompleted,
    uptimeSeconds: Math.max(0, Math.floor(snapshot.uptimeSeconds)),
    runtime: {
      bunVersion: typeof Bun !== "undefined" ? Bun.version : process.versions.node,
      platform: process.platform,
      arch: process.arch,
      inDocker: existsSync("/.dockerenv"),
    },
    counts: snapshot.counts,
    features: {
      emailConfigured: snapshot.emailConfigured,
      aiTenants: snapshot.aiTenants,
    },
  };
}

// Aggregate counters only — by design nothing row-level (no names, slugs, QQ
// numbers, hosts, or content) is ever read into the report.
export async function collectTelemetryReport(config: CampuxConfig): Promise<TelemetryReport> {
  const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [instanceId, deployMode, setupCompleted, tenants, users, memberships, postsTotal, postsLast24h, botsEnabled, publishTargets, aiTenants] =
    await Promise.all([
      getOrCreateTelemetryInstanceId(),
      getDeployMode(),
      isSetupCompleted(),
      prisma.tenant.count({ where: { status: "active" } }),
      prisma.user.count(),
      prisma.tenantMembership.count(),
      prisma.post.count(),
      prisma.post.count({ where: { createdAt: { gte: last24h } } }),
      prisma.botAccount.count({ where: { enabled: true } }),
      prisma.publishTarget.count({ where: { enabled: true } }),
      prisma.tenantAiSettings.count({ where: { enabled: true } }),
    ]);

  return buildTelemetryReport(
    {
      instanceId,
      instanceName: config.telemetry.instanceName,
      version: config.buildVersion,
      environment: config.nodeEnv,
      deployMode,
      setupCompleted,
      uptimeSeconds: process.uptime(),
      emailConfigured: Boolean(config.resend.apiKey),
      counts: { tenants, users, memberships, postsTotal, postsLast24h, botsEnabled, publishTargets },
      aiTenants,
    },
    new Date(),
  );
}

/**
 * Anonymous usage reporting to the central Campux dashboard. First report
 * shortly after boot, then a jittered ~2 h heartbeat. Failures are silent
 * (debug-level) and retried later — the collector being down must never
 * degrade or noise up a self-hosted instance.
 */
export function registerTelemetryReporter({ logger, config }: { logger: FastifyBaseLogger; config: CampuxConfig }) {
  const reportUrl = resolveTelemetryTarget({
    disabled: config.telemetry.disabled,
    endpoint: config.telemetry.endpoint,
    endpointExplicit: config.telemetry.endpointExplicit,
    nodeEnv: config.nodeEnv,
  });

  if (!reportUrl) {
    if (config.telemetry.disabled) {
      logger.info("anonymous telemetry disabled by CAMPUX_TELEMETRY_DISABLED");
    }
    return () => {};
  }

  logger.info(
    { endpoint: reportUrl, intervalHours: reportIntervalMs / 3_600_000 },
    "anonymous telemetry enabled (aggregate counters only; opt out with CAMPUX_TELEMETRY_DISABLED=1, see docs.campux.top/admin/telemetry)",
  );

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let firstSuccessLogged = false;

  function schedule(delayMs: number) {
    if (stopped) {
      return;
    }
    timer = setTimeout(() => {
      void tick();
    }, delayMs);
  }

  async function tick() {
    try {
      const report = await collectTelemetryReport(config);
      const response = await fetch(reportUrl!, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": `campux/${report.version}`,
        },
        body: JSON.stringify(report),
        signal: AbortSignal.timeout(sendTimeoutMs),
      });
      if (!response.ok) {
        throw new Error(`collector responded ${response.status}`);
      }
      if (!firstSuccessLogged) {
        firstSuccessLogged = true;
        logger.info({ instanceId: report.instanceId }, "anonymous telemetry report sent");
      } else {
        logger.debug({ instanceId: report.instanceId }, "anonymous telemetry report sent");
      }
      schedule(reportIntervalMs + Math.round((Math.random() - 0.5) * intervalJitterMs));
    } catch (error) {
      if (!stopped) {
        logger.debug({ error }, "telemetry report failed; will retry");
        schedule(failureRetryDelayMs);
      }
    }
  }

  schedule(initialDelayMs);

  return () => {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
    }
  };
}
