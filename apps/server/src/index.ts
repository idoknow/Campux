import Fastify from "fastify";
import cors from "@fastify/cors";
import { loadConfig } from "@campux/config";
import { createRuntimeQueue } from "./runtime/queue";
import { prisma } from "./lib/prisma";
import { registerAuthRoutes } from "./routes/auth";
import { registerHealthRoutes } from "./routes/health";
import { registerMetadataRoutes } from "./routes/metadata";
import { registerPostRoutes } from "./routes/posts";
import { registerSystemRoutes } from "./routes/system";
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
registerAuthRoutes(app, config);
registerTenantRoutes(app);
registerMetadataRoutes(app);
registerPostRoutes(app, config);
registerSystemRoutes(app);

app.addHook("onClose", async () => {
  await queue.stop();
  await prisma.$disconnect();
});

await queue.start();

await app.listen({
  host: config.serverHost,
  port: config.serverPort,
});
