import type { FastifyInstance } from "fastify";
import type { CampuxConfig } from "@campux/config";
import { z } from "zod";
import { requireSystemOperator, requireTenantRole } from "../lib/auth";
import { writeAuditLog } from "../lib/audit";
import { prisma } from "../lib/prisma";
import { formatPlatformFeedbackEmail, resolvePlatformFeedbackRecipients, sendPlatformFeedbackNotice } from "../lib/platform-feedback-email";

const submitBodySchema = z.object({
  content: z.string().trim().min(1, "请输入反馈内容").max(1000, "反馈最多 1000 字"),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/**
 * 平台意见箱：租户管理员向 Campux 开发/运维提意见。
 *
 * - 提交：当前校园墙的 admin（租户管理员）；落库后给平台运维管理员发邮件。
 * - 查看：仅系统运维（system_operator），在运维面板「开发意见」中查看。
 * 注意与 /api/feedback 区分：那是普通用户在墙内向审核员反馈。
 */
export function registerPlatformFeedbackRoutes(app: FastifyInstance, config: CampuxConfig) {
  app.post("/api/platform-feedback", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    const body = submitBodySchema.parse(request.body);

    const recentSubmission = await prisma.platformFeedback.findFirst({
      where: {
        tenantId: context.selectedTenant.id,
        authorId: context.user.id,
        createdAt: { gte: new Date(Date.now() - 60_000) },
      },
      select: { id: true },
    });
    if (recentSubmission) {
      return reply.code(429).send({ message: "提交过于频繁，请 60 秒后再试" });
    }

    const saved = await prisma.platformFeedback.create({
      data: {
        tenantId: context.selectedTenant.id,
        authorId: context.user.id,
        content: body.content,
      },
    });

    await writeAuditLog({
      tenantId: context.selectedTenant.id,
      actorId: context.user.id,
      action: "tenant.platform_feedback.submit",
      targetType: "platform_feedback",
      targetId: saved.id,
      detail: {
        length: body.content.length,
        preview: body.content.slice(0, 80),
      },
    });

    const admins = await prisma.user.findMany({
      where: { systemRole: "system_operator" },
      select: { id: true, qqUin: true, email: true, isTestAccount: true },
    });
    const recipients = resolvePlatformFeedbackRecipients(admins);
    const authorName = context.user.displayName?.trim() || "未设置昵称";
    const email = formatPlatformFeedbackEmail({
      tenantName: context.selectedTenant.name,
      tenantSlug: context.selectedTenant.slug,
      authorName,
      authorQqUin: context.user.qqUin.toString(),
      authorEmail: context.user.email,
      content: body.content,
      createdAt: saved.createdAt,
    });
    const notice = await sendPlatformFeedbackNotice({ config, recipients, email });

    // 意见已经落库，邮件失败不应让前端重试而重复提交；只把结果记录下来给运维核实。
    const notifyError = notice.error ?? (notice.skipped ? "未配置邮件服务（RESEND_API_KEY），本次未发送邮件" : null);
    if (notice.delivered.length > 0 || notifyError) {
      await prisma.platformFeedback.update({
        where: { id: saved.id },
        data: {
          notifiedAt: notice.delivered.length > 0 ? new Date() : null,
          notifyError,
        },
      });
    }

    // 邮件结果只落库给运维核实，不回传给租户管理员（避免暴露平台邮件配置细节）。
    return { ok: true, id: saved.id };
  });

  app.get("/api/system/platform-feedback", async (request, reply) => {
    await requireSystemOperator(request, reply);
    const query = listQuerySchema.parse(request.query);
    const [total, rows] = await Promise.all([
      prisma.platformFeedback.count(),
      prisma.platformFeedback.findMany({
        include: {
          tenant: { select: { id: true, name: true, slug: true } },
          author: { select: { id: true, displayName: true, qqUin: true, email: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);

    return {
      emailConfigured: Boolean(config.resend.apiKey),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        pageCount: Math.max(1, Math.ceil(total / query.limit)),
      },
      items: rows.map((row) => ({
        id: row.id,
        content: row.content,
        createdAt: row.createdAt.toISOString(),
        notifiedAt: row.notifiedAt?.toISOString() ?? null,
        notifyError: row.notifyError,
        tenant: row.tenant,
        author: {
          id: row.author.id,
          displayName: row.author.displayName,
          qqUin: row.author.qqUin.toString(),
          email: row.author.email,
        },
      })),
    };
  });
}
