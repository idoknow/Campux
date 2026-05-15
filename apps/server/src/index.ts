import { existsSync } from "node:fs";
import { resolve } from "node:path";
import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
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
import { registerOAuthRoutes } from "./routes/oauth";
import { registerOneBotRoutes } from "./routes/onebot";
import { registerPostRoutes } from "./routes/posts";
import { registerReviewRoutes } from "./routes/review";
import { registerStatsRoutes } from "./routes/stats";
import { registerSystemRoutes } from "./routes/system";
import { registerTenantRoutes } from "./routes/tenants";
import { runDatabaseMigrations } from "./lib/migrations";
import { registerQZoneCookieHeartbeat } from "./lib/qzone-cookies";
import { ensureBotSessionSecretConfigured } from "./lib/secret-json";

const config = loadConfig();
ensureBotSessionSecretConfigured();
const app = Fastify({
  logger: {
    level: config.nodeEnv === "production" ? "info" : "debug",
  },
});
await runDatabaseMigrations(app.log);

await app.register(cors, {
  origin: config.webOrigin,
  credentials: true,
});

const queue = createRuntimeQueue({
  logger: app.log,
});
const oneBot = new OneBotRuntime(queue, app.log, config);
registerPublishingWorker(queue, app.log, config, oneBot);

await registerOneBotRoutes(app, oneBot);
registerHealthRoutes(app, queue);
registerAuthRoutes(app, config);
registerTenantRoutes(app);
registerMetadataRoutes(app);
registerOAuthRoutes(app);
registerAdminRoutes(app, queue, oneBot);
registerBotRoutes(app, queue);
registerPostRoutes(app, config, oneBot);
registerReviewRoutes(app, queue, oneBot);
registerStatsRoutes(app);
registerSystemRoutes(app, queue);

const webDistDir = resolve(process.cwd(), config.webDistDir);
if (existsSync(webDistDir)) {
  await app.register(fastifyStatic, {
    root: webDistDir,
    prefix: "/",
    wildcard: false,
  });

  app.setNotFoundHandler((request, reply) => {
    if (request.method === "GET" && !request.url.startsWith("/api") && !request.url.startsWith("/onebot")) {
      return reply.sendFile("index.html");
    }
    return reply.code(404).send({ message: "Not Found" });
  });
}

app.addHook("onClose", async () => {
  await queue.stop();
  await prisma.$disconnect();
});

await queue.start();
await recoverPublishAttempts(queue, app.log);
const stopQZoneCookieHeartbeat = registerQZoneCookieHeartbeat(app.log, oneBot);

app.addHook("onClose", async () => {
  stopQZoneCookieHeartbeat();
});

await app.listen({
  host: config.serverHost,
  port: config.serverPort,
});
