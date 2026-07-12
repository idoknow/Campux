import type { FastifyBaseLogger } from "fastify";
import { Prisma } from "@campux/db";
import { QZoneRecallError, setQZoneEmotionPrivate } from "@campux/integrations";
import { deleteOfficialQqForumThread } from "../runtime/official-qq";
import { qzoneCookieDomain } from "./bot-workflows";
import { checkAndUpdateQZoneSession } from "./qzone-cookies";
import { prisma } from "./prisma";
import { decryptJson } from "./secret-json";
import { writeAuditLog } from "./audit";

type RecallTargetResult = {
  targetId: string;
  targetName: string;
  qzoneTid: string | null;
  ok: boolean;
  message: string;
};

export class PostRecallExecutionError extends Error {
  constructor(readonly results: RecallTargetResult[]) {
    super("post recall failed for some publish targets");
    this.name = "PostRecallExecutionError";
  }
}

/** 批量发布（多条稿件合并为一条说说）的稿件不支持程序撤回。 */
export class PostRecallNotSupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostRecallNotSupportedError";
  }
}

export async function executePostRecall({
  tenantId,
  postId,
  actorId,
  logger,
}: {
  tenantId: string;
  postId: string;
  actorId: string;
  logger: FastifyBaseLogger;
}) {
  const batchItem = await prisma.publishBatchItem.findUnique({
    where: { postId },
    select: { id: true },
  });
  if (batchItem) {
    throw new PostRecallNotSupportedError("批量发布的稿件不支持程序撤回，请手动到 QQ 空间删除对应说说");
  }

  const post = await prisma.post.findFirst({
    where: {
      id: postId,
      tenantId,
    },
    include: {
      publishAttempts: {
        where: {
          status: "succeeded",
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
        orderBy: {
          updatedAt: "asc",
        },
      },
    },
  });

  if (!post) {
    throw new Error("稿件不存在");
  }

  const attempts = post.publishAttempts.filter((attempt) => attempt.qzoneTid || attempt.externalId);
  if (attempts.length === 0) {
    const updated = await prisma.post.update({
      where: {
        id: post.id,
      },
      data: {
        status: "recalled",
        recallIgnored: false,
        recallIgnoredAt: null,
        logs: {
          create: {
            tenantId,
            actorId,
            oldStatus: post.status,
            newStatus: "recalled",
            comment: "没有可撤回的 QZone 发表记录，直接标记为已撤回",
          },
        },
      },
    });
    await writeAuditLog({
      tenantId,
      actorId,
      action: "post.recall.complete",
      targetType: "post",
      targetId: post.id,
      detail: {
        displayId: post.displayId,
        targetCount: 0,
      },
    });
    return {
      post: updated,
      results: [] satisfies RecallTargetResult[],
    };
  }

  const results: RecallTargetResult[] = [];
  for (const attempt of attempts) {
    const qzoneTid = attempt.qzoneTid ?? attempt.externalId;
    const targetName = attempt.publishTarget.displayName;
    try {
      if (!qzoneTid) {
        throw new Error("缺少 QZone TID");
      }
      if (attempt.publishTarget.botAccount.platform === "official_qq") {
        if (!attempt.qzoneTid) {
          throw new Error("缺少 QQ 频道帖子 ID，无法调用删除帖子 API");
        }
        const recall = await deleteOfficialQqForumThread(
          {
            id: attempt.publishTarget.botAccount.id,
            officialAppId: attempt.publishTarget.botAccount.officialAppId,
            officialAppSecret: attempt.publishTarget.botAccount.officialAppSecret,
          },
          attempt.publishTarget.botAccount.reviewGroupId ?? "",
          attempt.qzoneTid,
        );
        await prisma.publishAttempt.update({
          where: {
            id: attempt.id,
          },
          data: {
            qzoneTid,
            verbose: toInputJson({
              previous: attempt.verbose,
              recall,
            }),
          },
        });
        await prisma.postLog.create({
          data: {
            tenantId,
            postId: post.id,
            actorId,
            oldStatus: post.status,
            newStatus: "pending_recall",
            comment: `${targetName} QQ 频道帖子已删除：${qzoneTid}`,
          },
        });
        results.push({
          targetId: attempt.publishTargetId,
          targetName,
          qzoneTid,
          ok: true,
          message: "QQ 频道帖子已删除",
        });
        continue;
      }

      const session = attempt.publishTarget.botAccount.sessions[0] ?? null;
      if (!session) {
        throw new Error("这个发布目标还没有 QZone cookies");
      }
      const checked = await checkAndUpdateQZoneSession(session.id);
      if (!checked || checked.healthStatus !== "available") {
        throw new Error(checked?.healthMessage ?? "QZone cookies 不可用");
      }

      const recall = await setQZoneEmotionPrivate({
        targetName,
        externalId: qzoneTid,
        cookies: toCookieRecord(checked.cookies),
      });
      await prisma.publishAttempt.update({
        where: {
          id: attempt.id,
        },
        data: {
          qzoneTid,
          verbose: toInputJson({
            previous: attempt.verbose,
            recall: recall.verbose,
          }),
        },
      });
      await prisma.postLog.create({
        data: {
          tenantId,
          postId: post.id,
          actorId,
          oldStatus: post.status,
          newStatus: "pending_recall",
          comment: `${targetName} 已设置为仅自己可见：${qzoneTid}`,
        },
      });
      results.push({
        targetId: attempt.publishTargetId,
        targetName,
        qzoneTid,
        ok: true,
        message: "已设置为仅自己可见",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "撤回失败";
      logger.warn({ error, postId: post.id, publishTargetId: attempt.publishTargetId, qzoneTid }, "failed to recall qzone post");
      await prisma.postLog.create({
        data: {
          tenantId,
          postId: post.id,
          actorId,
          oldStatus: post.status,
          newStatus: "pending_recall",
          comment: `${targetName} 撤回失败：${message}`,
        },
      });
      if (error instanceof QZoneRecallError) {
        await prisma.publishAttempt.update({
          where: {
            id: attempt.id,
          },
          data: {
            qzoneTid,
            verbose: toInputJson({
              previous: attempt.verbose,
              recall: error.verbose,
            }),
          },
        });
      }
      results.push({
        targetId: attempt.publishTargetId,
        targetName,
        qzoneTid,
        ok: false,
        message,
      });
    }
  }

  if (results.some((result) => !result.ok)) {
    await writeAuditLog({
      tenantId,
      actorId,
      action: "post.recall.failed",
      targetType: "post",
      targetId: post.id,
      detail: {
        displayId: post.displayId,
        results,
      },
    });
    throw new PostRecallExecutionError(results);
  }

  const updated = await prisma.post.update({
    where: {
      id: post.id,
    },
    data: {
      status: "recalled",
      recallIgnored: false,
      recallIgnoredAt: null,
      logs: {
        create: {
          tenantId,
          actorId,
          oldStatus: post.status,
          newStatus: "recalled",
          comment: `已撤回 ${results.length} 个发布目标`,
        },
      },
    },
  });
  await writeAuditLog({
    tenantId,
    actorId,
    action: "post.recall.complete",
    targetType: "post",
    targetId: post.id,
    detail: {
      displayId: post.displayId,
      results,
    },
  });
  return {
    post: updated,
    results,
  };
}

function toCookieRecord(value: Prisma.JsonValue) {
  const decrypted = decryptJson(value);
  if (!decrypted || typeof decrypted !== "object" || Array.isArray(decrypted)) {
    return {};
  }
  const record: Record<string, string> = {};
  for (const [key, item] of Object.entries(decrypted)) {
    if (typeof item === "string") {
      record[key] = item;
    }
  }
  return record;
}

function toInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
