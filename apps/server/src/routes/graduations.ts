import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { hasTenantRole, requireReadyTenant } from "../lib/auth";
import { runWithActiveTenantLease } from "../lib/tenant-runtime-lease";
import { writeAuditLog } from "../lib/audit";
import { readTenantPluginConfig } from "../lib/tenant-plugin-config";
import type { OneBotRuntime } from "../runtime/onebot";

// 毕业生去向：投稿页发起，入学年份（级）与毕业年份（届）由用户自填，
// 提交后进入审核队列，审核群与网页端均可通过/驳回；通过后计入服务页统计视图。
const MIN_YEAR = 1970;
const MAX_YEAR = 2100;
const MAX_DESTINATION_LENGTH = 120;
const MAX_EDUCATION_LENGTH = 20;

const createBodySchema = z.object({
  // 入学年份（级）与毕业年份（届）均由用户自行填写，不再按学历推算。
  classYear: z.number().int().min(MIN_YEAR).max(MAX_YEAR),
  graduationYear: z.number().int().min(MIN_YEAR).max(MAX_YEAR),
  // 学历：初中/高中/大专/本科/硕士/博士/其他
  education: z.string().trim().min(1).max(MAX_EDUCATION_LENGTH),
  // 毕业去向（学校/单位全称，用户自填）
  destination: z.string().trim().min(1).max(MAX_DESTINATION_LENGTH),
});

const paramsSchema = z.object({ id: z.string().min(1) });

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  // 视图过滤：全部/待审核
  filter: z.enum(["all", "pending"]).default("all"),
  // 用户列表视图：仅已通过的记录
  onlyApproved: z.enum(["true", "false"]).optional(),
});

const schoolsQuerySchema = z.object({
  q: z.string().max(80).optional(),
});

const timelineQuerySchema = z.object({
  // 排序依据：classYear | graduationYear | createdAt
  by: z.enum(["classYear", "graduationYear", "createdAt"]).default("graduationYear"),
  order: z.enum(["asc", "desc"]).default("asc"),
  // 选定年份（级或届）：只看这一年的记录
  year: z.number().int().min(MIN_YEAR).max(MAX_YEAR).optional(),
  yearType: z.enum(["classYear", "graduationYear"]).default("graduationYear"),
});

const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(80),
});

const rejectBodySchema = z.object({
  reason: z.string().trim().min(1).max(300),
});

type Row = {
  id: string;
  tenantId: string;
  displayId: number;
  authorId: string;
  classYear: number;
  graduationYear: number;
  education: string;
  destination: string;
  status: string;
  rejectReason: string | null;
  reviewedById: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  author?: { displayName: string | null; qqUin: bigint; email: string | null } | null;
};

function toListItem(row: Row) {
  return {
    id: row.id,
    displayId: row.displayId,
    classYear: row.classYear,
    graduationYear: row.graduationYear,
    education: row.education,
    destination: row.destination,
    status: row.status,
    rejectReason: row.rejectReason,
    reviewedAt: row.reviewedAt,
    createdAt: row.createdAt,
    author: row.author
      ? { displayName: row.author.displayName, qqUin: row.author.qqUin.toString() }
      : null,
  };
}

