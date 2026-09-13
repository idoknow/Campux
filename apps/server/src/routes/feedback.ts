import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireTenantContext } from "../lib/auth";
import { writeAuditLog } from "../lib/audit";
import { prisma } from "../lib/prisma";
import { readTenantPluginConfig } from "../lib/tenant-plugin-config";
import type { OneBotRuntime } from "../runtime/onebot";

const feedbackBodySchema = z.object({
  content: z.string().trim().min(1, "请输入反馈内容").max(500, "反馈最多 500 字"),
});

const feedbackListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export function registerFeedbackRoutes(app: FastifyInstance, oneBot?: OneBotRuntime) {
  app.post("/api/feedback", async (request, reply) => {
    const context = await requireTenantContext(request, reply);
    const body = feedbackBodySchema.parse(request.body);

    const pluginConfig = await readTenantPluginConfig(prisma, context.selectedTenant.id);
    if (!pluginConfig.feedback.enabled) {
      return reply.code(404).send({ message: "意见反馈未开启" });
    }

    const content = body.content;
    const saved = await prisma.tenantFeedback.create({
      data: {
        tenantId: context.selectedTenant.id,
        authorId: context.user.id,
        content,
      },
    });

    await writeAuditLog({
      tenantId: context.selectedTenant.id,
      actorId: context.user.id,
      action: "tenant.feedback.submit",
      targetType: "feedback",
      targetId: saved.id,
      detail: {
        length: content.length,
        preview: content.slice(0, 80),
      },
    });

    const tenantName = context.selectedTenant.name;
    const displayName = context.user.displayName?.trim() || "未设置昵称";
    const qqUin = context.user.qqUin != null ? context.user.qqUin.toString() : "未知";
    const message = [
      `【意见反馈】${tenantName}`,
      `来自：${displayName}（QQ ${qqUin}）`,
      content,
    ].join("\n");

    const notified = oneBot
      ? await oneBot.sendTenantReviewNotification(context.selectedTenant.id, message)
      : false;

    if (!notified) {
      return reply.code(503).send({
        message: "意见已保存，但暂时无法送达审核群，请确认墙号在线且已配置审核群通知",
      });
    }

    return { ok: true, id: saved.id };
  });

  // 列表：管理员/reviewer 看本墙全部；普通用户只看自己的。
  app.get("/api/feedback", async (request, reply) => {
    const context = await requireTenantContext(request, reply);
    const query = feedbackListQuerySchema.parse(request.query);

    const pluginConfig = await readTenantPluginConfig(prisma, context.selectedTenant.id);
    if (!pluginConfig.feedback.enabled) {
      return reply.code(404).send({ message: "意见反馈未开启" });
    }

    const isReviewer =
      context.selectedMembership.role === "admin"
      || context.selectedMembership.role === "reviewer";

    const where = isReviewer
      ? { tenantId: context.selectedTenant.id }
      : { tenantId: context.selectedTenant.id, authorId: context.user.id };

    const [total, rows] = await Promise.all([
      prisma.tenantFeedback.count({ where }),
      prisma.tenantFeedback.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        include: {
          author: {
            select: {
              id: true,
              displayName: true,
              qqUin: true,
            },
          },
        },
      }),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        content: row.content,
        createdAt: row.createdAt.toISOString(),
        author: {
          id: row.author.id,
          displayName: row.author.displayName,
          qqUin: row.author.qqUin.toString(),
        },
        canViewIdentity: isReviewer,
      })),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        pageCount: Math.max(1, Math.ceil(total / query.limit)),
      },
      scope: isReviewer ? "all" : "mine",
    };
  });
}
