import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireTenantRole } from "../lib/auth";
import { toPostListItem } from "../lib/posts";
import { prisma } from "../lib/prisma";
import { writeAuditLog } from "../lib/audit";
import { enqueuePublishFanout } from "../runtime/publishing";
import type { RuntimeQueue } from "../runtime/queue";

const postParamsSchema = z.object({
  id: z.string().min(1),
});

const reviewBodySchema = z.object({
  comment: z.string().max(500).optional(),
});

export function registerReviewRoutes(app: FastifyInstance, queue: RuntimeQueue) {
  app.get("/api/review/posts", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "reviewer");
    const posts = await prisma.post.findMany({
      where: {
        tenantId: context.selectedTenant.id,
        status: "pending_approval",
      },
      include: {
        author: true,
      },
      orderBy: {
        createdAt: "asc",
      },
      take: 100,
    });

    return {
      posts: posts.map((post) => ({
        ...toPostListItem(post),
        author: post.anonymous
          ? null
          : {
              id: post.author.id,
              qqUin: post.author.qqUin.toString(),
              displayName: post.author.displayName,
            },
      })),
    };
  });

  app.post("/api/review/posts/:id/approve", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "reviewer");
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

    await enqueuePublishFanout(queue, context.selectedTenant.id, post.id, context.user.id);

    return {
      ok: true,
    };
  });

  app.post("/api/review/posts/:id/reject", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "reviewer");
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

    await prisma.post.update({
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

    return {
      ok: true,
    };
  });
}
