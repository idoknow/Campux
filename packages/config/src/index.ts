import { z } from "zod";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const configSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("production"),
  DATABASE_URL: z.string().default("postgresql://campux:campux@localhost:5432/campux_next"),
  CAMPUX_SERVER_HOST: z.string().default("0.0.0.0"),
  CAMPUX_SERVER_PORT: z.coerce.number().int().positive().default(8989),
  CAMPUX_WEB_ORIGIN: z.string().default("http://localhost:5180"),
  CAMPUX_WEB_DIST_DIR: z.string().default("apps/web/dist"),
  S3_ENDPOINT: z.string().default("http://localhost:9000"),
  S3_REGION: z.string().default("auto"),
  S3_BUCKET: z.string().default("campux-next"),
  S3_ACCESS_KEY_ID: z.string().default("campux"),
  S3_SECRET_ACCESS_KEY: z.string().default("campux-secret"),
  S3_PUBLIC_BASE_URL: z.string().default("http://localhost:9000/campux-next"),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().default("Campux <noreply@campux.top>"),
  // Required in production (see ensureBotSessionSecretConfigured); used to
  // encrypt stored bot session cookies. Read here so it is validated/visible
  // centrally even though secret-json.ts also reads process.env directly.
  CAMPUX_BOT_SESSION_SECRET: z.string().optional(),
  // Skip the automatic `prisma migrate deploy` on boot when "true"/"1".
  CAMPUX_SKIP_AUTO_MIGRATE: z.string().optional(),
  // Container Chromium path for QZone rendering, e.g. /usr/bin/chromium-browser.
  PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: z.string().optional(),
  // Build/release identifier baked into the Docker image by CI (branch-sha).
  // Surfaces in anonymous telemetry so the fleet version distribution is known.
  CAMPUX_BUILD_VERSION: z.string().optional(),
  // Opt out of anonymous telemetry when "true"/"1". See docs/admin/telemetry.md
  // for exactly what is reported.
  CAMPUX_TELEMETRY_DISABLED: z.string().optional(),
  // Central telemetry collector. Outside production the reporter only runs when
  // this is set explicitly (so local dev instances never pollute fleet stats).
  CAMPUX_TELEMETRY_ENDPOINT: z.string().optional(),
  // Optional, voluntary instance label shown on the central dashboard. Leave
  // unset to stay fully anonymous.
  CAMPUX_TELEMETRY_INSTANCE_NAME: z.string().max(64).optional(),
});

const DEFAULT_TELEMETRY_ENDPOINT = "https://dash.campux.top";

function flagEnabled(value: string | undefined): boolean {
  return value === "1" || value === "true";
}

export type CampuxConfig = ReturnType<typeof loadConfig>;

function loadDotEnvFiles() {
  const candidates = [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "../.env"),
    resolve(process.cwd(), "../../.env"),
  ];

  for (const file of candidates) {
    if (!existsSync(file)) {
      continue;
    }

    const content = readFileSync(file, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex < 0) {
        continue;
      }

      const key = trimmed.slice(0, separatorIndex).trim();
      const rawValue = trimmed.slice(separatorIndex + 1).trim();
      if (!key || process.env[key] !== undefined) {
        continue;
      }

      process.env[key] = rawValue.replace(/^"|"$/g, "");
    }
  }
}

export function loadConfig() {
  loadDotEnvFiles();
  const env = configSchema.parse(process.env);

  return {
    nodeEnv: env.NODE_ENV,
    databaseUrl: env.DATABASE_URL,
    serverHost: env.CAMPUX_SERVER_HOST,
    serverPort: env.CAMPUX_SERVER_PORT,
    webOrigin: env.CAMPUX_WEB_ORIGIN,
    webDistDir: env.CAMPUX_WEB_DIST_DIR,
    s3: {
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      bucket: env.S3_BUCKET,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      publicBaseUrl: env.S3_PUBLIC_BASE_URL,
    },
    resend: {
      apiKey: env.RESEND_API_KEY,
      fromEmail: env.RESEND_FROM_EMAIL,
    },
    buildVersion: env.CAMPUX_BUILD_VERSION ?? "dev",
    telemetry: {
      disabled: flagEnabled(env.CAMPUX_TELEMETRY_DISABLED),
      endpoint: env.CAMPUX_TELEMETRY_ENDPOINT ?? DEFAULT_TELEMETRY_ENDPOINT,
      // Whether the operator pointed the reporter somewhere explicitly; gates
      // reporting outside production (see resolveTelemetryTarget).
      endpointExplicit: env.CAMPUX_TELEMETRY_ENDPOINT !== undefined,
      instanceName: env.CAMPUX_TELEMETRY_INSTANCE_NAME,
    },
  };
}
