import type { FastifyBaseLogger } from "fastify";
import { GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import type { CampuxConfig } from "@campux/config";
import { Prisma } from "@campux/db";
import type { PostStatus } from "@campux/db";
import { createS3Client, publishToQZone, QZonePublishError } from "@campux/integrations";
import { renderPostCard } from "@campux/render";
import { qzoneCookieDomain } from "../lib/bot-workflows";
import { prisma } from "../lib/prisma";
import { decryptJson } from "../lib/secret-json";
import { checkAndUpdateQZoneSession } from "../lib/qzone-cookies";
import { isQZoneProtocolAutoRefreshCooldownError } from "../lib/qzone-auto-refresh";
import { joinBatchCaptions } from "./publish-batching";
import { generatePublishSummary } from "./publish-summary";
import { readTenantPublishLlmSummaryEnabled } from "../lib/tenant-metadata";
import type { RuntimeJob, RuntimeQueue } from "./queue";

const maxPublishAttempts = 3;
export const defaultPublishIntervalSeconds = 10;

type PublishScheduleClient = typeof prisma | Prisma.TransactionClient;

type PublishingNotifier = {
  notifyPublishSucceeded(postId: string, targetId: string, externalId: string): Promise<void>;
  notifyPublishFailed(postId: string, targetId: string, message: string, options?: { needsLogin?: boolean; nextRunAt?: Date | null }): Promise<void>;
  notifyPublishWaitingForCookies?(postId: string, targetId: string, message: string): Promise<void>;
  notifyQZoneCookiesInvalid?(botAccountId: string, message: string, options?: { autoRefreshError?: string | null }): Promise<void>;
  refreshQZoneCookiesByProtocol?(botAccountId: string, reason: "publish_login_required" | "publish_preflight_invalid"): Promise<{ cookieNames: string[] }>;
};

type ImagePayload = {
  key?: string;
  url?: string;
  fileName?: string;
};

export function registerPublishingWorker(queue: RuntimeQueue, logger: FastifyBaseLogger, config: CampuxConfig, notifier?: PublishingNotifier) {
  queue.registerHandler("publishPost", async (job) => {
    await handlePublishAttempt(queue, logger, config, job, notifier);
  });
}

export async function recoverPublishAttempts(queue: RuntimeQueue, logger: FastifyBaseLogger) {
  await prisma.publishAttempt.updateMany({
    where: {
      status: "running",
    },
    data: {
      status: "queued",
      nextRunAt: new Date(),
    },
  });

  const attempts = await prisma.publishAttempt.findMany({
    where: {
      OR: [
        {
          status: "queued",
        },
        {
          status: "failed",
          nextRunAt: {
            not: null,
          },
        },
      ],
      post: {
        status: {
          in: ["publishing", "partially_failed", "failed"],
        },
      },
    },
  });

  for (const attempt of attempts) {
    enqueueAttempt(queue, attempt.tenantId, attempt.id, attempt.nextRunAt ?? new Date());
  }

  const posts = await prisma.post.findMany({
    where: {
      status: {
        in: ["publishing", "partially_failed", "failed"],
      },
    },
    select: {
      id: true,
    },
  });

  for (const post of posts) {
    await refreshAggregatePostStatus(post.id);
  }

  logger.info({ count: attempts.length, postsChecked: posts.length }, "publish attempts recovered");
}

export async function enqueuePublishFanout(queue: RuntimeQueue, tenantId: string, postId: string, actorId?: string | null) {
  const targets = await prisma.publishTarget.findMany({
    where: {
      tenantId,
      enabled: true,
      botAccount: {
        enabled: true,
      },
    },
    orderBy: {
      displayName: "asc",
    },
  });

  if (targets.length === 0) {
    await prisma.post.update({
      where: {
        id: postId,
      },
      data: {
        status: "published",
        logs: {
          create: {
            tenantId,
            actorId: actorId ?? null,
            oldStatus: "approved",
            newStatus: "published",
            comment: "没有启用发布目标，自动完成发布",
          },
        },
      },
    });
    return [];
  }

  await prisma.post.update({
    where: {
      id: postId,
    },
    data: {
      status: "publishing",
      logs: {
        create: {
          tenantId,
          actorId: actorId ?? null,
          oldStatus: "approved",
          newStatus: "publishing",
          comment: `已生成 ${targets.length} 个发布任务`,
        },
      },
    },
  });

  const attempts = [];
  for (const target of targets) {
    const { attempt, nextRunAt } = await schedulePublishAttempt({
      tenantId,
      postId,
      publishTargetId: target.id,
      botAccountId: target.botAccountId,
      intervalSeconds: target.publishDelaySeconds,
    });
    attempts.push(attempt);
    enqueueAttempt(queue, tenantId, attempt.id, nextRunAt);
  }

  return attempts;
}

/**
 * 批量模式：把一个已凑齐的批次 fan out 到每个启用的发布目标。
 * 每个 target 一个 batch attempt（渲染批次内全部稿件的卡片，合成一条说说）。
 */
export async function enqueueBatchPublishFanout(queue: RuntimeQueue, tenantId: string, batchId: string, actorId?: string | null) {
  const batch = await prisma.publishBatch.findUnique({
    where: { id: batchId },
    include: {
      items: {
        orderBy: { position: "asc" },
        select: { postId: true },
      },
    },
  });

  if (!batch || batch.items.length === 0) {
    return [];
  }

  const anchorItem = batch.items[0];
  if (!anchorItem) {
    return [];
  }
  const anchorPostId = anchorItem.postId;
  const postIds = batch.items.map((item) => item.postId);

  const targets = await prisma.publishTarget.findMany({
    where: {
      tenantId,
      enabled: true,
      botAccount: {
        enabled: true,
      },
    },
    orderBy: {
      displayName: "asc",
    },
  });

  // 标记批次进入发布阶段。
  await prisma.publishBatch.update({
    where: { id: batch.id },
    data: { status: targets.length === 0 ? "published" : "publishing", flushedAt: new Date() },
  });

  if (targets.length === 0) {
    for (const postId of postIds) {
      await prisma.post.update({
        where: { id: postId },
        data: {
          status: "published",
          logs: {
            create: {
              tenantId,
              actorId: actorId ?? null,
              oldStatus: "publishing",
              newStatus: "published",
              comment: "没有启用发布目标，批量稿件自动完成发布",
            },
          },
        },
      });
    }
    return [];
  }

  for (const postId of postIds) {
    await prisma.post.update({
      where: { id: postId },
      data: {
        status: "publishing",
        logs: {
          create: {
            tenantId,
            actorId: actorId ?? null,
            oldStatus: "publishing",
            newStatus: "publishing",
            comment: `批量发布：已生成 ${targets.length} 个发布任务（与其他 ${postIds.length - 1} 条稿件合并为一条说说）`,
          },
        },
      },
    });
  }

  const attempts = [];
  for (const target of targets) {
    const { attempt, nextRunAt } = await schedulePublishAttempt({
      tenantId,
      postId: anchorPostId,
      publishTargetId: target.id,
      botAccountId: target.botAccountId,
      batchId: batch.id,
      intervalSeconds: target.publishDelaySeconds,
    });
    attempts.push(attempt);
    enqueueAttempt(queue, tenantId, attempt.id, nextRunAt);
  }

  return attempts;
}

export function effectivePublishIntervalSeconds(value: number | null | undefined) {
  return Math.max(value ?? defaultPublishIntervalSeconds, 0);
}

export async function resolveNextPublishRunAt(options: {
  tenantId: string;
  botAccountId: string;
  intervalSeconds?: number | null;
  excludeAttemptId?: string;
}, client: PublishScheduleClient = prisma) {
  const intervalMs = effectivePublishIntervalSeconds(options.intervalSeconds) * 1_000;
  const now = Date.now();
  const recentAttempts = await client.publishAttempt.findMany({
    where: {
      tenantId: options.tenantId,
      ...(options.excludeAttemptId ? { id: { not: options.excludeAttemptId } } : {}),
      publishTarget: {
        botAccountId: options.botAccountId,
      },
      OR: [
        {
          status: {
            in: ["queued", "running"],
          },
        },
        {
          updatedAt: {
            gte: new Date(now - intervalMs),
          },
        },
      ],
    },
    select: {
      nextRunAt: true,
      updatedAt: true,
    },
    orderBy: {
      updatedAt: "desc",
    },
    take: 50,
  });

  const latestAnchor = recentAttempts.reduce((latest, attempt) => {
    const anchor = attempt.nextRunAt?.getTime() ?? attempt.updatedAt.getTime();
    return Math.max(latest, anchor);
  }, 0);

  return new Date(Math.max(now + intervalMs, latestAnchor + intervalMs));
}

export async function schedulePublishAttempt(options: {
  tenantId: string;
  postId: string;
  publishTargetId: string;
  botAccountId: string;
  batchId?: string | null;
  intervalSeconds?: number | null;
  excludeAttemptId?: string;
  resetAttempt?: boolean;
}) {
  return prisma.$transaction(async (tx) => {
    await lockPublishSchedule(tx, options.tenantId, options.botAccountId);
    const nextRunAt = await resolveNextPublishRunAt({
      tenantId: options.tenantId,
      botAccountId: options.botAccountId,
      ...(options.intervalSeconds === undefined ? {} : { intervalSeconds: options.intervalSeconds }),
      ...(options.excludeAttemptId === undefined ? {} : { excludeAttemptId: options.excludeAttemptId }),
    }, tx);
    const whereUnique = options.batchId
      ? { batchId_publishTargetId: { batchId: options.batchId, publishTargetId: options.publishTargetId } }
      : { postId_publishTargetId: { postId: options.postId, publishTargetId: options.publishTargetId } };
    const attempt = await tx.publishAttempt.upsert({
      where: whereUnique,
      update: {
        status: "queued",
        ...(options.resetAttempt ? { attempt: 0 } : {}),
        lastError: null,
        externalId: null,
        qzoneTid: null,
        verbose: Prisma.JsonNull,
        nextRunAt,
      },
      create: {
        tenantId: options.tenantId,
        postId: options.postId,
        publishTargetId: options.publishTargetId,
        batchId: options.batchId ?? null,
        status: "queued",
        nextRunAt,
      },
    });

    return { attempt, nextRunAt };
  });
}

async function lockPublishSchedule(tx: Prisma.TransactionClient, tenantId: string, botAccountId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`campux:publish:${tenantId}:${botAccountId}`})::bigint)`;
}

export function enqueueAttempt(queue: RuntimeQueue, tenantId: string, attemptId: string, runAt = new Date()) {
  return queue.enqueue({
    name: "publishPost",
    tenantId,
    payload: {
      attemptId,
    },
    runAt,
  });
}

export async function resumePublishAttemptsWaitingForCookies(queue: RuntimeQueue, botAccountId: string, logger?: FastifyBaseLogger) {
  const attempts = await prisma.publishAttempt.findMany({
    where: {
      status: "waiting_cookies",
      publishTarget: {
        botAccountId,
        enabled: true,
        botAccount: {
          enabled: true,
        },
      },
      post: {
        status: {
          in: ["publishing", "partially_failed", "failed"],
        },
      },
    },
    include: {
      publishTarget: true,
    },
    orderBy: {
      updatedAt: "asc",
    },
  });

  for (const attempt of attempts) {
    const { attempt: updated, nextRunAt } = await schedulePublishAttempt({
      tenantId: attempt.tenantId,
      postId: attempt.postId,
      publishTargetId: attempt.publishTargetId,
      botAccountId: attempt.publishTarget.botAccountId,
      intervalSeconds: attempt.publishTarget.publishDelaySeconds,
      excludeAttemptId: attempt.id,
    });
    await prisma.postLog.create({
      data: {
        tenantId: attempt.tenantId,
        postId: attempt.postId,
        newStatus: "publishing",
        comment: `${attempt.publishTarget.displayName} QZone cookies 已恢复，发布任务重新排队`,
      },
    });
    enqueueAttempt(queue, updated.tenantId, updated.id, nextRunAt);
    await refreshAttemptPostStatuses(attempt);
  }

  logger?.info({ botAccountId, count: attempts.length }, "waiting publish attempts resumed after qzone cookies became available");
  return attempts.length;
}

async function handlePublishAttempt(queue: RuntimeQueue, logger: FastifyBaseLogger, config: CampuxConfig, job: RuntimeJob, notifier?: PublishingNotifier) {
  const attemptId = typeof job.payload.attemptId === "string" ? job.payload.attemptId : "";
  if (!attemptId) {
    throw new Error("publish attempt id missing");
  }

  const now = new Date();
  const claimed = await prisma.publishAttempt.updateMany({
    where: {
      id: attemptId,
      OR: [
        {
          status: "queued",
          OR: [
            {
              nextRunAt: null,
            },
            {
              nextRunAt: {
                lte: now,
              },
            },
          ],
        },
        {
          status: "failed",
          nextRunAt: {
            lte: now,
          },
        },
      ],
    },
    data: {
      status: "running",
      lastError: null,
      verbose: Prisma.JsonNull,
      nextRunAt: null,
    },
  });
  if (claimed.count === 0) {
    logger.info({ attemptId }, "publish attempt claim skipped");
    return;
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
      post: {
        include: {
          tenant: true,
          author: true,
        },
      },
      batch: {
        include: {
          items: {
            orderBy: { position: "asc" },
            include: {
              post: {
                include: {
                  tenant: true,
                  author: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!attempt) {
    return;
  }

  if (!attempt.publishTarget.enabled || !attempt.publishTarget.botAccount.enabled) {
    await prisma.publishAttempt.update({
      where: {
        id: attempt.id,
      },
      data: {
        status: "skipped",
        lastError: "发布目标已停用",
      },
    });
    await refreshAttemptPostStatuses(attempt);
    return;
  }

  try {
    const cookies = await resolveCookiesForPublish({
      attemptId: attempt.id,
      tenantId: attempt.tenantId,
      postId: attempt.postId,
      publishTargetId: attempt.publishTargetId,
      publishTargetName: attempt.publishTarget.displayName,
      botAccountId: attempt.publishTarget.botAccountId,
      botQqUin: attempt.publishTarget.botAccount.qqUin.toString(),
      qzoneRefreshMode: attempt.publishTarget.qzoneRefreshMode,
      session: attempt.publishTarget.botAccount.sessions[0] ?? null,
      logger,
      notifier,
    });
    if (!cookies) {
      await refreshAttemptPostStatuses(attempt);
      return;
    }
    await prisma.publishAttempt.update({
      where: {
        id: attempt.id,
      },
      data: {
        attempt: {
          increment: 1,
        },
      },
    });

    // 批量 attempt：渲染批次内每条稿件的卡片，拼接配文，合成一条说说；
    // 单稿 attempt：渲染单条稿件的卡片。
    const postsToPublish = attempt.batch
      ? attempt.batch.items.map((item) => item.post)
      : [attempt.post];

    const imageGroups: Array<{ renderedCard?: Uint8Array | undefined; images?: Array<{ name: string; bytes: Uint8Array }> | undefined }> = [];
    const aggregatedImageUrls: string[] = [];
    const captionParts: string[] = [];
    const isBatch = Boolean(attempt.batch);
    // 配置了 LLM 且开启开关时，给每条稿件文字追加一句极短总结（≤16 字）。失败静默跳过，不阻塞发布。
    const summaryEnabled = await readTenantPublishLlmSummaryEnabled(prisma, attempt.tenantId);
    for (const target of postsToPublish) {
      const summary = summaryEnabled
        ? await generatePublishSummary({ tenantId: attempt.tenantId, text: target.text, logger })
        : null;
      const renderedCard = await renderPostCard({
        tenantName: target.tenant.name,
        displayHost: target.tenant.host,
        displayId: target.displayId,
        authorName: target.author.displayName ?? target.author.qqUin.toString(),
        authorQq: target.author.qqUin.toString(),
        cornerQq: attempt.publishTarget.botAccount.qqUin.toString(),
        text: target.text,
        createdAt: target.createdAt,
        anonymous: target.anonymous,
      });
      captionParts.push(
        renderPublishCaption(attempt.publishTarget.botAccount.publishTextTemplate, {
          postId: target.displayId,
          text: target.text,
          anonymous: target.anonymous,
          authorQq: target.author.qqUin.toString(),
          // 批量时省略固定前/后缀，整条说说只在外层各加一次。
          omitFixedText: isBatch,
          summary,
        }),
      );
      // 每条稿件成一组：渲染卡片 + 该稿件配图，保证上传顺序为「稿件1渲染图、稿件1配图…、稿件2渲染图、稿件2配图…」。
      imageGroups.push({
        renderedCard,
        images: await loadPostImages(config, attempt.tenantId, target.attachments),
      });
      aggregatedImageUrls.push(...getImageUrls(target.attachments));
    }
    // 单稿：renderPublishCaption 已含固定前后缀，直接拼接。
    // 批量：每条只保留可变部分（#号/@作者/链接），固定前缀与后缀在整条说说级别各加一次。
    const captionText = isBatch
      ? wrapBatchCaptionWithFixedText(attempt.publishTarget.botAccount.publishTextTemplate, joinBatchCaptions(captionParts))
      : joinBatchCaptions(captionParts);
    const result = await publishToQZone({
      tenantId: attempt.tenantId,
      postId: attempt.postId,
      targetId: attempt.publishTargetId,
      targetName: attempt.publishTarget.displayName,
      text: captionText,
      imageGroups,
      imageUrls: aggregatedImageUrls,
      cookies,
    });

    await prisma.publishAttempt.update({
      where: {
        id: attempt.id,
      },
      data: {
        status: "succeeded",
        externalId: result.externalId,
        qzoneTid: result.qzoneTid,
        verbose: toInputJson(result.verbose),
        lastError: null,
        nextRunAt: null,
      },
    });

    for (const target of postsToPublish) {
      await prisma.postLog.create({
        data: {
          tenantId: attempt.tenantId,
          postId: target.id,
          newStatus: "publishing",
          comment: `${attempt.publishTarget.displayName} 发布成功：${result.externalId}`,
        },
      });
      await notifier?.notifyPublishSucceeded(target.id, attempt.publishTargetId, result.externalId).catch((error) => {
        logger.warn({ error, postId: target.id, publishTargetId: attempt.publishTargetId }, "failed to notify publish success");
      });
    }
  } catch (caught) {
    const currentAttempt = await prisma.publishAttempt.findUniqueOrThrow({
      where: {
        id: attempt.id,
      },
    });
    const message = caught instanceof Error ? caught.message : "发布失败";
    const previousVerbose = caught instanceof QZonePublishError ? caught.verbose : null;
    const verbose = caught instanceof QZonePublishError ? toInputJson(caught.verbose) : Prisma.JsonNull;
    const needsLogin = isQZoneLoginRequiredError(message);
    if (needsLogin && attempt.publishTarget.qzoneRefreshMode === "protocol" && notifier?.refreshQZoneCookiesByProtocol && currentAttempt.attempt < maxPublishAttempts) {
      try {
        const refreshResult = await notifier.refreshQZoneCookiesByProtocol(attempt.publishTarget.botAccountId, "publish_login_required");
        const nextRunAt = await resolveNextPublishRunAt({
          tenantId: attempt.tenantId,
          botAccountId: attempt.publishTarget.botAccountId,
          intervalSeconds: attempt.publishTarget.publishDelaySeconds,
          excludeAttemptId: attempt.id,
        });
        await prisma.publishAttempt.update({
          where: {
            id: attempt.id,
          },
          data: {
            status: "queued",
            lastError: `QZone cookies 已通过协议自动刷新，等待重新发布。原始错误：${message}`,
            verbose: toInputJson({
              autoRefresh: {
                mode: "protocol",
                reason: "publish_login_required",
                cookieCount: refreshResult.cookieNames.length,
              },
              previousError: previousVerbose,
            }),
            nextRunAt,
          },
        });
        await prisma.postLog.create({
          data: {
            tenantId: attempt.tenantId,
            postId: attempt.postId,
            newStatus: "publishing",
            comment: `${attempt.publishTarget.displayName} 发布时检测到 cookies 失效，已协议自动刷新（${refreshResult.cookieNames.length} 项）并重新排队`,
          },
        });
        enqueueAttempt(queue, attempt.tenantId, attempt.id, nextRunAt);
        await notifier.notifyPublishFailed(attempt.postId, attempt.publishTargetId, `QZone cookies 已通过协议自动刷新，将自动重试发布。原始错误：${message}`, { nextRunAt }).catch((error) => {
          logger.warn({ error, postId: attempt.postId, publishTargetId: attempt.publishTargetId }, "failed to notify publish auto refresh retry");
        });
        await refreshAttemptPostStatuses(attempt);
        return;
      } catch (refreshError) {
        if (isQZoneProtocolAutoRefreshCooldownError(refreshError)) {
          logger.debug(
            { botAccountId: attempt.publishTarget.botAccountId, postId: attempt.postId, publishTargetId: attempt.publishTargetId, remainingMs: refreshError.remainingMs },
            "qzone cookies protocol auto refresh skipped during cooldown after publish login error",
          );
        } else {
          const refreshMessage = refreshError instanceof Error ? refreshError.message : "协议自动刷新失败";
          await notifier.notifyQZoneCookiesInvalid?.(attempt.publishTarget.botAccountId, message, { autoRefreshError: refreshMessage }).catch((error) => {
            logger.warn({ error, botAccountId: attempt.publishTarget.botAccountId }, "failed to notify qzone cookies auto refresh failure");
          });
        }
      }
    }
    const shouldRetry = !needsLogin && currentAttempt.attempt < maxPublishAttempts;
    const nextRunAt = shouldRetry
      ? await resolveNextPublishRunAt({
          tenantId: attempt.tenantId,
          botAccountId: attempt.publishTarget.botAccountId,
          intervalSeconds: attempt.publishTarget.publishDelaySeconds,
          excludeAttemptId: attempt.id,
        })
      : null;
    await prisma.publishAttempt.update({
      where: {
        id: attempt.id,
      },
      data: {
        status: "failed",
        lastError: message,
        verbose,
        nextRunAt,
      },
    });

    await prisma.postLog.create({
      data: {
        tenantId: attempt.tenantId,
        postId: attempt.postId,
        newStatus: shouldRetry ? "publishing" : "failed",
        comment: `${attempt.publishTarget.displayName} 发布失败：${message}`,
      },
    });

    if (nextRunAt) {
      enqueueAttempt(queue, attempt.tenantId, attempt.id, nextRunAt);
    }
    if (needsLogin || !nextRunAt) {
      await notifier?.notifyPublishFailed(attempt.postId, attempt.publishTargetId, message, { needsLogin, nextRunAt }).catch((error) => {
        logger.warn({ error, postId: attempt.postId, publishTargetId: attempt.publishTargetId }, "failed to notify publish failure");
      });
    }
  }

  await refreshAttemptPostStatuses(attempt);
}

async function resolveCookiesForPublish({
  attemptId,
  tenantId,
  postId,
  publishTargetId,
  publishTargetName,
  botAccountId,
  botQqUin,
  qzoneRefreshMode,
  session,
  logger,
  notifier,
}: {
  attemptId: string;
  tenantId: string;
  postId: string;
  publishTargetId: string;
  publishTargetName: string;
  botAccountId: string;
  botQqUin: string;
  qzoneRefreshMode: string;
  session: {
    id: string;
    cookies: Prisma.JsonValue;
    healthStatus: string;
    healthMessage: string | null;
  } | null;
  logger: FastifyBaseLogger;
  notifier: PublishingNotifier | undefined;
}) {
  const checkedSession = await ensureSessionChecked(session);
  const checkedCookies = getAvailableCookies(checkedSession);
  if (checkedCookies) {
    return checkedCookies;
  }

  let autoRefreshError: string | null = null;
  if (qzoneRefreshMode === "protocol" && notifier?.refreshQZoneCookiesByProtocol) {
    try {
      await notifier.refreshQZoneCookiesByProtocol(botAccountId, "publish_preflight_invalid");
      const refreshedSession = await findLatestQZoneSession(botAccountId);
      const refreshedCookies = getAvailableCookies(refreshedSession);
      if (refreshedCookies) {
        return refreshedCookies;
      }
      autoRefreshError = refreshedSession?.healthMessage ? `协议自动刷新后 cookies 仍不可用：${refreshedSession.healthMessage}` : "协议自动刷新后没有拿到可用 cookies";
    } catch (error) {
      if (isQZoneProtocolAutoRefreshCooldownError(error)) {
        autoRefreshError = error.message;
        logger.debug({ botAccountId, postId, publishTargetId, remainingMs: error.remainingMs }, "qzone cookies protocol auto refresh skipped during cooldown before publish");
      } else {
        autoRefreshError = error instanceof Error ? error.message : "协议自动刷新失败";
        await notifier.notifyQZoneCookiesInvalid?.(botAccountId, checkedSession?.healthMessage ?? "QZone cookies 不可用", { autoRefreshError }).catch((notifyError) => {
          logger.warn({ error: notifyError, botAccountId }, "failed to notify qzone cookies auto refresh failure before publish");
        });
      }
    }
  }

  const message = checkedSession?.healthMessage ?? "这个发布目标还没有可用的 QZone cookies";
  await markAttemptWaitingForCookies({
    attemptId,
    tenantId,
    postId,
    publishTargetId,
    publishTargetName,
    message,
    autoRefreshError,
    notifier,
    logger,
  });
  return null;
}

async function ensureSessionChecked(
  session: {
    id: string;
    cookies: Prisma.JsonValue;
    healthStatus: string;
    healthMessage: string | null;
  } | null,
) {
  if (!session) {
    return null;
  }
  if (session.healthStatus === "available") {
    return session;
  }
  return checkAndUpdateQZoneSession(session.id);
}

function getAvailableCookies(session: { cookies: Prisma.JsonValue; healthStatus: string } | null) {
  if (!session || session.healthStatus !== "available") {
    return null;
  }
  return toCookieRecord(session.cookies);
}

async function findLatestQZoneSession(botAccountId: string) {
  const session = await prisma.botSession.findFirst({
    where: {
      botAccountId,
      type: "qzone",
      domain: qzoneCookieDomain,
    },
    orderBy: {
      refreshedAt: "desc",
    },
  });
  return ensureSessionChecked(session);
}

async function markAttemptWaitingForCookies({
  attemptId,
  tenantId,
  postId,
  publishTargetId,
  publishTargetName,
  message,
  autoRefreshError,
  notifier,
  logger,
}: {
  attemptId: string;
  tenantId: string;
  postId: string;
  publishTargetId: string;
  publishTargetName: string;
  message: string;
  autoRefreshError: string | null;
  notifier: PublishingNotifier | undefined;
  logger: FastifyBaseLogger;
}) {
  await prisma.publishAttempt.update({
    where: {
      id: attemptId,
    },
    data: {
      status: "waiting_cookies",
      lastError: autoRefreshError ? `${message}；协议自动刷新失败：${autoRefreshError}` : message,
      verbose: toInputJson({
        waitingFor: "qzone_cookies",
        message,
        autoRefreshError,
      }),
      nextRunAt: null,
    },
  });
  await prisma.postLog.create({
    data: {
      tenantId,
      postId,
      newStatus: "publishing",
      comment: `${publishTargetName} 等待可用 QZone cookies：${autoRefreshError ?? message}`,
    },
  });
  await notifier?.notifyPublishWaitingForCookies?.(postId, publishTargetId, autoRefreshError ?? message).catch((error) => {
    logger.warn({ error, postId, publishTargetId }, "failed to notify publish waiting for cookies");
  });
}

function isQZoneLoginRequiredError(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("cookie") ||
    normalized.includes("cookies") ||
    message.includes("登录") ||
    message.includes("p_skey") ||
    message.includes("skey") ||
    message.includes("uin") ||
    message.includes("g_tk")
  );
}

type AggregateAttempt = {
  status: string;
  nextRunAt: Date | null;
  publishTarget: { required: boolean };
};

/**
 * 纯逻辑：根据一组发布 attempt 推导稿件/批次的聚合状态。
 * 单稿模式 attempts = 该 post 的 attempts；批量模式 attempts = 该 batch 的 attempts。
 */
export function deriveAggregateStatus(attempts: AggregateAttempt[]): { status: PostStatus; comment: string } | null {
  if (attempts.length === 0) {
    return null;
  }

  const requiredAttempts = attempts.filter((attempt) => attempt.publishTarget.required);
  const optionalAttempts = attempts.filter((attempt) => !attempt.publishTarget.required);
  const completedRequiredAttempts = requiredAttempts.filter((attempt) => attempt.status === "succeeded" || attempt.status === "skipped");
  const completedOptionalAttempts = optionalAttempts.filter((attempt) => attempt.status === "succeeded" || attempt.status === "skipped");
  const completedAttempts = [...completedRequiredAttempts, ...completedOptionalAttempts];
  const allRequiredAttemptsCompleted = completedRequiredAttempts.length === requiredAttempts.length;
  const allAttemptsCompleted = completedAttempts.length === attempts.length;
  if (allRequiredAttemptsCompleted && (allAttemptsCompleted || completedRequiredAttempts.length > 0)) {
    return { status: "published", comment: allAttemptsCompleted ? "所有发布目标已完成" : "必需发布目标已完成" };
  }

  const hasPendingAttempt = requiredAttempts.some(
    (attempt) => attempt.status === "queued" || attempt.status === "running" || attempt.status === "waiting_cookies" || (attempt.status === "failed" && attempt.nextRunAt !== null),
  );
  if (hasPendingAttempt) {
    return { status: "publishing", comment: "发布任务仍在进行" };
  }

  const terminalFailures = requiredAttempts.filter((attempt) => attempt.status === "failed" && attempt.nextRunAt === null);
  if (terminalFailures.length > 0) {
    const hasCompletedAttempt = completedAttempts.length > 0;
    return {
      status: hasCompletedAttempt ? "partially_failed" : "failed",
      comment: "发布目标失败，请在管理页查看详情",
    };
  }

  return null;
}

async function refreshAggregatePostStatus(postId: string) {
  const post = await prisma.post.findUnique({
    where: {
      id: postId,
    },
    include: {
      publishAttempts: {
        include: {
          publishTarget: {
            select: {
              required: true,
            },
          },
        },
      },
    },
  });

  if (!post) {
    return;
  }

  const derived = deriveAggregateStatus(post.publishAttempts);
  if (!derived) {
    return;
  }
  await updatePostAggregateStatus(post.id, post.tenantId, post.status, derived.status, derived.comment);
}

const batchStatusFromPostStatus: Record<string, "publishing" | "published" | "partially_failed" | "failed"> = {
  publishing: "publishing",
  published: "published",
  partially_failed: "partially_failed",
  failed: "failed",
};

/**
 * 批量模式：批次内每条稿件共享同一组 batch attempt 的结果。
 * 据 batch.attempts 推导聚合状态，应用到批次内每条 post，并同步推进 PublishBatch.status。
 */
async function refreshBatchPostStatuses(batchId: string) {
  const batch = await prisma.publishBatch.findUnique({
    where: { id: batchId },
    include: {
      items: {
        include: {
          post: { select: { id: true, status: true, tenantId: true } },
        },
      },
      attempts: {
        include: {
          publishTarget: { select: { required: true } },
        },
      },
    },
  });

  if (!batch) {
    return;
  }

  const derived = deriveAggregateStatus(batch.attempts);
  if (!derived) {
    return;
  }

  for (const item of batch.items) {
    await updatePostAggregateStatus(item.post.id, item.post.tenantId, item.post.status, derived.status, derived.comment);
  }

  const batchStatus = batchStatusFromPostStatus[derived.status];
  if (batchStatus && batchStatus !== batch.status) {
    await prisma.publishBatch.update({
      where: { id: batch.id },
      data: { status: batchStatus },
    });
  }
}

/**
 * 刷新一个 attempt 影响到的所有稿件状态：批量 attempt 刷新整批，单稿 attempt 刷新单稿。
 */
async function refreshAttemptPostStatuses(attempt: { postId: string; batchId: string | null }) {
  if (attempt.batchId) {
    await refreshBatchPostStatuses(attempt.batchId);
    return;
  }
  await refreshAggregatePostStatus(attempt.postId);
}

async function updatePostAggregateStatus(postId: string, tenantId: string, oldStatus: PostStatus, newStatus: PostStatus, comment: string) {
  if (oldStatus === newStatus) {
    return;
  }

  await prisma.post.update({
    where: {
      id: postId,
    },
    data: {
      status: newStatus,
      logs: {
        create: {
          tenantId,
          oldStatus,
          newStatus,
          comment,
        },
      },
    },
  });

  if (newStatus === "published") {
    await autoFollowOwnPostOnPublish(postId, tenantId).catch(() => undefined);
  }
}

/**
 * When a post first becomes published, auto-subscribe its author to comment
 * digests if the author has the "自动关注对我的稿件评论" preference enabled
 * (default true). Mirrors the manual follow endpoint: idempotent upsert keyed by
 * (postId, userId), seeding the baseline at the current comment count so the
 * first scheduled digest only reports comments arriving after publication.
 */
async function autoFollowOwnPostOnPublish(postId: string, tenantId: string) {
  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: {
      id: true,
      authorId: true,
      author: {
        select: {
          autoFollowOwnPosts: true,
        },
      },
      qzonePostMetrics: {
        select: {
          commentCount: true,
        },
      },
    },
  });
  if (!post || !post.author.autoFollowOwnPosts) {
    return;
  }
  const currentCommentCount = post.qzonePostMetrics.reduce((sum, metric) => sum + (metric.commentCount ?? 0), 0);
  await prisma.postFollow.upsert({
    where: {
      postId_userId: {
        postId: post.id,
        userId: post.authorId,
      },
    },
    create: {
      tenantId,
      postId: post.id,
      userId: post.authorId,
      lastPushedCommentCount: currentCommentCount,
    },
    update: {},
  });
}

function getImageUrls(attachments: unknown) {
  if (!Array.isArray(attachments)) {
    return [];
  }

  return attachments.flatMap((attachment) => {
    const candidate = attachment as any;
    return typeof candidate.url === "string" ? [candidate.url] : [];
  });
}

const IMAGE_READ_SIZE_LIMIT = 10 * 1024 * 1024;

function assertValidImageKey(key: string, tenantId: string): void {
  const allowedPrefixes = [
    `tenants/${tenantId}/uploads/`,
    `tenants/${tenantId}/legacy/`,
  ];
  if (!allowedPrefixes.some((prefix) => key.startsWith(prefix))) {
    throw new Error(`图片 key 不属于当前校园墙：${key}`);
  }
}

async function loadPostImages(config: CampuxConfig, tenantId: string, attachments: unknown) {
  if (!Array.isArray(attachments)) {
    throw new Error("稿件图片数据格式错误：attachments 不是数组");
  }
  const s3 = createS3Client(config);
  const result = [];
  for (const attachment of attachments) {
    const candidate = attachment as any;
    if (!candidate.key) {
      throw new Error("稿件图片数据缺少 key 字段");
    }
    assertValidImageKey(candidate.key, tenantId);

    const head = await s3.send(
      new HeadObjectCommand({
        Bucket: config.s3.bucket,
        Key: candidate.key,
      }),
    );
    if (head.ContentLength !== undefined && head.ContentLength > IMAGE_READ_SIZE_LIMIT) {
      throw new Error(`图片 ${candidate.key} 超过 10MB 限制（${Math.round(head.ContentLength / 1024 / 1024)}MB）`);
    }

    const object = await s3.send(
      new GetObjectCommand({
        Bucket: config.s3.bucket,
        Key: candidate.key,
      }),
    );
    const body = object.Body;
    if (!body || !("transformToByteArray" in body) || typeof body.transformToByteArray !== "function") {
      throw new Error(`图片 ${candidate.key} 读取失败：对象 Body 不可读`);
    }

    let bytes: Uint8Array;
    try {
      bytes = await body.transformToByteArray();
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      throw new Error(`图片 ${candidate.key} 读取失败：${message}`);
    }

    if (bytes.byteLength === 0) {
      throw new Error(`图片 ${candidate.key} 读取结果为空`);
    }

    result.push({
      name: candidate.fileName ?? candidate.key.split("/").pop() ?? "post-image.jpg",
      bytes,
    });
  }
  return result;
}

function toCookieRecord(value: Prisma.JsonValue | undefined) {
  if (!value) {
    return null;
  }
  const decrypted = decryptJson(value);
  if (!decrypted || typeof decrypted !== "object" || Array.isArray(decrypted)) {
    return null;
  }

  return Object.fromEntries(
    Object.entries(decrypted).flatMap(([name, cookieValue]) => (typeof cookieValue === "string" ? [[name, cookieValue]] : [])),
  );
}

function toInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

type PublishCaptionTemplate = {
  customText?: string;
  suffixText?: string;
  includePostId?: boolean;
  includeAuthorMention?: boolean;
  includeLinks?: boolean;
};

export function renderPublishCaption(
  value: Prisma.JsonValue | null | undefined,
  post: { postId: number; text: string; anonymous: boolean; authorQq: string; omitFixedText?: boolean; summary?: string | null },
) {
  const template = normalizePublishCaptionTemplate(value);
  const omitFixed = Boolean(post.omitFixedText);
  const parts = [];
  if (template.includePostId) {
    parts.push(`#${post.postId}`);
  }
  if (template.includeAuthorMention && !post.anonymous) {
    parts.push(`@{uin:${post.authorQq},nick:,who:1}`);
  }
  // LLM 极短总结：紧跟在 @原作者 之后、固定后缀之前。批量时每条子稿件各自携带。
  const summary = post.summary?.trim();
  if (summary) {
    parts.push(summary);
  }
  // 批量时省略固定前缀 customText（整条说说只在外层加一次）；单稿保持原行为。
  const firstLineParts = omitFixed ? parts : [template.customText?.trim(), ...parts];
  const firstLine = firstLineParts.filter(Boolean).join(" ").trim();
  const lines = firstLine ? [firstLine] : [];
  if (template.includeLinks) {
    lines.push(...extractLinks(post.text));
  }
  // 批量时省略固定后缀 suffixText（整条说说只在外层加一次）。
  if (!omitFixed && template.suffixText?.trim()) {
    lines.push(template.suffixText.trim());
  }
  const body = lines.join("\n").trim();
  // 批量的每稿可变部分允许为空（外层会兜底固定文本/#号）；单稿保持「至少 #号」兜底。
  return omitFixed ? body : body || `#${post.postId}`;
}

