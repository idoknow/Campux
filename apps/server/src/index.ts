import Fastify from "fastify";
import cors from "@fastify/cors";
import { loadConfig } from "@campux/config";
import { createRuntimeQueue } from "./runtime/queue";
import { recoverPublishAttempts, registerPublishingWorker } from "./runtime/publishing";
import { prisma } from "./lib/prisma";
import { registerAdminRoutes } from "./routes/admin";
import { registerAuthRoutes } from "./routes/auth";
import { registerBotRoutes } from "./routes/bot";
import { registerHealthRoutes } from "./routes/health";
import { registerMetadataRoutes } from "./routes/metadata";
import { registerPostRoutes } from "./routes/posts";
import { registerReviewRoutes } from "./routes/review";
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
registerPublishingWorker(queue, app.log);

registerHealthRoutes(app, queue);
registerAuthRoutes(app, config);
registerTenantRoutes(app);
registerMetadataRoutes(app);
registerAdminRoutes(app, queue);
registerBotRoutes(app, queue);
registerPostRoutes(app, config);
registerReviewRoutes(app, queue);
registerSystemRoutes(app, queue);

app.addHook("onClose", async () => {
  await queue.stop();
  await prisma.$disconnect();
});

await queue.start();
await recoverPublishAttempts(queue, app.log);

await app.listen({
  host: config.serverHost,
  port: config.serverPort,
});
