import type { FastifyInstance } from "fastify";
import type { PostStatus, Prisma } from "@campux/db";
import { insensitiveContains } from "@campux/db";
import { z } from "zod";
import { requireReadyTenant } from "../lib/auth";
import { toPostListItem, toPostTimeline } from "../lib/posts";
import { prisma } from "../lib/prisma";
import { writeAuditLog } from "../lib/audit";
import { executePostRecall, PostRecallExecutionError, PostRecallNotSupportedError } from "../lib/post-recall";
import { enqueuePublishFanout } from "../runtime/publishing";
import { addApprovedPostToBatch } from "../runtime/publish-batching";
import { readTenantPublishMode } from "../lib/tenant-metadata";
import { parsePostDisplayIdFilter } from "../lib/post-display-id-filter";
import type { RuntimeQueue } from "../runtime/queue";
import type { OneBotRuntime } from "../runtime/onebot";

const postParamsSchema = z.object({
  id: z.string().min(1),
});

const reviewBodySchema = z.object({
  comment: z.string().max(500).optional(),
});

const reviewQuerySchema = z.object({
  status: z.enum(["all", "pending_approval", "approved", "rejected", "publishing", "partially_failed", "failed", "published", "pending_recall", "pending_recall_ignored", "recalled"]).default("pending_approval"),
  q: z.string().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export function registerReviewRoutes(app: FastifyInstance, queue: RuntimeQueue, oneBot?: OneBotRuntime) {
  app.get("/api/review/posts", async (request, reply) => {
    const context = await requireReadyTenant(request, reply, "reviewer");
    const query = reviewQuerySchema.parse(request.query);
    const displayId = parsePostDisplayIdFilter(query.q);
    const qqUin = query.q && /^\d+$/.test(query.q) ? BigInt(query.q) : null;
    const concreteStatus = query.status === "pending_recall_ignored" ? "pending_recall" : query.status;
    const statusWhere: Prisma.PostWhereInput =
      query.status === "all"
        ? {}
        : query.status === "pending_recall"
          ? { status: "pending_recall", recallIgnored: false }
          : query.status === "pending_recall_ignored"
            ? { status: "pending_recall", recallIgnored: true }
            : { status: concreteStatus as PostStatus };
    const where: Prisma.PostWhereInput = {
      tenantId: context.selectedTenant.id,
      ...statusWhere,
      ...(query.q
        ? {
            OR: [
              {
                text: insensitiveContains(query.q),
              },
              ...(displayId === null ? [] : [{ displayId }]),
              ...(qqUin === null ? [] : [{ author: { qqUin } }]),
              {
                author: {
                  displayName: insensitiveContains(query.q),
                },
              },
            ],
          }
        : {}),
    };
    const [total, posts] = await Promise.all([
      prisma.post.count({ where }),
      prisma.post.findMany({
        where,
        include: {
          author: true,
          logs: {
            orderBy: {
              createdAt: "asc",
            },
          },
          tagAssignments: {
            include: {
              tag: true,
            },
            orderBy: {
              createdAt: "asc",
            },
          },
          qzonePostMetrics: {
            include: {
              publishAttempt: {
                select: {
                  publishTarget: {
                    select: {
                      displayName: true,
                      botAccount: {
                        select: {
                          displayName: true,
                          qqUin: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          batchItem: {
            select: {
              batch: {
                select: {
                  status: true,
                  items: {
                    select: { post: { select: { displayId: true } } },
                  },
                },
              },
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);

    // 解析时间线里出现的操作人（actorId → 用户名/QQ），系统自动操作 actorId 为 null。
    const actorIds = [...new Set(posts.flatMap((post) => post.logs.map((log) => log.actorId).filter((id): id is string => Boolean(id))))];
    const actorRows = actorIds.length > 0
      ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, displayName: true, qqUin: true } })
      : [];
    const actorMap = new Map(actorRows.map((u) => [u.id, { displayName: u.displayName, qqUin: u.qqUin.toString() }]));

    return {
      posts: posts.map((post) => ({
        ...toPostListItem(post),
        author: {
          id: post.author.id,
          qqUin: post.author.qqUin.toString(),
          displayName: post.author.displayName,
        },
        timeline: toPostTimeline(post.logs, actorMap),
      })),
      pagination: toPagination(query.page, query.limit, total),
    };
  });

  app.post("/api/review/posts/:id/approve", async (request, reply) => {
    const context = await requireReadyTenant(request, reply, "reviewer");
    const params = postParamsSchema.parse(request.params);
    const body = reviewBodySchema.parse(request.body ?? {});
    const post = await prisma.post.findFirst({
      where: {
        id: params.id,
        tenantId: context.selectedTenant.id,
      },
    });

    if (!post) {
      return reply.code(404).send({ message: "稿件不存在" });
    }
    if (post.status !== "pending_approval") {
      return reply.code(409).send({ message: "只有待审核稿件可以通过" });
    }

    await prisma.post.update({
      where: {
        id: post.id,
      },
      data: {
        status: "approved",
        logs: {
          create: {
            tenantId: context.selectedTenant.id,
            actorId: context.user.id,
            oldStatus: post.status,
            newStatus: "approved",
            comment: body.comment?.trim() || "审核通过",
          },
        },
      },
    });

    await writeAuditLog({
      tenantId: context.selectedTenant.id,
      actorId: context.user.id,
      action: "post.approve",
      targetType: "post",
      targetId: post.id,
      detail: {
        displayId: post.displayId,
      },
    });
    const publishMode = await readTenantPublishMode(prisma, context.selectedTenant.id);
    if (publishMode.mode === "accumulate") {
      await addApprovedPostToBatch(queue, context.selectedTenant.id, post.id, context.user.id, request.log);
    } else {
      await enqueuePublishFanout(queue, context.selectedTenant.id, post.id, context.user.id);
    }

    return {
      ok: true,
    };
  });

  // 一键通过当前墙下所有待审核稿件。前端会在调用前弹确认框，要求审核员确认已逐个审核过。
  app.post("/api/review/posts/approve-all", async (request, reply) => {
    const context = await requireReadyTenant(request, reply, "reviewer");
    const pending = await prisma.post.findMany({
      where: {
        tenantId: context.selectedTenant.id,
        status: "pending_approval",
      },
      select: { id: true, displayId: true, status: true },
      orderBy: { createdAt: "asc" },
    });

    if (pending.length === 0) {
      return { ok: true, approved: 0 };
    }

    const publishMode = await readTenantPublishMode(prisma, context.selectedTenant.id);
    let approved = 0;

    for (const post of pending) {
      // 逐个用 updateMany 带状态守卫，避免并发下重复通过已被处理的稿件。
      const result = await prisma.post.updateMany({
        where: { id: post.id, status: "pending_approval" },
        data: { status: "approved" },
      });
      if (result.count === 0) {
        continue;
      }

      await prisma.postLog.create({
        data: {
          postId: post.id,
          tenantId: context.selectedTenant.id,
          actorId: context.user.id,
          oldStatus: "pending_approval",
          newStatus: "approved",
          comment: "一键通过",
        },
      });

      await writeAuditLog({
        tenantId: context.selectedTenant.id,
        actorId: context.user.id,
        action: "post.approve",
        targetType: "post",
        targetId: post.id,
        detail: {
          displayId: post.displayId,
          bulk: true,
        },
      });

      if (publishMode.mode === "accumulate") {
        await addApprovedPostToBatch(queue, context.selectedTenant.id, post.id, context.user.id, request.log);
      } else {
        await enqueuePublishFanout(queue, context.selectedTenant.id, post.id, context.user.id);
      }
      approved += 1;
    }

    return { ok: true, approved };
  });

  app.post("/api/review/posts/:id/reject", async (request, reply) => {
    const context = await requireReadyTenant(request, reply, "reviewer");
    const params = postParamsSchema.parse(request.params);
    const body = reviewBodySchema.parse(request.body ?? {});
    const post = await prisma.post.findFirst({
      where: {
        id: params.id,
        tenantId: context.selectedTenant.id,
      },
    });

    if (!post) {
      return reply.code(404).send({ message: "稿件不存在" });
    }
    if (post.status !== "pending_approval") {
      return reply.code(409).send({ message: "只有待审核稿件可以拒绝" });
    }

    const updated = await prisma.post.update({
      where: {
        id: post.id,
      },
      data: {
        status: "rejected",
        logs: {
          create: {
            tenantId: context.selectedTenant.id,
            actorId: context.user.id,
            oldStatus: post.status,
            newStatus: "rejected",
            comment: body.comment?.trim() || "审核拒绝",
          },
        },
      },
    });

    await writeAuditLog({
      tenantId: context.selectedTenant.id,
      actorId: context.user.id,
      action: "post.reject",
      targetType: "post",
      targetId: post.id,
      detail: {
        displayId: post.displayId,
        comment: body.comment?.trim() || null,
      },
    });
    oneBot?.notifyReviewResult(updated.id, "rejected", body.comment?.trim() || "审核拒绝").catch((error) => {
      app.log.warn({ error, postId: updated.id }, "failed to notify review rejection");
    });

    return {
      ok: true,
    };
  });

  app.post("/api/review/posts/:id/recall/approve", async (request, reply) => {
    const context = await requireReadyTenant(request, reply, "reviewer");
    const params = postParamsSchema.parse(request.params);
    const post = await prisma.post.findFirst({
      where: {
        id: params.id,
        tenantId: context.selectedTenant.id,
      },
    });

    if (!post) {
      return reply.code(404).send({ message: "稿件不存在" });
    }
    if (post.status !== "pending_recall") {
      return reply.code(409).send({ message: "只有待撤回稿件可以执行撤回" });
    }

    try {
      const result = await executePostRecall({
        tenantId: context.selectedTenant.id,
        postId: post.id,
        actorId: context.user.id,
        logger: app.log,
      });
      oneBot?.notifyPostRecalled(result.post.id, result.results.length).catch((error) => {
        app.log.warn({ error, postId: result.post.id }, "failed to notify post recalled");
      });
      return {
        ok: true,
        results: result.results,
      };
    } catch (error) {
      if (error instanceof PostRecallNotSupportedError) {
        return reply.code(409).send({ message: error.message });
      }
      if (error instanceof PostRecallExecutionError) {
        oneBot?.notifyPostRecallFailed(post.id, error.results).catch((caught) => {
          app.log.warn({ error: caught, postId: post.id }, "failed to notify post recall failure");
        });
        return reply.code(502).send({
          message: "部分发布目标撤回失败，请检查日志后重试",
          results: error.results,
        });
      }
      throw error;
    }
  });

  app.post("/api/review/posts/:id/recall/reject", async (request, reply) => {
    const context = await requireReadyTenant(request, reply, "reviewer");
    const params = postParamsSchema.parse(request.params);
    const body = reviewBodySchema.parse(request.body ?? {});
    const post = await prisma.post.findFirst({
      where: {
        id: params.id,
        tenantId: context.selectedTenant.id,
      },
    });

    if (!post) {
      return reply.code(404).send({ message: "稿件不存在" });
    }
    if (post.status !== "pending_recall") {
      return reply.code(409).send({ message: "只有待撤回稿件可以拒绝撤回申请" });
    }

    await prisma.post.update({
      where: {
        id: post.id,
      },
      data: {
        status: "published",
        recallIgnored: false,
        recallIgnoredAt: null,
        logs: {
          create: {
            tenantId: context.selectedTenant.id,
            actorId: context.user.id,
            oldStatus: post.status,
            newStatus: "published",
            comment: body.comment?.trim() || "拒绝撤回申请",
          },
        },
      },
    });

    await writeAuditLog({
      tenantId: context.selectedTenant.id,
      actorId: context.user.id,
      action: "post.recall.reject",
      targetType: "post",
      targetId: post.id,
      detail: {
        displayId: post.displayId,
        comment: body.comment?.trim() || null,
      },
    });

    oneBot?.notifyPostRecallRejected(post.id, body.comment?.trim() || "撤回申请未通过").catch((error) => {
      app.log.warn({ error, postId: post.id }, "failed to notify post recall rejection");
    });

    return {
      ok: true,
    };
  });

  app.post("/api/review/posts/:id/recall/ignore", async (request, reply) => {
    const context = await requireReadyTenant(request, reply, "reviewer");
    const params = postParamsSchema.parse(request.params);
    const post = await prisma.post.findFirst({
      where: {
        id: params.id,
        tenantId: context.selectedTenant.id,
      },
    });

    if (!post) {
      return reply.code(404).send({ message: "稿件不存在" });
    }
    if (post.status !== "pending_recall") {
      return reply.code(409).send({ message: "只有待撤回稿件可以忽略" });
    }
    if (post.recallIgnored) {
      return { ok: true };
    }

    await prisma.post.update({
      where: {
        id: post.id,
      },
      data: {
        recallIgnored: true,
        recallIgnoredAt: new Date(),
        logs: {
          create: {
            tenantId: context.selectedTenant.id,
            actorId: context.user.id,
            oldStatus: post.status,
            newStatus: post.status,
            comment: "忽略撤回申请",
          },
        },
      },
    });

    await writeAuditLog({
      tenantId: context.selectedTenant.id,
      actorId: context.user.id,
      action: "post.recall.ignore",
      targetType: "post",
      targetId: post.id,
      detail: {
        displayId: post.displayId,
      },
    });

    return {
      ok: true,
    };
  });

  const adminRecallBodySchema = z.object({
    silent: z.boolean().optional(),
  });

  app.post("/api/review/posts/:id/recall/admin", async (request, reply) => {
    const context = await requireReadyTenant(request, reply, "admin");
    const params = postParamsSchema.parse(request.params);
    const body = adminRecallBodySchema.parse(request.body ?? {});
    const post = await prisma.post.findFirst({
      where: {
        id: params.id,
        tenantId: context.selectedTenant.id,
      },
    });

    if (!post) {
      return reply.code(404).send({ message: "稿件不存在" });
    }
    if (post.status !== "published") {
      return reply.code(409).send({ message: "只有已发表稿件可以直接撤回" });
    }

    const silent = body.silent === true;

    try {
      const result = await executePostRecall({
        tenantId: context.selectedTenant.id,
        postId: post.id,
        actorId: context.user.id,
        logger: app.log,
      });
      oneBot?.notifyPostRecalled(result.post.id, result.results.length, { skipAuthor: silent }).catch((error) => {
        app.log.warn({ error, postId: result.post.id }, "failed to notify post recalled");
      });
      return {
        ok: true,
        silent,
        results: result.results,
      };
    } catch (error) {
      if (error instanceof PostRecallNotSupportedError) {
        return reply.code(409).send({ message: error.message });
      }
      if (error instanceof PostRecallExecutionError) {
        oneBot?.notifyPostRecallFailed(post.id, error.results).catch((caught) => {
          app.log.warn({ error: caught, postId: post.id }, "failed to notify post recall failure");
        });
        return reply.code(502).send({
          message: "部分发布目标撤回失败，请检查日志后重试",
          results: error.results,
        });
      }
      throw error;
    }
  });
}

function toPagination(page: number, limit: number, total: number) {
  return {
    page,
    limit,
    total,
    pageCount: Math.max(1, Math.ceil(total / limit)),
  };
}
