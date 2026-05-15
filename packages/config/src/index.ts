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
});

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
  };
}
