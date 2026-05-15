import Fastify from "fastify";
import cors from "@fastify/cors";
import { loadConfig } from "@campux/config";
import { createRuntimeQueue } from "./runtime/queue";
import { OneBotRuntime } from "./runtime/onebot";
import { recoverPublishAttempts, registerPublishingWorker } from "./runtime/publishing";
import { prisma } from "./lib/prisma";
import { registerAdminRoutes } from "./routes/admin";
import { registerAuthRoutes } from "./routes/auth";
import { registerBotRoutes } from "./routes/bot";
import { registerHealthRoutes } from "./routes/health";
import { registerMetadataRoutes } from "./routes/metadata";
import { registerOneBotRoutes } from "./routes/onebot";
import { registerPostRoutes } from "./routes/posts";
import { registerReviewRoutes } from "./routes/review";
import { registerSystemRoutes } from "./routes/system";
import { registerTenantRoutes } from "./routes/tenants";
import { registerQZoneCookieHeartbeat } from "./lib/qzone-cookies";

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
const oneBot = new OneBotRuntime(queue, app.log);
registerPublishingWorker(queue, app.log);

await registerOneBotRoutes(app, oneBot);
registerHealthRoutes(app, queue);
registerAuthRoutes(app, config);
registerTenantRoutes(app);
registerMetadataRoutes(app);
registerAdminRoutes(app, queue, oneBot);
registerBotRoutes(app, queue);
registerPostRoutes(app, config, oneBot);
registerReviewRoutes(app, queue);
registerSystemRoutes(app, queue);

app.addHook("onClose", async () => {
  await queue.stop();
  await prisma.$disconnect();
});

await queue.start();
await recoverPublishAttempts(queue, app.log);
const stopQZoneCookieHeartbeat = registerQZoneCookieHeartbeat(app.log);

app.addHook("onClose", async () => {
  stopQZoneCookieHeartbeat();
});

await app.listen({
  host: config.serverHost,
  port: config.serverPort,
});
