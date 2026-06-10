// Fleet days are bucketed in Beijing time, same convention as the main Campux
// server: pin the process timezone before anything reads a Date.
if (!process.env.TZ) {
  process.env.TZ = "Asia/Shanghai";
}

import { loadDashConfig } from "./config";
import { openDashDatabase, pruneOldReports } from "./db";
import { createDashServer } from "./server";

const config = loadDashConfig();
const db = openDashDatabase(config.dbPath);

const app = createDashServer({
  db,
  accessKey: config.accessKey,
  logger: { level: config.nodeEnv === "production" ? "info" : "debug" },
});

const retentionSweep = setInterval(
  () => {
    const pruned = pruneOldReports(db, config.retentionDays, new Date());
    if (pruned > 0) {
      app.log.info({ pruned, retentionDays: config.retentionDays }, "pruned old telemetry reports");
    }
  },
  24 * 60 * 60 * 1000,
);

app.addHook("onClose", async () => {
  clearInterval(retentionSweep);
  db.close();
});

await app.listen({ host: config.host, port: config.port });
app.log.info(
  { dbPath: config.dbPath, accessKeyConfigured: Boolean(config.accessKey) },
  "campux-dash collector listening",
);
