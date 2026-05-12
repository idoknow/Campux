import Fastify from "fastify";
import cors from "@fastify/cors";
import { loadConfig } from "@campux/config";
import { createRuntimeQueue } from "./runtime/queue";
import { registerHealthRoutes } from "./routes/health";
import { registerTenantRoutes } from "./routes/tenants";

const config = loadConfig();
const app = Fastify({
  logger: {
    level: config.nodeEnv === "production" ? "info" : "debug",
  },
});

await app.register(cors, {
  origin: config.webOrigin,
  credentials: true,
});

const queue = createRuntimeQueue({
  logger: app.log,
});

registerHealthRoutes(app, queue);
registerTenantRoutes(app);

app.addHook("onClose", async () => {
  await queue.stop();
});

await queue.start();

await app.listen({
  host: config.serverHost,
  port: config.serverPort,
});
