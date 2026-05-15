import type { FastifyBaseLogger } from "fastify";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import type { CampuxConfig } from "@campux/config";
import { Prisma } from "@campux/db";
import { createS3Client, publishToQZone, QZonePublishError } from "@campux/integrations";
import { renderPostCard } from "@campux/render";
import { qzoneCookieDomain } from "../lib/bot-workflows";
import { prisma } from "../lib/prisma";
import { decryptJson } from "../lib/secret-json";
import type { RuntimeJob, RuntimeQueue } from "./queue";

const maxPublishAttempts = 3;
export const defaultPublishIntervalSeconds = 300;

type ImagePayload = {
  key?: string;
  url?: string;
  fileName?: string;
};

export function registerPublishingWorker(queue: RuntimeQueue, logger: FastifyBaseLogger, config: CampuxConfig) {
  queue.registerHandler("publishPost", async (job) => {
    await handlePublishAttempt(queue, logger, config, job);
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
    const nextRunAt = await resolveNextPublishRunAt({
      tenantId,
      botAccountId: target.botAccountId,
      intervalSeconds: target.publishDelaySeconds,
    });
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
        externalId: null,
        verbose: Prisma.JsonNull,
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

export function effectivePublishIntervalSeconds(value: number | null | undefined) {
  return Math.max(value ?? 0, defaultPublishIntervalSeconds);
}

export async function resolveNextPublishRunAt(options: {
  tenantId: string;
  botAccountId: string;
  intervalSeconds?: number | null;
  excludeAttemptId?: string;
}) {
  const intervalMs = effectivePublishIntervalSeconds(options.intervalSeconds) * 1_000;
  const now = Date.now();
  const recentAttempts = await prisma.publishAttempt.findMany({
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

async function handlePublishAttempt(queue: RuntimeQueue, _logger: FastifyBaseLogger, config: CampuxConfig, job: RuntimeJob) {
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
      verbose: Prisma.JsonNull,
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
    const captionText = renderPublishCaption(attempt.publishTarget.botAccount.publishTextTemplate, {
      postId: attempt.post.displayId,
      text: attempt.post.text,
      anonymous: attempt.post.anonymous,
      authorQq: attempt.post.author.qqUin.toString(),
    });
    const postImages = await loadPostImages(config, attempt.post.images);
    const result = await publishToQZone({
      tenantId: attempt.tenantId,
      postId: attempt.postId,
      targetId: attempt.publishTargetId,
      targetName: attempt.publishTarget.displayName,
      text: captionText,
      renderedCard,
      imageUrls: getImageUrls(attempt.post.images),
      images: postImages,
      cookies: toCookieRecord(attempt.publishTarget.botAccount.sessions[0]?.cookies),
    });

    await prisma.publishAttempt.update({
      where: {
        id: attempt.id,
      },
      data: {
        status: "succeeded",
        externalId: result.externalId,
        verbose: toInputJson(result.verbose),
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
    const verbose = caught instanceof QZonePublishError ? toInputJson(caught.verbose) : Prisma.JsonNull;
    const shouldRetry = currentAttempt.attempt < maxPublishAttempts;
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

async function loadPostImages(config: CampuxConfig, images: unknown) {
  if (!Array.isArray(images)) {
    return [];
  }
  const s3 = createS3Client(config);
  const result = [];
  for (const image of images) {
    const candidate = image as ImagePayload;
    if (!candidate.key) {
      continue;
    }
    const object = await s3.send(
      new GetObjectCommand({
        Bucket: config.s3.bucket,
        Key: candidate.key,
      }),
    );
    const body = object.Body;
    if (!body || !("transformToByteArray" in body) || typeof body.transformToByteArray !== "function") {
      continue;
    }
    const bytes = await body.transformToByteArray();
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
  includePostId?: boolean;
  includeAuthorMention?: boolean;
  includeLinks?: boolean;
};

function renderPublishCaption(value: Prisma.JsonValue | null | undefined, post: { postId: number; text: string; anonymous: boolean; authorQq: string }) {
  const template = normalizePublishCaptionTemplate(value);
  const parts = [];
  if (template.includePostId) {
    parts.push(`#${post.postId}`);
  }
  if (template.includeAuthorMention && !post.anonymous) {
    parts.push(`@{uin:${post.authorQq},nick:,who:1}`);
  }
  const firstLine = [template.customText?.trim(), ...parts].filter(Boolean).join(" ").trim();
  const lines = firstLine ? [firstLine] : [];
  if (template.includeLinks) {
    lines.push(...extractLinks(post.text));
  }
  return lines.join("\n").trim() || `#${post.postId}`;
}

function normalizePublishCaptionTemplate(value: Prisma.JsonValue | null | undefined): PublishCaptionTemplate {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return defaultPublishCaptionTemplate();
  }
  const record = value as Record<string, unknown>;
  return {
    customText: typeof record.customText === "string" ? record.customText : "",
    includePostId: typeof record.includePostId === "boolean" ? record.includePostId : true,
    includeAuthorMention: typeof record.includeAuthorMention === "boolean" ? record.includeAuthorMention : false,
    includeLinks: typeof record.includeLinks === "boolean" ? record.includeLinks : false,
  };
}

function defaultPublishCaptionTemplate(): Required<PublishCaptionTemplate> {
  return {
    customText: "",
    includePostId: true,
    includeAuthorMention: false,
    includeLinks: false,
  };
}

function extractLinks(text: string) {
  return text.match(/https?:\/\/[^\s]+/g) ?? [];
}
