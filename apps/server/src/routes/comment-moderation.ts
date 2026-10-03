import type { FastifyInstance } from "fastify";
import { deleteQZoneEmotionComment, QZoneCommentDeleteError } from "@campux/integrations";
import type { Prisma } from "@campux/db";
import { hasTenantRole, requireReadyTenant } from "../lib/auth";
import { prisma } from "../lib/prisma";
import { writeAuditLog } from "../lib/audit";
import { readTenantPluginConfig } from "../lib/tenant-plugin-config";
import { qzoneCookieDomain } from "../lib/bot-workflows";
import { runWithActiveTenantLease } from "../lib/tenant-runtime-lease";
import { decryptJson } from "../lib/secret-json";
import type { RuntimeQueue } from "../runtime/queue";
import { z } from "zod";

const commentParamsSchema = z.object({
  id: z.string().min(1),
  commentId: z.string().min(1).max(64),
});

const deleteBodySchema = z.object({
  /** 评论所属的发布记录 id：评论挂在各墙号自己的说说上，楼层号跨墙号可能重复，
   * 必须由前端从被点击目标的评论区传入，把删除严格限定在该 attempt 内。 */
  attemptId: z.string().min(1),
});

type CommentDeleteResult = {
  targetId: string;
  targetName: string;
  ok: boolean;
  message: string;
};

