import type { FastifyBaseLogger } from "fastify";
import { getQZoneEmotionMetrics, QZoneEmotionMetricsError } from "@campux/integrations";
import { Prisma } from "@campux/db";
import { qzoneCookieDomain } from "../lib/bot-workflows";
import { prisma } from "../lib/prisma";
import { decryptJson } from "../lib/secret-json";
import type { RuntimeJob, RuntimeQueue } from "./queue";

const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
const refreshIntervalMs = 60 * 60 * 1000;
const refreshFreshnessMs = 55 * 60 * 1000;
const perBotRequestSpacingMs = 45 * 1000;

export function registerQZonePostMetricWorker(queue: RuntimeQueue, logger: FastifyBaseLogger) {
  queue.registerHandler("refreshQZonePostMetric", async (job) => {
    await handleQZonePostMetricRefresh(job, logger);
  });
}

export function registerQZonePostMetricScheduler({ queue, logger }: { queue: RuntimeQueue; logger: FastifyBaseLogger }) {
  async function scan() {
    const enqueued = await enqueueRecentQZonePostMetricRefreshes(queue, logger);
    logger.info({ count: enqueued }, "qzone post metric refresh scan completed");
  }

  const timer = setInterval(() => {
    void scan().catch((error) => logger.warn({ error }, "qzone post metric refresh scan failed"));
  }, refreshIntervalMs);
  void scan().catch((error) => logger.warn({ error }, "qzone post metric refresh scan failed"));
  return () => clearInterval(timer);
}

async function enqueueRecentQZonePostMetricRefreshes(queue: RuntimeQueue, logger: FastifyBaseLogger) {
  const now = new Date();
  const since = new Date(now.getTime() - sevenDaysMs);
  const freshAfter = new Date(now.getTime() - refreshFreshnessMs);
  const attempts = await prisma.publishAttempt.findMany({
    where: {
      status: "succeeded",
      qzoneTid: {
        not: null,
      },
      updatedAt: {
        gte: since,
      },
      publishTarget: {
        type: "qzone",
        enabled: true,
        botAccount: {
          enabled: true,
        },
      },
      post: {
        status: {
          in: ["published", "pending_recall"],
        },
      },
    },
    include: {
      qzonePostMetrics: true,
      publishTarget: {
        select: {
          botAccountId: true,
        },
      },
    },
    orderBy: {
      updatedAt: "asc",
    },
  });

  const dueAttempts = attempts.filter((attempt) => {
    const metric = attempt.qzonePostMetrics[0] ?? null;
    return !metric?.checkedAt || metric.checkedAt < freshAfter;
  });
  const nextRunByBot = new Map<string, number>();
  let enqueued = 0;
  for (const attempt of dueAttempts) {
    const botAccountId = attempt.publishTarget.botAccountId;
    const nextRun = Math.max(nextRunByBot.get(botAccountId) ?? now.getTime(), now.getTime());
    nextRunByBot.set(botAccountId, nextRun + perBotRequestSpacingMs);
    queue.enqueue({
      name: "refreshQZonePostMetric",
      tenantId: attempt.tenantId,
      payload: {
        attemptId: attempt.id,
      },
      runAt: new Date(nextRun),
    });
    enqueued += 1;
  }
  logger.info({ candidates: attempts.length, due: dueAttempts.length, enqueued }, "qzone post metric refresh jobs enqueued");
  return enqueued;
}