/**
 * 批量整条说说级别加固定前缀与后缀（各一次）：
 *   [固定前缀]
 *   <各稿可变部分拼接>
 *   [固定后缀]
 * body 已是 joinBatchCaptions 拼好的各稿可变部分。任一段为空则跳过。
 */
export function wrapBatchCaptionWithFixedText(value: Prisma.JsonValue | null | undefined, body: string): string {
  const template = normalizePublishCaptionTemplate(value);
  const prefix = template.customText?.trim() ?? "";
  const suffix = template.suffixText?.trim() ?? "";
  const lines = [prefix, body.trim(), suffix].filter(Boolean);
  return lines.join("\n").trim();
}

function normalizePublishCaptionTemplate(value: Prisma.JsonValue | null | undefined): PublishCaptionTemplate {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return defaultPublishCaptionTemplate();
  }
  const record = value as Record<string, unknown>;
  return {
    customText: typeof record.customText === "string" ? record.customText : "",
    suffixText: typeof record.suffixText === "string" ? record.suffixText : "",
    includePostId: typeof record.includePostId === "boolean" ? record.includePostId : true,
    includeAuthorMention: typeof record.includeAuthorMention === "boolean" ? record.includeAuthorMention : false,
    includeLinks: typeof record.includeLinks === "boolean" ? record.includeLinks : false,
  };
}

function defaultPublishCaptionTemplate(): Required<PublishCaptionTemplate> {
  return {
    customText: "",
    suffixText: "",
    includePostId: true,
    includeAuthorMention: false,
    includeLinks: false,
  };
}

function extractLinks(text: string) {
  return text.match(/https?:\/\/[^\s]+/g) ?? [];
}
