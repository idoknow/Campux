import { existsSync } from "node:fs";
import { resolve } from "node:path";

// Campux only operates in China. Pin the process timezone to Beijing (UTC+8) so
// that every Date method (daily/hourly stats buckets, schedulers) resolves in
// UTC+8 regardless of the host/container timezone. The Dockerfile also sets this
// via ENV; this guards local/dev runs where TZ may be unset or UTC.
if (!process.env.TZ) {
  process.env.TZ = "Asia/Shanghai";
}
import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { loadConfig } from "@campux/config";
import { createRuntimeQueue } from "./runtime/queue";
import { OneBotRuntime } from "./runtime/onebot";
import { recoverAiBackfillJobs, registerCampusModelingWorker } from "./runtime/campus-modeling";
import { recoverPublishAttempts, registerPublishingWorker } from "./runtime/publishing";
import { registerQZonePostMetricScheduler, registerQZonePostMetricWorker } from "./runtime/qzone-post-metrics";
import { registerBotFriendSnapshotScheduler } from "./runtime/bot-friend-snapshots";
import { registerFollowedPostCommentScheduler } from "./runtime/followed-post-comments";
import { registerBatchFlushSweeper, stopBatchFlushSweeper } from "./runtime/publish-batching";
import { registerTelemetryReporter } from "./runtime/telemetry";
import { prisma } from "./lib/prisma";
import { registerAdminRoutes } from "./routes/admin";
import { registerAiRoutes } from "./routes/ai";
import { registerAuthRoutes } from "./routes/auth";
import { registerBotRoutes } from "./routes/bot";
import { registerHealthRoutes } from "./routes/health";
import { registerMetadataRoutes } from "./routes/metadata";
import { registerOAuthRoutes } from "./routes/oauth";
import { registerOneBotRoutes } from "./routes/onebot";
import { registerPostRoutes } from "./routes/posts";
import { registerReviewRoutes } from "./routes/review";
import { registerSetupRoutes } from "./routes/setup";
import { registerStatsRoutes } from "./routes/stats";
import { registerSystemRoutes } from "./routes/system";
import { registerTenantRoutes } from "./routes/tenants";
import { runDatabaseMigrations } from "./lib/migrations";
import { registerQZoneCookieHeartbeat } from "./lib/qzone-cookies";
import { registerTenantLifecycleScheduler } from "./runtime/tenant-lifecycle";
import { ensureBotSessionSecretConfigured } from "./lib/secret-json";

const config = loadConfig();
ensureBotSessionSecretConfigured();
const app = Fastify({
  logger: {
    level: config.nodeEnv === "production" ? "info" : "debug",
  },
  bodyLimit: 500 * 1024 * 1024,
});
await runDatabaseMigrations(app.log);

await app.register(cors, {
  origin: config.webOrigin,
  credentials: true,
});
await app.register(fastifyMultipart, {
  limits: { fileSize: 500 * 1024 * 1024, files: 9, fields: 10 },
});

const queue = createRuntimeQueue({
  logger: app.log,
});
const oneBot = new OneBotRuntime(queue, app.log, config);
registerPublishingWorker(queue, app.log, config, oneBot);
registerQZonePostMetricWorker(queue, app.log);
registerCampusModelingWorker(queue, app.log);

await registerOneBotRoutes(app, oneBot);
registerHealthRoutes(app, queue);
registerSetupRoutes(app);
registerAuthRoutes(app, config);
registerTenantRoutes(app);
registerMetadataRoutes(app, config);
registerAiRoutes(app, queue);
registerOAuthRoutes(app);
registerAdminRoutes(app, queue, oneBot);
registerBotRoutes(app, queue);
registerPostRoutes(app, config, queue, oneBot);
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
await recoverAiBackfillJobs(queue, app.log);
const stopQZoneCookieHeartbeat = registerQZoneCookieHeartbeat(app.log, oneBot);
const stopTenantLifecycleScheduler = registerTenantLifecycleScheduler({ logger: app.log, config });
const stopQZonePostMetricScheduler = registerQZonePostMetricScheduler({ queue, logger: app.log });
const stopBotFriendSnapshotScheduler = registerBotFriendSnapshotScheduler({ caller: oneBot, logger: app.log });
const stopFollowedPostCommentScheduler = registerFollowedPostCommentScheduler({ caller: oneBot, logger: app.log });
const stopTelemetryReporter = registerTelemetryReporter({ logger: app.log, config });
registerBatchFlushSweeper(queue, app.log);

app.addHook("onClose", async () => {
  stopQZoneCookieHeartbeat();
  stopTenantLifecycleScheduler();
  stopQZonePostMetricScheduler();
  stopBotFriendSnapshotScheduler();
  stopFollowedPostCommentScheduler();
  stopTelemetryReporter();
  stopBatchFlushSweeper();
});

await app.listen({
  host: config.serverHost,
  port: config.serverPort,
});
