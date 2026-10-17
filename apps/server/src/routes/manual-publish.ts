import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireTenantRole } from "../lib/auth";
import { prisma } from "../lib/prisma";
import { writeAuditLog } from "../lib/audit";
import { readTenantOperateMode, readTenantPublishMode } from "../lib/tenant-metadata";
import { enqueuePublishFanout } from "../runtime/publishing";
import { addApprovedPostToBatch } from "../runtime/publish-batching";
import type { RuntimeQueue } from "../runtime/queue";

const postParamsSchema = z.object({
  id: z.string().min(1),
});

const pendingListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

const batchConfirmSchema = z.object({
  // 为空表示确认当前过滤条件下的全部待发布稿件。
  ids: z.array(z.string().min(1)).max(200).optional(),
});

/** 待发布队列的过滤条件：已自动发布入队（入批或有发布尝试）的稿件不重复列出。 */
function pendingPublishWhere(tenantId: string) {
  return {
    tenantId,
    status: "approved" as const,
    publishAttempts: { none: {} },
    batchItem: { is: null },
  };
}

/**
 * 无 Bot 模式（operate_mode=manual）的发布任务：
 * 审核通过的稿件不进入自动发布队列，而是留在 status=approved，
 * 由管理员在「稿件 · 待发布」里逐条渲染、保存图片、手动发到 QQ 空间，
 * 再回到页面点「确认已发布」把状态推进到 published，归入已发布分组。
 */
