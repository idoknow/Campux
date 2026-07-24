import type { FastifyBaseLogger } from "fastify";
import { getQZoneEmotionComments, getQZoneEmotionMetrics, QZoneEmotionMetricsError } from "@campux/integrations";
import type { QZoneComment } from "@campux/integrations";
import { Prisma, JsonNull } from "@campux/db";
import { qzoneCookieDomain } from "../lib/bot-workflows";
import { prisma } from "../lib/prisma";
import { decryptJson } from "../lib/secret-json";
import type { RuntimeJob, RuntimeQueue } from "./queue";

const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
const refreshIntervalMs = 60 * 60 * 1000;
const refreshFreshnessMs = 55 * 60 * 1000;
const perBotRequestSpacingMs = 45 * 1000;
const metricRequestReservationPayloadKey = "qzoneMetricRequestReservedAt";

type BotMetricDispatchState = {
  lastStartedAt: number | null;
  nextReservationAt: number;
  nextReflowAt: number;
};

export function registerQZonePostMetricWorker(queue: RuntimeQueue, logger: FastifyBaseLogger) {
  const dispatchStateByBot = new Map<string, BotMetricDispatchState>();
  queue.registerHandler("refreshQZonePostMetric", async (job) => {
    await handleQZonePostMetricRefresh(job, queue, dispatchStateByBot, logger);
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
    const queuedJob = queue.enqueueUnique({
      name: "refreshQZonePostMetric",
      tenantId: attempt.tenantId,
      payload: {
        attemptId: attempt.id,
      },
      runAt: new Date(nextRun),
    }, `refreshQZonePostMetric:${attempt.id}`);
    if (queuedJob) {
      nextRunByBot.set(botAccountId, nextRun + perBotRequestSpacingMs);
      enqueued += 1;
    }
  }
  logger.info(
    { candidates: attempts.length, due: dueAttempts.length, enqueued, deduplicated: dueAttempts.length - enqueued },
    "qzone post metric refresh jobs enqueued",
  );
  return enqueued;
}

async function handleQZonePostMetricRefresh(
  job: RuntimeJob,
  queue: RuntimeQueue,
  dispatchStateByBot: Map<string, BotMetricDispatchState>,
  logger: FastifyBaseLogger,
) {
  const attemptId = typeof job.payload.attemptId === "string" ? job.payload.attemptId : "";
  if (!attemptId) {
    throw new Error("qzone metric refresh attempt id missing");
  }

  const attempt = await prisma.publishAttempt.findUnique({
    where: {
      id: attemptId,
    },
    include: {
      qzonePostMetrics: {
        select: { id: true, checkedAt: true },
        take: 1,
      },
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
  const botAccountId = attempt.publishTarget.botAccountId;
  const botQqUin = attempt.publishTarget.botAccount.qqUin.toString();
  const session = attempt.publishTarget.botAccount.sessions[0] ?? null;
  if (!session) {
    await upsertMetricFailure(attempt, qzoneTid, "没有可用的 QZone 登录态，无法获取单条数据");
    logger.warn({ attemptId, botAccountId }, "qzone post metric refresh missing session");
    return;
  }

  const now = Date.now();
  const dispatchState = dispatchStateByBot.get(botAccountId) ?? {
    lastStartedAt: null,
    nextReservationAt: now,
    nextReflowAt: now,
  };
  dispatchStateByBot.set(botAccountId, dispatchState);
  const payloadReservation = job.payload[metricRequestReservationPayloadKey];
  const reservedAt = typeof payloadReservation === "number" && Number.isFinite(payloadReservation)
    ? payloadReservation
    : null;
  const earliestFromLastRequest = dispatchState.lastStartedAt === null
    ? now
    : dispatchState.lastStartedAt + perBotRequestSpacingMs;

  let nextRequestAt: number | null = null;
  if (reservedAt === null) {
    nextRequestAt = Math.max(now, earliestFromLastRequest, dispatchState.nextReservationAt, dispatchState.nextReflowAt);
    dispatchState.nextReservationAt = nextRequestAt + perBotRequestSpacingMs;
  } else if (reservedAt > now) {
    nextRequestAt = reservedAt;
  } else if (earliestFromLastRequest > now) {
    nextRequestAt = Math.max(earliestFromLastRequest, dispatchState.nextReflowAt);
    dispatchState.nextReflowAt = nextRequestAt + perBotRequestSpacingMs;
    dispatchState.nextReservationAt = Math.max(dispatchState.nextReservationAt, dispatchState.nextReflowAt);
  }

  if (nextRequestAt !== null && nextRequestAt > now) {
    job.payload[metricRequestReservationPayloadKey] = nextRequestAt;
    queue.rescheduleCurrent(job, new Date(nextRequestAt));
    logger.debug({ attemptId, botAccountId, nextRequestAt: new Date(nextRequestAt) }, "qzone post metric refresh deferred for per-bot spacing");
    return;
  }
  delete job.payload[metricRequestReservationPayloadKey];
  if (!await claimQZonePostMetricRefresh(attempt, qzoneTid, new Date(now))) {
    logger.info({ attemptId, botAccountId }, "qzone post metric refresh skipped after freshness claim lost");
    return;
  }
  dispatchState.lastStartedAt = now;
  dispatchState.nextReservationAt = Math.max(dispatchState.nextReservationAt, now + perBotRequestSpacingMs);

  try {
    const cookies = toCookieRecord(decryptJson(session.cookies));
    const result = await getQZoneEmotionMetrics({
      uin: botQqUin,
      tid: qzoneTid,
      cookies,
      timeoutMs: 10_000,
    });

    // 仅当有评论时再拉评论列表，避免对无评论稿件浪费一次请求（风控）。
    let comments: QZoneComment[] = [];
    if (result.commentCount > 0) {
      await sleep(400 + Math.floor(Math.random() * 600));
      try {
        const commentResult = await getQZoneEmotionComments({
          uin: botQqUin,
          tid: qzoneTid,
          cookies,
          num: 50,
          timeoutMs: 10_000,
        });
        comments = commentResult.comments;
      } catch (commentError) {
        logger.warn({ commentError, attemptId, qzoneTid }, "qzone post comment fetch failed");
      }
    }
    const commentsJson = toInputJson(comments);

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
        comments: commentsJson,
        lastError: null,
        lastVerbose: JsonNull,
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
        comments: commentsJson,
        lastError: null,
        lastVerbose: JsonNull,
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

async function claimQZonePostMetricRefresh(
  attempt: {
    id: string;
    tenantId: string;
    postId: string;
    publishTargetId: string;
    publishTarget: { botAccountId: string };
    qzonePostMetrics: Array<{ id: string; checkedAt: Date | null }>;
  },
  qzoneTid: string,
  claimedAt: Date,
) {
  const staleBefore = new Date(claimedAt.getTime() - refreshFreshnessMs);
  const existing = attempt.qzonePostMetrics[0] ?? null;
  if (existing) {
    const claimed = await prisma.qZonePostMetric.updateMany({
      where: {
        id: existing.id,
        OR: [
          { checkedAt: null },
          { checkedAt: { lt: staleBefore } },
        ],
      },
      data: { checkedAt: claimedAt },
    });
    return claimed.count === 1;
  }

  try {
    await prisma.qZonePostMetric.create({
      data: {
        tenantId: attempt.tenantId,
        postId: attempt.postId,
        publishAttemptId: attempt.id,
        publishTargetId: attempt.publishTargetId,
        botAccountId: attempt.publishTarget.botAccountId,
        qzoneTid,
        checkedAt: claimedAt,
      },
    });
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      return false;
    }
    throw error;
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
      lastVerbose: verbose ?? JsonNull,
      checkedAt: new Date(),
    },
    update: {
      publishTargetId: attempt.publishTargetId,
      botAccountId: attempt.publishTarget.botAccountId,
      qzoneTid,
      lastError,
      lastVerbose: verbose ?? JsonNull,
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

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
