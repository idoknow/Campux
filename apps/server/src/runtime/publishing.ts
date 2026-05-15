import type { FastifyBaseLogger } from "fastify";
import type { Prisma } from "@campux/db";
import { publishToQZone } from "@campux/integrations";
import { renderPostCard } from "@campux/render";
import { qzoneCookieDomain } from "../lib/bot-workflows";
import { prisma } from "../lib/prisma";
import { decryptJson } from "../lib/secret-json";
import type { RuntimeJob, RuntimeQueue } from "./queue";

const maxPublishAttempts = 3;

type ImagePayload = {
  url?: string;
};

export function registerPublishingWorker(queue: RuntimeQueue, logger: FastifyBaseLogger) {
  queue.registerHandler("publishPost", async (job) => {
    await handlePublishAttempt(queue, logger, job);
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

  logger.info({ count: attempts.length }, "publish attempts recovered");
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
    const nextRunAt = new Date(Date.now() + target.publishDelaySeconds * 1000);
    const attempt = await prisma.publishAttempt.upsert({
      where: {
        postId_publishTargetId: {
          postId,
          publishTargetId: target.id,
        },
      },
      update: {
        status: "queued",
        lastError: null,
        nextRunAt,
      },
      create: {
        tenantId,
        postId,
        publishTargetId: target.id,
        status: "queued",
        nextRunAt,
      },
    });
    attempts.push(attempt);
    enqueueAttempt(queue, tenantId, attempt.id, nextRunAt);
  }

  return attempts;
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

async function handlePublishAttempt(queue: RuntimeQueue, _logger: FastifyBaseLogger, job: RuntimeJob) {
  const attemptId = typeof job.payload.attemptId === "string" ? job.payload.attemptId : "";
  if (!attemptId) {
    throw new Error("publish attempt id missing");
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
    },
  });

  if (!attempt || attempt.status === "succeeded" || attempt.status === "skipped") {
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
    await refreshAggregatePostStatus(attempt.postId);
    return;
  }

  await prisma.publishAttempt.update({
    where: {
      id: attempt.id,
    },
    data: {
      status: "running",
      attempt: {
        increment: 1,
      },
      lastError: null,
      nextRunAt: null,
    },
  });

  try {
    const renderedCard = await renderPostCard({
      tenantName: attempt.post.tenant.name,
      authorName: attempt.post.author.displayName ?? attempt.post.author.qqUin.toString(),
      authorQq: attempt.post.author.qqUin.toString(),
      cornerQq: attempt.publishTarget.botAccount.qqUin.toString(),
      text: attempt.post.text,
      createdAt: attempt.post.createdAt,
      anonymous: attempt.post.anonymous,
    });
    const result = await publishToQZone({
      tenantId: attempt.tenantId,
      postId: attempt.postId,
      targetId: attempt.publishTargetId,
      targetName: attempt.publishTarget.displayName,
      text: attempt.post.text,
      renderedCard,
      imageUrls: getImageUrls(attempt.post.images),
      cookies: toCookieRecord(attempt.publishTarget.botAccount.sessions[0]?.cookies),
    });

    await prisma.publishAttempt.update({
      where: {
        id: attempt.id,
      },
      data: {
        status: "succeeded",
        externalId: result.externalId,
        verbose: result.verbose,
        lastError: null,
        nextRunAt: null,
      },
    });

    await prisma.postLog.create({
      data: {
        tenantId: attempt.tenantId,
        postId: attempt.postId,
        newStatus: "publishing",
        comment: `${attempt.publishTarget.displayName} 发布成功：${result.externalId}`,
      },
    });
  } catch (caught) {
    const currentAttempt = await prisma.publishAttempt.findUniqueOrThrow({
      where: {
        id: attempt.id,
      },
    });
    const message = caught instanceof Error ? caught.message : "发布失败";
    const shouldRetry = currentAttempt.attempt < maxPublishAttempts;
    const nextRunAt = shouldRetry ? new Date(Date.now() + 5_000) : null;
    await prisma.publishAttempt.update({
      where: {
        id: attempt.id,
      },
      data: {
        status: "failed",
        lastError: message,
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
  }

  await refreshAggregatePostStatus(attempt.postId);
}

async function refreshAggregatePostStatus(postId: string) {
  const post = await prisma.post.findUnique({
    where: {
      id: postId,
    },
    include: {
      publishAttempts: {
        include: {
          publishTarget: true,
        },
      },
    },
  });

  if (!post || post.publishAttempts.length === 0) {
    return;
  }

  const required = post.publishAttempts.filter((attempt) => attempt.publishTarget.required);
  if (required.length > 0 && required.every((attempt) => attempt.status === "succeeded" || attempt.status === "skipped")) {
    await prisma.post.update({
      where: {
        id: post.id,
      },
      data: {
        status: "published",
        logs: {
          create: {
            tenantId: post.tenantId,
            oldStatus: post.status,
            newStatus: "published",
            comment: "所有必需发布目标已完成",
          },
        },
      },
    });
    return;
  }

  const terminalFailures = required.filter((attempt) => attempt.status === "failed" && attempt.nextRunAt === null);
  if (terminalFailures.length > 0) {
    const hasSuccess = post.publishAttempts.some((attempt) => attempt.status === "succeeded");
    await prisma.post.update({
      where: {
        id: post.id,
      },
      data: {
        status: hasSuccess ? "partially_failed" : "failed",
        logs: {
          create: {
            tenantId: post.tenantId,
            oldStatus: post.status,
            newStatus: hasSuccess ? "partially_failed" : "failed",
            comment: "发布目标失败，请在管理页查看详情",
          },
        },
      },
    });
  }
}

function getImageUrls(images: unknown) {
  if (!Array.isArray(images)) {
    return [];
  }

  return images.flatMap((image) => {
    const candidate = image as ImagePayload;
    return typeof candidate.url === "string" ? [candidate.url] : [];
  });
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