function toCookieRecord(value: unknown) {
  const decrypted = decryptJson(value as Prisma.JsonValue);
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

/**
 * 删除成功后在本地评论快照里给被删评论打标记（deleted/deletedAt/deletedBy），
 * 而不是物理移除——管理员和审核员仍可在网页端"已删除的评论"折叠栏里看到它们。
 * 真实数据仍由 refreshQZonePostMetric 任务校准（刷新时会保留已标记条目）。
 */
async function markDeletedCommentInMetrics(transaction: Prisma.TransactionClient, attemptId: string, commentId: string, deletedBy: string) {
  const metric = await transaction.qZonePostMetric.findFirst({
    where: { publishAttemptId: attemptId },
    select: { id: true, commentCount: true, comments: true },
  });
  if (!metric || !Array.isArray(metric.comments)) {
    return;
  }
  const comments = metric.comments as Array<Record<string, unknown>>;
  const target = comments.find((comment) => String(comment?.id ?? "") === commentId);
  if (!target || target.deleted === true) {
    return;
  }
  const updated = comments.map((comment) =>
    String(comment?.id ?? "") === commentId
      ? { ...comment, deleted: true, deletedAt: new Date().toISOString(), deletedBy }
      : comment,
  );
  await transaction.qZonePostMetric.update({
    where: { id: metric.id },
    data: {
      comments: toInputJson(updated),
      commentCount: Math.max(0, (metric.commentCount ?? comments.length) - 1),
    },
  });
}

/** 从该发布记录的评论快照里找这条评论，用于日志/审计展示（找不到则返回基础信息）。 */
async function findStoredComment(attemptId: string, commentId: string) {
  const metric = await prisma.qZonePostMetric.findFirst({
    where: { publishAttemptId: attemptId },
    select: { comments: true },
  });
  const raw = metric?.comments;
  if (!Array.isArray(raw)) {
    return null;
  }
  for (const item of raw) {
    if (item && typeof item === "object" && (item as Record<string, unknown>).id === commentId) {
      const c = item as Record<string, unknown>;
      return {
        uin: typeof c.uin === "string" ? c.uin : "",
        name: typeof c.name === "string" ? c.name : "",
        contentPreview: typeof c.content === "string" ? c.content.slice(0, 40) : "",
      };
    }
  }
  return null;
}

/**
 * 评论管理插件路由：通过墙号（说说作者）删除已发布稿件在 QQ 空间的评论。
 * 管理员可删任意稿件评论；普通用户仅在插件允许时删除自己稿件下的评论。
 */
export function registerCommentModerationRoutes(app: FastifyInstance, queue: RuntimeQueue) {
  app.delete("/api/posts/:id/comments/:commentId", async (request, reply) => {
    const context = await requireReadyTenant(request, reply, "submitter");
    const params = commentParamsSchema.parse(request.params);
    const tenantId = context.selectedTenant.id;
    // 用于评论快照的 deletedBy 标记与日志展示
    const actorName = context.user.displayName || `用户${context.user.qqUin}`;
    const role = context.selectedMembership.role;

    const pluginConfig = await readTenantPluginConfig(prisma, tenantId);
    if (!pluginConfig.commentManagement.enabled) {
      return reply.code(403).send({ message: "评论管理插件未启用" });
    }

    const isAdmin = hasTenantRole(role, "admin");
    const post = await prisma.post.findFirst({
      where: { id: params.id, tenantId },
      select: {
        id: true,
        displayId: true,
        authorId: true,
        status: true,
        batchItem: {
          select: {
            batch: {
              select: {
                items: {
                  select: { post: { select: { authorId: true } } },
                },
              },
            },
          },
        },
      },
    });
    if (!post) {
      return reply.code(404).send({ message: "稿件不存在" });
    }
    if (!isAdmin) {
      if (!pluginConfig.commentManagement.allowUserDeleteOwnPostComments) {
        return reply.code(403).send({ message: "当前墙面未开放用户删除评论" });
      }
      if (post.authorId !== context.user.id) {
        return reply.code(403).send({ message: "只能删除自己稿件下的评论" });
      }
      // 批量稿件共享同一条说说，评论挂在这条说说上而无法按稿件归属区分；
      // 混合作者的批次若放行，用户会借自己稿件的授权删到他人稿件的评论。
      const batchAuthorIds = new Set(post.batchItem?.batch.items.map((item) => item.post.authorId) ?? []);
      if (batchAuthorIds.size > 1) {
        return reply.code(403).send({ message: "该稿件与其他用户稿件合并发布为同一条说说，评论无法按稿件区分归属，暂不支持删除" });
      }
    }

    const body = deleteBodySchema.parse(request.body ?? {});

    // 评论挂在各墙号自己的说说上，楼层号跨墙号可能重复：按前端传入的
    // attemptId 定位被点击目标的发布记录，只在它范围内删除，避免遍历全部
    // 目标时把其他墙号同楼层号的评论误删。
    const attempt = await prisma.publishAttempt.findFirst({
      where: {
        id: body.attemptId,
        postId: post.id,
        tenantId,
        status: "succeeded",
        qzoneTid: { not: null },
        publishTarget: { type: "qzone", enabled: true },
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
                  orderBy: { refreshedAt: "desc" },
                  take: 1,
                },
              },
            },
          },
        },
      },
    });
    if (!attempt) {
      return reply.code(404).send({ message: "评论所属的发布记录不存在或不可操作", results: [] satisfies CommentDeleteResult[] });
    }

    const storedComment = await findStoredComment(attempt.id, params.commentId);

    const targetName = attempt.publishTarget.displayName;
    const qzoneTid = attempt.qzoneTid ?? attempt.externalId ?? "";
    // QZone 删除是慢速网络调用，放在租户 lease 之外执行，避免长时间占用租约阻塞
    // 该墙的发布 / 指标刷新等任务；拿到结果后再用短暂 lease 原子持久化。
    let deleteResult: { ok: boolean; message: string; deleteVerbose: unknown };
    try {
      const session = attempt.publishTarget.botAccount.sessions[0] ?? null;
      if (!session) {
        throw new Error("这个发布目标还没有 QZone cookies");
      }
      if (session.healthStatus !== "available") {
        throw new Error(session.healthMessage ?? "QZone cookies 不可用");
      }
      const deleted = await deleteQZoneEmotionComment({
        targetName,
        externalId: qzoneTid,
        commentId: params.commentId,
        cookies: toCookieRecord(session.cookies),
      });
      deleteResult = { ok: true, message: "评论已删除", deleteVerbose: deleted.verbose };
    } catch (error) {
      deleteResult = {
        ok: false,
        message: error instanceof Error ? error.message : "删除失败",
        deleteVerbose: error instanceof QZoneCommentDeleteError ? error.verbose : null,
      };
    }

    const wiredResult: CommentDeleteResult = { targetId: attempt.publishTargetId, targetName, ok: deleteResult.ok, message: deleteResult.message };

    const leased = await runWithActiveTenantLease(prisma, tenantId, async (transaction) => {
      const verboseData = toInputJson({ previous: attempt.verbose, commentDelete: deleteResult.deleteVerbose });
      if (deleteResult.ok) {
        await transaction.publishAttempt.update({
          where: { id: attempt.id },
          data: { verbose: verboseData },
        });
        await markDeletedCommentInMetrics(transaction, attempt.id, params.commentId, actorName);
        await transaction.postLog.create({
          data: {
            tenantId,
            postId: post.id,
            actorId: context.user.id,
            oldStatus: post.status,
            newStatus: post.status,
            comment: `${targetName} 删除了评论（${storedComment?.name || storedComment?.uin || params.commentId}）`,
          },
        });
      } else {
        await transaction.postLog.create({
          data: {
            tenantId,
            postId: post.id,
            actorId: context.user.id,
            oldStatus: post.status,
            newStatus: post.status,
            comment: `${targetName} 删除评论失败：${deleteResult.message}`,
          },
        });
        if (deleteResult.deleteVerbose) {
          await transaction.publishAttempt.update({
            where: { id: attempt.id },
            data: { verbose: verboseData },
          });
        }
      }

      if (!deleteResult.ok) {
        await writeAuditLog({
          tenantId,
          actorId: context.user.id,
          action: "post.comment.delete.failed",
          targetType: "post",
          targetId: post.id,
          detail: {
            displayId: post.displayId,
            attemptId: attempt.id,
            commentId: params.commentId,
            commentUin: storedComment?.uin ?? null,
            results: [wiredResult],
          },
        }, transaction);
        return { ok: false as const, message: deleteResult.message, results: [wiredResult] };
      }

      await writeAuditLog({
        tenantId,
        actorId: context.user.id,
        action: "post.comment.delete",
        targetType: "post",
        targetId: post.id,
        detail: {
          displayId: post.displayId,
          attemptId: attempt.id,
          commentId: params.commentId,
          commentUin: storedComment?.uin ?? null,
          commentName: storedComment?.name ?? null,
          commentContentPreview: storedComment?.contentPreview ?? null,
          deletedByAdmin: isAdmin,
          results: [wiredResult],
        },
      }, transaction);
      return { ok: true as const, message: "评论已删除", results: [wiredResult] };
    });

    if (!leased.active) {
      return reply.code(403).send({ message: "校园墙已暂停或归档" });
    }
    if (!leased.value.ok) {
      return reply.code(502).send({ message: leased.value.message, results: leased.value.results });
    }

    // 成功后触发该发布目标的指标刷新，让网页端评论列表尽快同步。
    const now = new Date();
    const dedupeKey = `refreshQZonePostMetric:${attempt.id}`;
    const queued = queue.enqueueUnique({
      name: "refreshQZonePostMetric",
      tenantId,
      payload: { attemptId: attempt.id, force: true },
      runAt: now,
    }, dedupeKey);
    if (!queued) {
      // 已有排队任务时升级为强制刷新并立即执行，避免 force 意图被既有任务吞掉。
      queue.updateQueued(dedupeKey, { payload: { attemptId: attempt.id, force: true }, runAt: now });
    }

    return { ok: true, results: leased.value.results };
  });
}