async function handleQZonePostMetricRefresh(job: RuntimeJob, logger: FastifyBaseLogger) {
  const attemptId = typeof job.payload.attemptId === "string" ? job.payload.attemptId : "";
  if (!attemptId) {
    throw new Error("qzone metric refresh attempt id missing");
  }

  const attempt = await prisma.publishAttempt.findUnique({
    where: {
      id: attemptId,
    },
    include: {
      publishTarget: {
        include: {
          botAccount: {
            include: {
              sessions: {
                where: {
                  type: "qzone",
                  domain: qzoneCookieDomain,
                },
                orderBy: {
                  refreshedAt: "desc",
                },
                take: 1,
              },
            },
          },
        },
      },
    },
  });

  if (!attempt || attempt.status !== "succeeded" || !attempt.qzoneTid) {
    logger.info({ attemptId }, "qzone post metric refresh skipped");
    return;
  }

  const qzoneTid = attempt.qzoneTid;
  const botQqUin = attempt.publishTarget.botAccount.qqUin.toString();
  const session = attempt.publishTarget.botAccount.sessions[0] ?? null;
  if (!session) {
    await upsertMetricFailure(attempt, qzoneTid, "没有可用的 QZone 登录态，无法获取单条数据");
    logger.warn({ attemptId, botAccountId: attempt.publishTarget.botAccountId }, "qzone post metric refresh missing session");
    return;
  }

  const cookies = toCookieRecord(decryptJson(session.cookies));
  try {
    const result = await getQZoneEmotionMetrics({
      uin: botQqUin,
      tid: qzoneTid,
      cookies,
      timeoutMs: 10_000,
    });
    await prisma.qZonePostMetric.upsert({
      where: {
        publishAttemptId: attempt.id,
      },
      create: {
        tenantId: attempt.tenantId,
        postId: attempt.postId,
        publishAttemptId: attempt.id,
        publishTargetId: attempt.publishTargetId,
        botAccountId: attempt.publishTarget.botAccountId,
        qzoneTid,
        visitorCount: result.visitorCount,
        likeCount: result.likeCount,
        commentCount: result.commentCount,
        forwardCount: result.forwardCount,
        lastError: null,
        lastVerbose: Prisma.JsonNull,
        checkedAt: new Date(result.verbose.checkedAt ?? new Date().toISOString()),
      },
      update: {
        publishTargetId: attempt.publishTargetId,
        botAccountId: attempt.publishTarget.botAccountId,
        qzoneTid,
        visitorCount: result.visitorCount,
        likeCount: result.likeCount,
        commentCount: result.commentCount,
        forwardCount: result.forwardCount,
        lastError: null,
        lastVerbose: Prisma.JsonNull,
        checkedAt: new Date(result.verbose.checkedAt ?? new Date().toISOString()),
      },
    });
    logger.info({ attemptId, qzoneTid, visitorCount: result.visitorCount, likeCount: result.likeCount, commentCount: result.commentCount }, "qzone post metric refreshed");
  } catch (error) {
    const message = error instanceof Error ? error.message : "QZone 单条数据获取失败";
    await upsertMetricFailure(
      attempt,
      qzoneTid,
      message,
      error instanceof QZoneEmotionMetricsError ? toInputJson(error.verbose) : undefined,
    );
    logger.warn({ error, attemptId, qzoneTid }, "qzone post metric refresh failed");
  }
}

async function upsertMetricFailure(
  attempt: {
    id: string;
    tenantId: string;
    postId: string;
    publishTargetId: string;
    publishTarget: { botAccountId: string };
  },
  qzoneTid: string,
  lastError: string,
  verbose?: Prisma.InputJsonValue,
) {
  await prisma.qZonePostMetric.upsert({
    where: {
      publishAttemptId: attempt.id,
    },
    create: {
      tenantId: attempt.tenantId,
      postId: attempt.postId,
      publishAttemptId: attempt.id,
      publishTargetId: attempt.publishTargetId,
      botAccountId: attempt.publishTarget.botAccountId,
      qzoneTid,
      lastError,
      lastVerbose: verbose ?? Prisma.JsonNull,
      checkedAt: new Date(),
    },
    update: {
      publishTargetId: attempt.publishTargetId,
      botAccountId: attempt.publishTarget.botAccountId,
      qzoneTid,
      lastError,
      lastVerbose: verbose ?? Prisma.JsonNull,
      checkedAt: new Date(),
    },
  });
}

function toCookieRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).flatMap(([name, cookieValue]) => (typeof cookieValue === "string" ? [[name, cookieValue]] : [])),
  );
}

function toInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
