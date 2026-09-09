import type { FastifyBaseLogger } from "fastify";
import { Prisma } from "@campux/db";
import { QZoneRecallError, setQZoneEmotionPrivate } from "@campux/integrations";
import { deletePersonalQqForumThread } from "../runtime/personal-qq";
import { qzoneCookieDomain } from "./bot-workflows";
import { prisma } from "./prisma";
import { decryptJson } from "./secret-json";
import { writeAuditLog } from "./audit";
import { runWithActiveTenantLease } from "./tenant-runtime-lease";

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

/** 批量发布（多条稿件合并为一条外部内容）的稿件不支持程序撤回。 */
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
  const leased = await runWithActiveTenantLease(prisma, tenantId, async (transaction) => {
    const batchItem = await transaction.publishBatchItem.findUnique({
      where: { postId },
      select: { id: true },
    });
    if (batchItem) {
      throw new PostRecallNotSupportedError("批量发布的稿件不支持程序撤回，请手动到 QQ 空间删除对应说说");
    }

    const post = await transaction.post.findFirst({
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
      const updated = await transaction.post.update({
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
      }, transaction);
      return {
        ok: true as const,
        post: updated,
        results: [] satisfies RecallTargetResult[],
      };
    }

    const results: RecallTargetResult[] = [];
    for (const attempt of attempts) {
      const qzoneTid = resolveRecallExternalId(attempt.qzoneTid, attempt.externalId, attempt.verbose);
      const targetName = attempt.publishTarget.displayName;
      try {
        if (!qzoneTid) {
          throw new Error("缺少 QZone TID");
        }
        if (attempt.publishTarget.botAccount.platform === "personal_qq") {
          const feedId = resolvePersonalQqRecallFeedId(attempt.qzoneTid, attempt.verbose);
          const createTime = resolvePersonalQqRecallCreateTime(attempt.verbose);
          if (!feedId) {
            throw new Error("缺少 QQ 频道帖子 ID，无法调用删除帖子 API");
          }
          if (createTime == null) {
            throw new Error("缺少 QQ 频道帖子 create_time，无法调用删除帖子 API");
          }
          const recall = await deletePersonalQqForumThread(
            undefined,
            {
              id: attempt.publishTarget.botAccount.id,
              qqUin: attempt.publishTarget.botAccount.qqUin,
              personalQqToken: attempt.publishTarget.botAccount.personalQqToken,
              reviewGroupId: attempt.publishTarget.botAccount.reviewGroupId,
            },
            {
              guildId: attempt.publishTarget.botAccount.qqUin.toString(),
              channelId: attempt.publishTarget.botAccount.reviewGroupId ?? "",
              feedId,
              createTime,
            },
          );
          await transaction.publishAttempt.update({
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
          await transaction.postLog.create({
            data: {
              tenantId,
              postId: post.id,
              actorId,
              oldStatus: post.status,
              newStatus: "pending_recall",
              comment: `${targetName} QQ 频道帖子已删除：${feedId}`,
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
        if (session.healthStatus !== "available") {
          throw new Error(session.healthMessage ?? "QZone cookies 不可用");
        }

        const recall = await setQZoneEmotionPrivate({
          targetName,
          externalId: qzoneTid,
          cookies: toCookieRecord(session.cookies),
        });
        await transaction.publishAttempt.update({
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
        await transaction.postLog.create({
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
        await transaction.postLog.create({
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
          await transaction.publishAttempt.update({
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
      }, transaction);
      return { ok: false as const, results };
    }

    const updated = await transaction.post.update({
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
    }, transaction);
    return {
      ok: true as const,
      post: updated,
      results,
    };
  });
  if (!leased.active) {
    throw new Error("校园墙已暂停或归档");
  }
  if (!leased.value.ok) {
    throw new PostRecallExecutionError(leased.value.results);
  }
  return { post: leased.value.post, results: leased.value.results };
}

function resolveRecallExternalId(qzoneTid: string | null, externalId: string | null, verbose: Prisma.JsonValue) {
  return qzoneTid ?? externalId ?? resolvePersonalQqRecallFeedId(null, verbose);
}

/** 从（qzoneTid 或 verbose）解析 personal_qq 频道的 feed_id。 */
function resolvePersonalQqRecallFeedId(qzoneTid: string | null, verbose: Prisma.JsonValue) {
  if (qzoneTid) return qzoneTid;
  const parsed = decryptJson(verbose);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const feedId = (parsed as Record<string, unknown>).feedId;
    if (typeof feedId === "string" && feedId) return feedId;
    const externalId = (parsed as Record<string, unknown>).externalId;
    if (typeof externalId === "string" && externalId) return externalId;
  }
  return null;
}

/** 从 verbose 解析 personal_qq 频道的 create_time（删除帖子必填）。 */
function resolvePersonalQqRecallCreateTime(verbose: Prisma.JsonValue): number | null {
  const parsed = decryptJson(verbose);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const v = (parsed as Record<string, unknown>).createTime;
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
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
