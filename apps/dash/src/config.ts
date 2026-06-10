import { z } from "zod";

const configSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("production"),
  CAMPUX_DASH_HOST: z.string().default("0.0.0.0"),
  CAMPUX_DASH_PORT: z.coerce.number().int().positive().default(8990),
  // SQLite file; the collector is append-mostly and tiny, so a single file on a
  // volume is the whole storage story. Use ":memory:" in tests.
  CAMPUX_DASH_DB_PATH: z.string().default("./data/campux-dash.sqlite"),
  // When set, GET /api/v1/stats and the dashboard data require this key
  // (Authorization: Bearer <key> or ?key=). Report ingestion stays open —
  // instances in the wild must always be able to report.
  CAMPUX_DASH_ACCESS_KEY: z.string().optional(),
  // Raw reports older than this are pruned daily; instances keep their latest
  // snapshot forever.
  CAMPUX_DASH_RETENTION_DAYS: z.coerce.number().int().positive().default(400),
});

export type DashConfig = ReturnType<typeof loadDashConfig>;

export function loadDashConfig() {
  const env = configSchema.parse(process.env);
  return {
    nodeEnv: env.NODE_ENV,
    host: env.CAMPUX_DASH_HOST,
    port: env.CAMPUX_DASH_PORT,
    dbPath: env.CAMPUX_DASH_DB_PATH,
    accessKey: env.CAMPUX_DASH_ACCESS_KEY,
    retentionDays: env.CAMPUX_DASH_RETENTION_DAYS,
  };
}