export function registerGraduationRoutes(app: FastifyInstance, _config: unknown, oneBot?: OneBotRuntime) {
  void _config;

  app.post("/api/graduations", async (request, reply) => {
    const context = await requireReadyTenant(request, reply, "submitter");
    const tenantId = context.selectedTenant.id;
    const pluginConfig = await readTenantPluginConfig(prisma, tenantId);
    const plugin = pluginConfig.graduation;
    if (!plugin.enabled) return reply.code(403).send({ message: "毕业去向插件未开启" });

    let body: z.infer<typeof createBodySchema>;
    try {
      body = createBodySchema.parse(request.body ?? {});
    } catch (error) {
      return reply.code(400).send({ message: errorMessageOf(error) });
    }
    // 级/届均由用户自填：毕业年份不得早于入学年份。
    if (body.graduationYear < body.classYear) {
      return reply.code(400).send({ message: "毕业年份（届）不能早于入学年份（级）" });
    }

    // 每个用户在同一租户下最多 1 条「待审核 + 已通过」的记录（不允许重复填）。
    const activeCount = await prisma.userGraduation.count({
      where: { tenantId, authorId: context.user.id, status: { in: ["pending_approval", "approved"] } },
    });
    if (activeCount > 0) {
      return reply.code(409).send({ message: "你已提交过毕业去向，不能重复提交" });
    }

    try {
      const created = await runWithActiveTenantLease(prisma, tenantId, async (transaction) => {
        const tenant = await transaction.tenant.findUnique({
          where: { id: tenantId },
          select: { nextGraduationDisplayId: true },
        });
        const displayId = tenant?.nextGraduationDisplayId ?? 1;
        await transaction.tenant.update({
          where: { id: tenantId },
          data: { nextGraduationDisplayId: displayId + 1 },
        });
        const record = await transaction.userGraduation.create({
          data: {
            tenantId,
            displayId,
            authorId: context.user.id,
            classYear: body.classYear,
            graduationYear: body.graduationYear,
            education: body.education,
            destination: body.destination,
            status: "pending_approval",
          },
          include: { author: { select: { displayName: true, qqUin: true, email: true } } },
        });
        await writeAuditLog({
          tenantId,
          actorId: context.user.id,
          action: "graduation.create",
          targetType: "graduation",
          targetId: record.id,
          detail: { displayId },
        }, transaction);
        return record;
      });
      if (!created.active) return reply.code(409).send({ message: "校园墙已暂停或归档" });
      void oneBot?.notifyNewGraduation(created.value.id).catch(() => undefined);
      return toListItem(created.value as unknown as Row);
    } catch (error) {
      return reply.code(statusOf(error)).send({ message: errorMessageOf(error) });
    }
  });

  // 用户列表视图：全部/待审核；只列已通过的用于毕业生名单。
  app.get("/api/graduations", async (request, reply) => {
    const context = await requireReadyTenant(request, reply, "submitter");
    const query = listQuerySchema.parse(request.query);
    const where: Record<string, unknown> = { tenantId: context.selectedTenant.id };
    if (query.onlyApproved === "true") where.status = "approved";
    else if (query.onlyApproved === "false") where.status = "pending_approval";
    else if (query.filter === "pending") where.status = "pending_approval";
    else where.status = "approved"; // 「all」视图默认看已通过记录

    const [total, rows] = await Promise.all([
      prisma.userGraduation.count({ where }),
      prisma.userGraduation.findMany({
        where,
        include: { author: { select: { displayName: true, qqUin: true, email: true } } },
        orderBy: { displayId: "desc" },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);
    return {
      items: (rows as unknown as Row[]).map(toListItem),
      total,
      pagination: { page: query.page, limit: query.limit, total },
    };
  });

  // 学校列表视图：按 destination 聚合，展示每个学校的人数
  app.get("/api/graduations/schools", async (request, reply) => {
    const context = await requireReadyTenant(request, reply, "submitter");
    const query = schoolsQuerySchema.parse(request.query);
    const where: Record<string, unknown> = { tenantId: context.selectedTenant.id, status: "approved" };
    if (query.q?.trim()) {
      where.destination = { contains: query.q.trim() };
    }
    const rows = await prisma.userGraduation.groupBy({
      by: ["destination"],
      where,
      _count: { destination: true },
      _min: { graduationYear: true },
      _max: { graduationYear: true },
    });
    return {
      items: rows.map((row: { destination: string; _count: { destination: number }; _min: { graduationYear: number | null }; _max: { graduationYear: number | null } }) => ({
        destination: row.destination,
        count: row._count.destination,
        earliestGraduationYear: row._min.graduationYear,
        latestGraduationYear: row._max.graduationYear,
      })),
    };
  });

  // 按学校查具体用户
  app.get("/api/graduations/schools/:destination", async (request, reply) => {
    const context = await requireReadyTenant(request, reply, "submitter");
    const params = z.object({ destination: z.string().trim().min(1).max(MAX_DESTINATION_LENGTH) }).parse(request.params);
    const rows = await prisma.userGraduation.findMany({
      where: { tenantId: context.selectedTenant.id, status: "approved", destination: params.destination },
      include: { author: { select: { displayName: true, qqUin: true, email: true } } },
      orderBy: { graduationYear: "asc" },
    });
    return { items: (rows as unknown as Row[]).map(toListItem) };
  });

  // 时间视图：按年份（级/届）聚合 + 可按年份过滤明细
  app.get("/api/graduations/timeline", async (request, reply) => {
    const context = await requireReadyTenant(request, reply, "submitter");
    const query = timelineQuerySchema.parse(request.query);
    const tenantId = context.selectedTenant.id;
    const baseWhere: Record<string, unknown> = { tenantId, status: "approved" };
    if (query.year !== undefined) {
      baseWhere[query.yearType] = query.year;
    }

    // 年度汇总：把 by 字段的取值当「年」来 group，取 count；排序在 JS 侧完成
    // （groupBy 的 orderBy 要求字段必须出现在 by 中，动态键无法通过 Prisma 泛型校验）。
    const groups = await prisma.userGraduation.groupBy({
      by: [query.by === "createdAt" ? "graduationYear" : query.by],
      where: baseWhere,
      _count: { id: true },
    });
    const yearTotals = groups
      .map((group: Record<string, unknown> & { _count: { id: number } }) => {
        const yearValue = group[query.by === "createdAt" ? "graduationYear" : query.by] as number;
        return {
          year: yearValue,
          count: group._count.id,
        };
      })
      .sort((left: { year: number }, right: { year: number }) => (query.order === "asc" ? left.year - right.year : right.year - left.year));

    const rows = await prisma.userGraduation.findMany({
      where: baseWhere,
      include: { author: { select: { displayName: true, qqUin: true, email: true } } },
      orderBy: {
        [query.by === "createdAt" ? "graduationYear" : query.by]: query.order,
      },
    });

    return {
      totals: yearTotals,
      items: (rows as unknown as Row[]).map(toListItem),
      by: query.by,
      order: query.order,
    };
  });

  // 搜索：按 QQ、用户名、学校关键词模糊匹配（仅已通过的记录）
  app.get("/api/graduations/search", async (request, reply) => {
    const context = await requireReadyTenant(request, reply, "submitter");
    const query = searchQuerySchema.parse(request.query);
    const keyword = query.q.trim();
    const qqMatch = /^\d{5,12}$/.test(keyword);
    const where: Record<string, unknown> = {
      tenantId: context.selectedTenant.id,
      status: "approved",
      OR: [
        { destination: { contains: keyword } },
        { author: { displayName: { contains: keyword } } },
        ...(qqMatch ? [{ author: { qqUin: BigInt(keyword) } }] : []),
      ],
    };
    const rows = await prisma.userGraduation.findMany({
      where,
      include: { author: { select: { displayName: true, qqUin: true, email: true } } },
      orderBy: { displayId: "desc" },
    });
    return { items: (rows as unknown as Row[]).map(toListItem) };
  });

  // 单个记录详情：审核员用
  app.get("/api/graduations/:id", async (request, reply) => {
    const context = await requireReadyTenant(request, reply, "submitter");
    const params = paramsSchema.parse(request.params);
    const record = await prisma.userGraduation.findFirst({
      where: { id: params.id, tenantId: context.selectedTenant.id },
      include: { author: { select: { displayName: true, qqUin: true, email: true } } },
    });
    if (!record) return reply.code(404).send({ message: "毕业记录不存在" });
    return toListItem(record as unknown as Row);
  });

  // 审核通过：状态 → approved
  app.post("/api/graduations/:id/approve", async (request, reply) => {
    const context = await requireReadyTenant(request, reply, "reviewer");
    const params = paramsSchema.parse(request.params);
    const target = await prisma.userGraduation.findFirst({
      where: { id: params.id, tenantId: context.selectedTenant.id, status: "pending_approval" },
    });
    if (!target) return reply.code(404).send({ message: "记录不存在或已非待审核" });
    const updated = await runWithActiveTenantLease(prisma, context.selectedTenant.id, async (transaction) => {
      const row = await transaction.userGraduation.update({
        where: { id: target.id },
        data: { status: "approved", reviewedById: context.user.id, reviewedAt: new Date() },
      });
      await writeAuditLog({
        tenantId: context.selectedTenant.id,
        actorId: context.user.id,
        action: "graduation.approve",
        targetType: "graduation",
        targetId: target.id,
        detail: { displayId: target.displayId },
      }, transaction);
      return row;
    });
    if (!updated.active) return reply.code(409).send({ message: "校园墙已暂停或归档" });
    void oneBot?.notifyGraduationReviewed(updated.value.id, "approved").catch(() => undefined);
    return { ok: true };
  });

  // 审核驳回：必填理由
  app.post("/api/graduations/:id/reject", async (request, reply) => {
    const context = await requireReadyTenant(request, reply, "reviewer");
    const params = paramsSchema.parse(request.params);
    const body = rejectBodySchema.parse(request.body ?? {});
    const target = await prisma.userGraduation.findFirst({
      where: { id: params.id, tenantId: context.selectedTenant.id, status: "pending_approval" },
    });
    if (!target) return reply.code(404).send({ message: "记录不存在或已非待审核" });
    const updated = await prisma.userGraduation.update({
      where: { id: target.id },
      data: { status: "rejected", rejectReason: body.reason, reviewedById: context.user.id, reviewedAt: new Date() },
    });
    await writeAuditLog({
      tenantId: context.selectedTenant.id,
      actorId: context.user.id,
      action: "graduation.reject",
      targetType: "graduation",
      targetId: target.id,
      detail: { displayId: target.displayId, reason: body.reason },
    });
    void oneBot?.notifyGraduationReviewed(updated.id, "rejected", body.reason).catch(() => undefined);
    return { ok: true };
  });

  // 待审核列表（审核群与网页端共用）
  app.get("/api/graduations/pending", async (request, reply) => {
    const context = await requireReadyTenant(request, reply, "reviewer");
    const rows = await prisma.userGraduation.findMany({
      where: { tenantId: context.selectedTenant.id, status: "pending_approval" },
      include: { author: { select: { displayName: true, qqUin: true, email: true } } },
      orderBy: { createdAt: "desc" },
    });
    return { items: (rows as unknown as Row[]).map(toListItem) };
  });

  // 是否拥有审核权限（前端决定是否展示「通过/驳回」按钮）
  app.get("/api/graduations/_capabilities", async (request, reply) => {
    const context = await requireReadyTenant(request, reply, "submitter");
    return {
      canReview: hasTenantRole(context.selectedMembership.role, "reviewer"),
      canSubmit: true,
    };
  });
}

function statusOf(error: unknown): number {
  if (error && typeof error === "object") {
    const record = error as { status?: unknown; statusCode?: unknown };
    const candidate = typeof record.statusCode === "number" ? record.statusCode : record.status;
    if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
  }
  return 400;
}

function errorMessageOf(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  if (error instanceof Error && error.message) return error.message;
  return "操作失败，请重试";
}