export function registerManualPublishRoutes(app: FastifyInstance, queue: RuntimeQueue) {
  app.get("/api/admin/pending-publish", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    const query = pendingListQuerySchema.parse(request.query);
    const where = pendingPublishWhere(context.selectedTenant.id);
    const [total, posts] = await Promise.all([
      prisma.post.count({ where }),
      prisma.post.findMany({
        where,
        select: {
          id: true,
          displayId: true,
          text: true,
          anonymous: true,
          attachments: true,
          createdAt: true,
          author: {
            select: {
              id: true,
              qqUin: true,
              displayName: true,
            },
          },
        },
        orderBy: {
          createdAt: "asc",
        },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);

    return {
      posts: posts.map((post) => ({
        id: post.id,
        displayId: post.displayId,
        text: post.text,
        anonymous: post.anonymous,
        attachmentCount: Array.isArray(post.attachments) ? post.attachments.length : 0,
        createdAt: post.createdAt.toISOString(),
        author: {
          id: post.author.id,
          qqUin: post.author.qqUin.toString(),
          displayName: post.author.displayName,
        },
      })),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        pageCount: Math.max(1, Math.ceil(total / query.limit)),
      },
    };
  });

  app.post("/api/admin/pending-publish/:id/confirm", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    const params = postParamsSchema.parse(request.params);
    const operateMode = await readTenantOperateMode(prisma, context.selectedTenant.id);
    const post = await prisma.post.findFirst({
      where: {
        id: params.id,
        tenantId: context.selectedTenant.id,
      },
      select: {
        id: true,
        displayId: true,
        status: true,
        batchItem: { select: { id: true } },
        publishAttempts: { select: { id: true }, take: 1 },
      },
    });

    if (!post) {
      return reply.code(404).send({ message: "稿件不存在" });
    }
    if (post.status !== "approved") {
      return reply.code(409).send({ message: "只有待发布稿件可以确认发布" });
    }
    // 自动发布模式下的稿件不能绕过发布队列：只有真正滞留（未入批、无尝试）的才允许确认。
    if (operateMode !== "manual" && (post.batchItem !== null || post.publishAttempts.length > 0)) {
      return reply.code(409).send({ message: "该稿件已在自动发布流程中" });
    }

    await prisma.$transaction(async (transaction) => {
      await transaction.post.update({
        where: { id: post.id },
        data: {
          status: "published",
          publishSummary: "管理员手动发布",
          logs: {
            create: {
              tenantId: context.selectedTenant.id,
              actorId: context.user.id,
              oldStatus: "approved",
              newStatus: "published",
              comment: "管理员确认已手动发布",
            },
          },
        },
      });
      await writeAuditLog({
        tenantId: context.selectedTenant.id,
        actorId: context.user.id,
        action: "post.manual_publish",
        targetType: "post",
        targetId: post.id,
        detail: { displayId: post.displayId },
      }, transaction);
    });

    return { ok: true };
  });

  // 多选 / 一键确认：把选中的（或当前全部）待发布稿件批量推进到 published。
  // 逐条独立处理：单条不在 approved / 已被自动队列接手 / 被并发推进时只记录到 failures，
  // 不影响其余稿件，前端据此列出失败的稿件号与原因。
  app.post("/api/admin/pending-publish/confirm", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    const body = batchConfirmSchema.parse(request.body ?? {});
    const where = body.ids && body.ids.length > 0
      ? { ...pendingPublishWhere(context.selectedTenant.id), id: { in: body.ids } }
      : pendingPublishWhere(context.selectedTenant.id);

    const targets = await prisma.post.findMany({
      where,
      select: { id: true, displayId: true },
      orderBy: { createdAt: "asc" },
    });

    // 显式点名但已不在待发布队列的稿件也要告诉调用方，而不是静默丢弃。
    const foundIds = new Set(targets.map((target) => target.id));
    const failures: Array<{ id: string; displayId: number | null; reason: string; code: "NOT_PENDING" | "CONFLICT" }> = [];
    if (body.ids && body.ids.length > 0) {
      const missing = await prisma.post.findMany({
        where: { tenantId: context.selectedTenant.id, id: { in: body.ids.filter((id) => !foundIds.has(id)) } },
        select: { id: true, displayId: true },
      });
      const missingById = new Map(missing.map((post) => [post.id, post.displayId]));
      for (const id of body.ids) {
        if (!foundIds.has(id)) {
          failures.push({
            id,
            displayId: missingById.get(id) ?? null,
            reason: missingById.has(id) ? "稿件已不在待发布状态（可能已被发布或进入自动队列）" : "稿件不存在或不属于当前校园墙",
            code: "NOT_PENDING",
          });
        }
      }
    }

    const confirmedIds: string[] = [];
    const confirmedDisplayIds: number[] = [];
    for (const target of targets) {
      // 每条一个事务：单条失败不回滚已成功的其余稿件。
      try {
        const done = await prisma.$transaction(async (transaction) => {
          // updateMany 带状态条件：并发下被别处推进/撤回的稿件不会误写。
          const updated = await transaction.post.updateMany({
            where: { id: target.id, status: "approved" },
            data: {
              status: "published",
              publishSummary: "管理员手动发布",
            },
          });
          if (updated.count === 0) {
            return false;
          }
          await transaction.postLog.create({
            data: {
              postId: target.id,
              tenantId: context.selectedTenant.id,
              actorId: context.user.id,
              oldStatus: "approved",
              newStatus: "published",
              comment: "管理员确认已手动发布（批量）",
            },
          });
          return true;
        });
        if (done) {
          confirmedIds.push(target.id);
          confirmedDisplayIds.push(target.displayId);
        } else {
          failures.push({
            id: target.id,
            displayId: target.displayId,
            reason: "状态已变化，不再是可以确认的待发布稿",
            code: "CONFLICT",
          });
        }
      } catch (error) {
        request.log.error({ err: error, postId: target.id }, "batch manual publish failed");
        failures.push({
          id: target.id,
          displayId: target.displayId,
          reason: error instanceof Error ? error.message : "写入失败",
          code: "CONFLICT",
        });
      }
    }

    if (confirmedIds.length > 0) {
      await writeAuditLog({
        tenantId: context.selectedTenant.id,
        actorId: context.user.id,
        action: "post.manual_publish",
        targetType: "post",
        targetId: confirmedIds[0] ?? null,
        detail: {
          count: confirmedIds.length,
          bulk: true,
          postIds: confirmedIds.slice(0, 50),
          failed: failures.length,
        },
      });
    }

    return {
      ok: true,
      confirmed: confirmedIds.length,
      confirmedDisplayIds,
      failed: failures.length,
      failures,
    };
  });

  // manual → bot 切换后，审核通过但从未进入发布队列的稿件会滞留。
  // 这里给出滞留数量，并提供一键补入自动发布队列（按当前发布模式入批或入队）。
  app.get("/api/admin/pending-publish/residual", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    const operateMode = await readTenantOperateMode(prisma, context.selectedTenant.id);
    const total = await prisma.post.count({ where: pendingPublishWhere(context.selectedTenant.id) });
    return { operateMode, residual: total };
  });

  app.post("/api/admin/pending-publish/requeue", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    const operateMode = await readTenantOperateMode(prisma, context.selectedTenant.id);
    if (operateMode === "manual") {
      return reply.code(409).send({ message: "当前为无 Bot 模式，滞留稿件应在待发布页手动发布" });
    }

    const publishMode = await readTenantPublishMode(prisma, context.selectedTenant.id);
    const targets = await prisma.post.findMany({
      where: pendingPublishWhere(context.selectedTenant.id),
      select: { id: true, displayId: true },
      orderBy: { createdAt: "asc" },
    });

    let enqueued = 0;
    for (const target of targets) {
      try {
        if (publishMode.mode === "accumulate") {
          await addApprovedPostToBatch(queue, context.selectedTenant.id, target.id, context.user.id, request.log);
        } else {
          await enqueuePublishFanout(queue, context.selectedTenant.id, target.id, context.user.id);
        }
        enqueued += 1;
      } catch (error) {
        // 单条失败（如租户被暂停）不应阻断其余滞留稿件，但留日志便于排查。
        request.log.error({ err: error, postId: target.id }, "residual requeue failed");
      }
    }

    if (enqueued > 0) {
      await writeAuditLog({
        tenantId: context.selectedTenant.id,
        actorId: context.user.id,
        action: "post.manual_requeue",
        targetType: "post",
        targetId: targets[0]?.id ?? null,
        detail: { count: enqueued, publishMode: publishMode.mode },
      });
    }

    return { ok: true, enqueued, total: targets.length };
  });
}
