import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireTenantContext } from "../lib/auth";
import { writeAuditLog } from "../lib/audit";
import { prisma } from "../lib/prisma";
import { readTenantPluginConfig } from "../lib/tenant-plugin-config";
import { formatFeedbackUserReplyNotice, escapeCqCode } from "../lib/bot-messages";
import type { OneBotRuntime } from "../runtime/onebot";

const feedbackBodySchema = z.object({
  content: z.string().trim().min(1, "请输入反馈内容").max(500, "反馈最多 500 字"),
});

const feedbackReplyBodySchema = z.object({
  content: z.string().trim().min(1, "请输入回复内容").max(500, "回复最多 500 字"),
});

const feedbackListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

function serializeFeedbackAuthor(author: { id: string; displayName: string | null; qqUin: bigint }) {
  return {
    id: author.id,
    displayName: author.displayName,
    qqUin: author.qqUin.toString(),
  };
}

export function registerFeedbackRoutes(app: FastifyInstance, oneBot?: OneBotRuntime) {
  app.post("/api/feedback", async (request, reply) => {
    const context = await requireTenantContext(request, reply);
    const body = feedbackBodySchema.parse(request.body);

    const pluginConfig = await readTenantPluginConfig(prisma, context.selectedTenant.id);
    if (!pluginConfig.feedback.enabled) {
      return reply.code(404).send({ message: "意见反馈未开启" });
    }

    const content = body.content;
    const displayName = context.user.displayName?.trim() || "未设置昵称";
    const qqUin = context.user.qqUin != null ? context.user.qqUin.toString() : "未知";

    const saved = await prisma.tenantFeedback.create({
      data: {
        tenantId: context.selectedTenant.id,
        authorId: context.user.id,
        content,
        messages: {
          create: {
            tenantId: context.selectedTenant.id,
            role: "user",
            authorId: context.user.id,
            authorLabel: displayName,
            content,
          },
        },
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

    const tenantName = escapeCqCode(context.selectedTenant.name);
    const message = [
      `【意见反馈】${tenantName}`,
      `来自：${escapeCqCode(displayName)}（QQ ${qqUin}）`,
      escapeCqCode(content),
    ].join("\n");

    const notified = oneBot
      ? await oneBot.sendTenantReviewNotification(context.selectedTenant.id, message)
      : { ok: false, messageId: null };

    // Feedback is already durable. Partial success avoids 503 retries that
    // would insert a duplicate row when only the review-group notify fails.
    if (!notified.ok) {
      return reply.code(202).send({
        ok: true,
        id: saved.id,
        message: "意见已保存，但暂时无法送达审核群，请确认墙号在线且已配置审核群通知",
      });
    }

    return { ok: true, id: saved.id };
  });

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
          messages: {
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              role: true,
              authorLabel: true,
              content: true,
              createdAt: true,
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
        author: serializeFeedbackAuthor(row.author),
        canViewIdentity: isReviewer,
        messages: row.messages.map((message) => ({
          id: message.id,
          role: message.role as "user" | "admin",
          authorLabel: message.authorLabel,
          content: message.content,
          createdAt: message.createdAt.toISOString(),
        })),
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

  // 用户在网站「意见」页回复管理员 → 落库并通知审核群。
  app.post("/api/feedback/:id/reply", async (request, reply) => {
    const context = await requireTenantContext(request, reply);
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = feedbackReplyBodySchema.parse(request.body);

    const pluginConfig = await readTenantPluginConfig(prisma, context.selectedTenant.id);
    if (!pluginConfig.feedback.enabled) {
      return reply.code(404).send({ message: "意见反馈未开启" });
    }

    const isReviewer =
      context.selectedMembership.role === "admin"
      || context.selectedMembership.role === "reviewer";

    const feedback = await prisma.tenantFeedback.findFirst({
      where: {
        id: params.id,
        tenantId: context.selectedTenant.id,
        ...(isReviewer ? {} : { authorId: context.user.id }),
      },
      include: {
        author: {
          select: { id: true, displayName: true, qqUin: true },
        },
      },
    });
    if (!feedback) {
      return reply.code(404).send({ message: "意见不存在或无权回复" });
    }

    const displayName = context.user.displayName?.trim() || "未设置昵称";
    const qqUin = context.user.qqUin != null ? context.user.qqUin.toString() : "未知";
    const role = isReviewer && feedback.authorId !== context.user.id ? "admin" : "user";

    await prisma.tenantFeedbackMessage.create({
      data: {
        feedbackId: feedback.id,
        tenantId: context.selectedTenant.id,
        role,
        authorId: context.user.id,
        authorLabel: displayName,
        content: body.content,
      },
    });

    await writeAuditLog({
      tenantId: context.selectedTenant.id,
      actorId: context.user.id,
      action: "tenant.feedback.reply",
      targetType: "feedback",
      targetId: feedback.id,
      detail: { role, preview: body.content.slice(0, 80) },
    });

    // 用户回复 → 审核群提醒（意见 + 用户 + QQ + 最近 5 条对话）
    if (role === "user" && oneBot) {
      const recentMessages = await prisma.tenantFeedbackMessage.findMany({
        where: { feedbackId: feedback.id },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { role: true, content: true, createdAt: true },
      });
      const recent = recentMessages
        .reverse()
        .map((message) => ({
          role: message.role as "user" | "admin",
          content: message.content,
        }));
      const notice = formatFeedbackUserReplyNotice({
        feedbackContent: feedback.content.length > 120
          ? `${feedback.content.slice(0, 120)}…`
          : feedback.content,
        userNickname: displayName,
        qqUin,
        recentMessages: recent,
      });
      const notified = await oneBot.sendTenantReviewNotification(context.selectedTenant.id, notice);
      if (!notified.ok) {
        return reply.code(202).send({
          ok: true,
          role,
          message: "回复已保存，但暂时无法送达审核群，请确认墙号在线且已配置审核群通知",
        });
      }
    }

    return { ok: true, role };
  });
}
