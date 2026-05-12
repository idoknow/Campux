import { z } from "zod";

const configSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().default("postgresql://campux:campux@localhost:5432/campux_next"),
  CAMPUX_SERVER_HOST: z.string().default("0.0.0.0"),
  CAMPUX_SERVER_PORT: z.coerce.number().int().positive().default(8787),
  CAMPUX_WEB_ORIGIN: z.string().default("http://localhost:5180"),
  S3_ENDPOINT: z.string().default("http://localhost:9000"),
  S3_REGION: z.string().default("auto"),
  S3_BUCKET: z.string().default("campux-next"),
  S3_ACCESS_KEY_ID: z.string().default("campux"),
  S3_SECRET_ACCESS_KEY: z.string().default("campux-secret"),
  S3_PUBLIC_BASE_URL: z.string().default("http://localhost:9000/campux-next"),
});

export type CampuxConfig = ReturnType<typeof loadConfig>;

export function loadConfig() {
  const env = configSchema.parse(process.env);

  return {
    nodeEnv: env.NODE_ENV,
    databaseUrl: env.DATABASE_URL,
    serverHost: env.CAMPUX_SERVER_HOST,
    serverPort: env.CAMPUX_SERVER_PORT,
    webOrigin: env.CAMPUX_WEB_ORIGIN,
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
