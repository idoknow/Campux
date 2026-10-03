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

/** 从存储的评论指标里找这条评论，用于日志/审计展示（找不到则返回基础信息）。 */
async function findStoredComment(tenantId: string, postId: string, commentId: string) {
  const metrics = await prisma.qZonePostMetric.findMany({
    where: { tenantId, postId },
    select: { comments: true },
  });
  for (const metric of metrics) {
    const raw = metric.comments;
    if (!Array.isArray(raw)) {
      continue;
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
      select: { id: true, displayId: true, authorId: true, status: true },
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
    }

    const storedComment = await findStoredComment(tenantId, post.id, params.commentId);

    const leased = await runWithActiveTenantLease(prisma, tenantId, async (transaction) => {
      const attempts = await transaction.publishAttempt.findMany({
        where: {
          postId: post.id,
          status: "succeeded",
          qzoneTid: { not: null },
          publishTarget: {
            type: "qzone",
            enabled: true,
          },
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
        orderBy: { updatedAt: "asc" },
      });

      if (attempts.length === 0) {
        return { ok: false as const, message: "这篇稿件没有可操作的 QZone 发布记录", results: [] satisfies CommentDeleteResult[] };
      }

      const results: CommentDeleteResult[] = [];
      for (const attempt of attempts) {
        const targetName = attempt.publishTarget.displayName;
        const qzoneTid = attempt.qzoneTid ?? attempt.externalId ?? "";
        try {
          const session = attempt.publishTarget.botAccount.sessions[0] ?? null;
          if (!session) {
            throw new Error("这个发布目标还没有 QZone cookies");
          }
          if (session.healthStatus !== "available") {
            throw new Error(session.healthMessage ?? "QZone cookies 不可用");
          }

          let deleteVerbose: unknown = null;
          try {
            const deleted = await deleteQZoneEmotionComment({
              targetName,
              externalId: qzoneTid,
              commentId: params.commentId,
              cookies: toCookieRecord(session.cookies),
            });
            deleteVerbose = deleted.verbose;
          } catch (error) {
            // 评论可能只存在于其中一个墙号的空间里：逐个目标尝试，
            // “评论不存在”类失败记录下来，但只要有任一目标成功即视为成功。
            const message = error instanceof Error ? error.message : "删除失败";
            await transaction.postLog.create({
              data: {
                tenantId,
                postId: post.id,
                actorId: context.user.id,
                oldStatus: post.status,
                newStatus: post.status,
                comment: `${targetName} 删除评论失败：${message}`,
              },
            });
            if (error instanceof QZoneCommentDeleteError) {
              await transaction.publishAttempt.update({
                where: { id: attempt.id },
                data: { verbose: toInputJson({ previous: attempt.verbose, commentDelete: error.verbose }) },
              });
            }
            results.push({ targetId: attempt.publishTargetId, targetName, ok: false, message });
            continue;
          }

          await transaction.publishAttempt.update({
            where: { id: attempt.id },
            data: { verbose: toInputJson({ previous: attempt.verbose, commentDelete: deleteVerbose }) },
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
          results.push({ targetId: attempt.publishTargetId, targetName, ok: true, message: "评论已删除" });
        } catch (error) {
          const message = error instanceof Error ? error.message : "删除失败";
          await transaction.postLog.create({
            data: {
              tenantId,
              postId: post.id,
              actorId: context.user.id,
              oldStatus: post.status,
              newStatus: post.status,
              comment: `${targetName} 删除评论失败：${message}`,
            },
          });
          results.push({ targetId: attempt.publishTargetId, targetName, ok: false, message });
        }
      }

      if (!results.some((result) => result.ok)) {
        await writeAuditLog({
          tenantId,
          actorId: context.user.id,
          action: "post.comment.delete.failed",
          targetType: "post",
          targetId: post.id,
          detail: {
            displayId: post.displayId,
            commentId: params.commentId,
            commentUin: storedComment?.uin ?? null,
            results,
          },
        }, transaction);
        return { ok: false as const, message: results[0]?.message ?? "评论删除失败", results };
      }

      await writeAuditLog({
        tenantId,
        actorId: context.user.id,
        action: "post.comment.delete",
        targetType: "post",
        targetId: post.id,
        detail: {
          displayId: post.displayId,
          commentId: params.commentId,
          commentUin: storedComment?.uin ?? null,
          commentName: storedComment?.name ?? null,
          commentContentPreview: storedComment?.contentPreview ?? null,
          deletedByAdmin: isAdmin,
          results,
        },
      }, transaction);
      return { ok: true as const, message: "评论已删除", results };
    });

    if (!leased.active) {
      return reply.code(403).send({ message: "校园墙已暂停或归档" });
    }
    if (!leased.value.ok) {
      return reply.code(502).send({ message: leased.value.message, results: leased.value.results });
    }

    // 成功后触发这些发布目标的指标刷新，让网页端评论列表尽快同步。
    const now = new Date();
    for (const attempt of await prisma.publishAttempt.findMany({
      where: { postId: post.id, status: "succeeded", qzoneTid: { not: null } },
      select: { id: true },
      take: 10,
    })) {
      queue.enqueueUnique({
        name: "refreshQZonePostMetric",
        tenantId,
        payload: { attemptId: attempt.id, force: true },
        runAt: now,
      }, `refreshQZonePostMetric:${attempt.id}`);
    }

    return { ok: true, results: leased.value.results };
  });
}
