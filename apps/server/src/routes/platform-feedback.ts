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

const SUBMISSION_COOLDOWN_MS = 60_000;

/**
 * 同一 (校园墙, 账号) 的进程内冷却占位。
 *
 * 只查库做不到原子：两个并发请求可能都读不到 60 秒内的记录，然后各自插入、
 * 各自发信。Node 是单线程，下面「检查 + 写入」之间没有 await，因此并发请求
 * 不会同时通过；数据库查询只用于进程重启后的兜底。
 *
 * 注意：这是单进程方案。如果将来同一数据库跑多个实例，需要换成数据库级
 * 唯一约束/行锁来实现跨实例的冷却。
 */
const submissionCooldown = new Map<string, number>();

function claimSubmissionCooldown(key: string, now: number): boolean {
  const lastSubmittedAt = submissionCooldown.get(key) ?? 0;
  if (now - lastSubmittedAt < SUBMISSION_COOLDOWN_MS) return false;
  // 顺便清掉陈旧的 key，避免长期运行后无限增长。
  if (submissionCooldown.size >= 1000) {
    for (const [existingKey, timestamp] of submissionCooldown) {
      if (now - timestamp >= SUBMISSION_COOLDOWN_MS) submissionCooldown.delete(existingKey);
    }
  }
  submissionCooldown.set(key, now);
  return true;
}

function releaseSubmissionCooldown(key: string, claimedAt: number) {
  if (submissionCooldown.get(key) === claimedAt) submissionCooldown.delete(key);
}

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
    const tenantId = context.selectedTenant.id;

    // 重启后进程内冷却为空，用数据库里的最近一条记录兜底。
    const recentSubmission = await prisma.platformFeedback.findFirst({
      where: {
        tenantId,
        authorId: context.user.id,
        createdAt: { gte: new Date(Date.now() - SUBMISSION_COOLDOWN_MS) },
      },
      select: { id: true },
    });
    if (recentSubmission) {
      return reply.code(429).send({ message: "提交过于频繁，请 60 秒后再试" });
    }

    const cooldownKey = `${tenantId}:${context.user.id}`;
    const claimedAt = Date.now();
    if (!claimSubmissionCooldown(cooldownKey, claimedAt)) {
      return reply.code(429).send({ message: "提交过于频繁，请 60 秒后再试" });
    }

    let saved: { id: string; createdAt: Date };
    try {
      saved = await prisma.platformFeedback.create({
        data: {
          tenantId,
          authorId: context.user.id,
          content: body.content,
        },
      });
    } catch (error) {
      // 落库失败时立刻释放冷却，允许用户直接重试。
      releaseSubmissionCooldown(cooldownKey, claimedAt);
      throw error;
    }

    // 审计只记非内容元数据：审计日志对 operations_admin 也可读，不能带正文预览。
    try {
      await writeAuditLog({
        tenantId,
        actorId: context.user.id,
        action: "tenant.platform_feedback.submit",
        targetType: "platform_feedback",
        targetId: saved.id,
        detail: { length: body.content.length },
      });
    } catch (error) {
      // 审计失败不应让已经入库的反馈表现为提交失败。
      request.log.warn({ err: error, feedbackId: saved.id }, "platform feedback audit log failed");
    }

    // 反馈已经持久化，邮件在后台发送：慢的 Resend 请求不会拖住提交响应，
    // 失败原因写回记录供运维在列表里核对。
    void dispatchPlatformFeedbackNotice({
      config,
      feedbackId: saved.id,
      content: body.content,
      createdAt: saved.createdAt,
      tenantName: context.selectedTenant.name,
      tenantSlug: context.selectedTenant.slug,
      authorName: context.user.displayName?.trim() || "未设置昵称",
      authorQqUin: context.user.qqUin.toString(),
      authorEmail: context.user.email,
      log: request.log,
    }).catch((error) => {
      request.log.error({ err: error, feedbackId: saved.id }, "platform feedback notification crashed");
    });

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

/**
 * 解析收件人 → 发信 → 把结果写回反馈记录。
 * 任何一步失败都只记录日志并尽力写回 notifyError，不抛给提交请求。
 */
async function dispatchPlatformFeedbackNotice(input: {
  config: CampuxConfig;
  feedbackId: string;
  content: string;
  createdAt: Date;
  tenantName: string;
  tenantSlug: string;
  authorName: string;
  authorQqUin: string;
  authorEmail: string | null;
  log: { error: (obj: unknown, msg?: string) => void };
}) {
  try {
    const admins = await prisma.user.findMany({
      where: { systemRole: "system_operator" },
      select: { id: true, qqUin: true, email: true, isTestAccount: true },
    });
    const recipients = resolvePlatformFeedbackRecipients(admins);
    const email = formatPlatformFeedbackEmail({
      tenantName: input.tenantName,
      tenantSlug: input.tenantSlug,
      authorName: input.authorName,
      authorQqUin: input.authorQqUin,
      authorEmail: input.authorEmail,
      content: input.content,
      createdAt: input.createdAt,
    });
    const notice = await sendPlatformFeedbackNotice({ config: input.config, recipients, email });

    const notifyError = notice.error ?? (notice.skipped ? "未配置邮件服务（RESEND_API_KEY），本次未发送邮件" : null);
    try {
      await prisma.platformFeedback.update({
        where: { id: input.feedbackId },
        data: {
          notifiedAt: notice.delivered.length > 0 ? new Date() : null,
          notifyError,
        },
      });
    } catch (error) {
      input.log.error({ err: error, feedbackId: input.feedbackId }, "platform feedback notify status update failed");
    }
  } catch (error) {
    input.log.error({ err: error, feedbackId: input.feedbackId }, "platform feedback notification failed");
    await prisma.platformFeedback
      .update({
        where: { id: input.feedbackId },
        data: { notifyError: error instanceof Error ? error.message : String(error) },
      })
      .catch(() => undefined);
  }
}
