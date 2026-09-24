import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { hasTenantRole, requireReadyTenant } from "../lib/auth";
import { runWithActiveTenantLease } from "../lib/tenant-runtime-lease";
import { writeAuditLog } from "../lib/audit";
import { readTenantPluginConfig } from "../lib/tenant-plugin-config";
import { sortBroadcasts } from "../lib/broadcast-sort";
import type { TenantBroadcast, TenantBroadcastVersion, User } from "@campux/db";

// 通知时效上限 7 天。过期后 1 分钟内仍可点「已广播」，避免刚播完就过期来不及记账。
const MAX_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MARK_GRACE_MS = 60 * 1000;
const MAX_CONTENT_LENGTH = 500;
const MIN_CONTENT_LENGTH = 2;

const paramsSchema = z.object({ id: z.string().min(1) });

const listQuerySchema = z.object({
  scope: z.enum(["active", "history"]).default("active"),
  q: z.string().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const createBodySchema = z.object({
  content: z.string().trim().min(MIN_CONTENT_LENGTH).max(MAX_CONTENT_LENGTH),
  // datetime-local 提交的是本地时间字符串，服务端按 UTC 解析。
  endsAt: z.string().min(1),
});

const updateBodySchema = z.object({
  content: z.string().trim().min(MIN_CONTENT_LENGTH).max(MAX_CONTENT_LENGTH).optional(),
  endsAt: z.string().min(1).optional(),
});

type BroadcastAuthor = Pick<User, "id" | "displayName" | "qqUin">;

type BroadcastRow = TenantBroadcast & {
  author: BroadcastAuthor | null;
};

type VersionRow = TenantBroadcastVersion & {
  changedBy: BroadcastAuthor | null;
};

const AUTHOR_SELECT = {
  id: true,
  displayName: true,
  qqUin: true,
} as const;

const VERSION_CHANGED_BY_SELECT = {
  id: true,
  displayName: true,
  qqUin: true,
} as const;

function toAuthor(author: BroadcastAuthor | null) {
  if (!author) return null;
  return { displayName: author.displayName, qqUin: author.qqUin.toString() };
}

function toBroadcast(item: BroadcastRow) {
  return {
    id: item.id,
    displayId: item.displayId,
    content: item.content,
    endsAt: item.endsAt,
    broadcastCount: item.broadcastCount,
    modified: item.modified,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    author: toAuthor(item.author),
  };
}

function toVersion(version: VersionRow) {
  return {
    id: version.id,
    version: version.version,
    content: version.content,
    changedAt: version.changedAt,
    endsAt: version.endsAt,
    broadcastCount: version.broadcastCount,
    changedBy: toAuthor(version.changedBy),
  };
}

function parseEndsAt(value: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw { status: 400, message: "结束时间格式无效" };
  }
  return parsed;
}

function assertTtlValid(endsAt: Date, notBefore: Date) {
  if (endsAt.getTime() <= notBefore.getTime()) {
    throw { status: 400, message: "结束时间必须晚于当前时间" };
  }
  if (endsAt.getTime() > notBefore.getTime() + MAX_TTL_MS) {
    throw { status: 400, message: "通知时效不能超过 7 天" };
  }
}

function statusOf(error: unknown): number {
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number" && Number.isFinite(status)) return status;
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

// 「已广播」记账权限：广播员及以上身份都可点。广播员是专职身份，
// 审核员与管理员顺带拥有该能力，避免出现只有管理员能广播的死角。
function canBroadcast(role: string) {
  return hasTenantRole(role as "broadcaster", "broadcaster");
}

// 「违规删除」权限：管理员、审核员、广播员。
function canRemoveBroadcast(role: string) {
  return hasTenantRole(role as "broadcaster", "broadcaster");
}

export function registerBroadcastRoutes(app: FastifyInstance) {
  app.post("/api/broadcasts", async (request, reply) => {
    const context = await requireReadyTenant(request, reply, "submitter");
    const tenantId = context.selectedTenant.id;
    const pluginConfig = await readTenantPluginConfig(prisma, tenantId);
    if (!pluginConfig.broadcast.enabled) return reply.code(403).send({ message: "广播通知未开启" });

    let body: z.infer<typeof createBodySchema>;
    try {
      body = createBodySchema.parse(request.body ?? {});
    } catch (error) {
      return reply.code(400).send({ message: errorMessageOf(error) });
    }

    let endsAt: Date;
    try {
      endsAt = parseEndsAt(body.endsAt);
      assertTtlValid(endsAt, new Date());
    } catch (error) {
      return reply.code(statusOf(error)).send({ message: errorMessageOf(error) });
    }

    let committed = false;
    try {
      const created = await runWithActiveTenantLease(prisma, tenantId, async (transaction) => {
        const tenant = await transaction.tenant.findUnique({
          where: { id: tenantId },
          select: { nextBroadcastDisplayId: true },
        });
        const displayId = tenant?.nextBroadcastDisplayId ?? 1;
        await transaction.tenant.update({
          where: { id: tenantId },
          data: { nextBroadcastDisplayId: displayId + 1 },
        });
        const broadcast = await transaction.tenantBroadcast.create({
          data: {
            tenantId,
            displayId,
            authorId: context.user.id,
            content: body.content,
            endsAt,
          },
          include: { author: { select: AUTHOR_SELECT } },
        });
        // 首发同时落一条 v1 快照，后续修改追加 v2、v3…
        await transaction.tenantBroadcastVersion.create({
          data: {
            broadcastId: broadcast.id,
            version: 1,
            content: body.content,
            endsAt,
            broadcastCount: 0,
            changedById: context.user.id,
          },
          include: { changedBy: { select: VERSION_CHANGED_BY_SELECT } },
        });
        await writeAuditLog({
          tenantId,
          actorId: context.user.id,
          action: "broadcast.create",
          targetType: "broadcast",
          targetId: broadcast.id,
          detail: { displayId },
        }, transaction);
        return broadcast;
      });
      if (!created.active) {
        return reply.code(409).send({ message: "校园墙已暂停或归档" });
      }
      committed = true;
      return { ...toBroadcast(created.value as unknown as BroadcastRow) };
    } catch (error) {
      if (!committed) {
        return reply.code(statusOf(error)).send({ message: errorMessageOf(error) });
      }
      throw error;
    }
  });

  app.get("/api/broadcasts", async (request, reply) => {
    const context = await requireReadyTenant(request, reply, "submitter");
    const query = listQuerySchema.parse(request.query);
    const tenantId = context.selectedTenant.id;
    const now = new Date();

    const where: Record<string, unknown> = {
      tenantId,
      removedAt: null,
      endsAt: query.scope === "history" ? { lte: now } : { gt: now },
    };
    const keyword = query.q?.trim();
    if (keyword) {
      const clauses: Array<Record<string, unknown>> = [{ content: { contains: keyword } }];
      if (/^\d+$/.test(keyword)) clauses.push({ displayId: Number(keyword) });
      where.OR = clauses;
    }

    const [total, rows] = await Promise.all([
      prisma.tenantBroadcast.count({ where }),
      // 历史通知按发出时间倒序；新通知按结束时间升序取基序。
      // 新通知的三色分组无法用单一 orderBy 列表达（Prisma 不支持 CASE WHEN），
      // 且通知有 7 天硬上限、单租户体量很小，因此全量取出后在路由层分桶再分页。
      prisma.tenantBroadcast.findMany({
        where,
        include: { author: { select: AUTHOR_SELECT } },
        orderBy: query.scope === "history" ? [{ createdAt: "desc" }] : [{ endsAt: "asc" }],
      }),
    ]);

    const sorted = sortBroadcasts(rows as unknown as BroadcastRow[], query.scope);
    const pageRows = sorted.slice((query.page - 1) * query.limit, query.page * query.limit);

    return {
      items: pageRows.map(toBroadcast),
      now: now.toISOString(),
      pagination: { page: query.page, limit: query.limit, total },
    };
  });

  app.get("/api/broadcasts/:id/versions", async (request, reply) => {
    const context = await requireReadyTenant(request, reply, "submitter");
    const params = paramsSchema.parse(request.params);
    const versions = await prisma.tenantBroadcastVersion.findMany({
      where: { broadcast: { id: params.id, tenantId: context.selectedTenant.id } },
      include: { changedBy: { select: VERSION_CHANGED_BY_SELECT } },
      orderBy: { version: "asc" },
    });
    return { versions: (versions as unknown as VersionRow[]).map(toVersion) };
  });

  app.post("/api/broadcasts/:id/broadcast", async (request, reply) => {
    const context = await requireReadyTenant(request, reply, "submitter");
    if (!canBroadcast(context.selectedMembership.role)) {
      return reply.code(403).send({ message: "没有广播权限" });
    }
    const params = paramsSchema.parse(request.params);
    const target = await prisma.tenantBroadcast.findFirst({
      where: { id: params.id, tenantId: context.selectedTenant.id, removedAt: null },
    });
    if (!target) return reply.code(404).send({ message: "通知不存在或已删除" });
    // 过期后 1 分钟内仍可记账：广播员刚播完、列表已滑到历史通知时来得及点。
    if (target.endsAt.getTime() + MARK_GRACE_MS < Date.now()) {
      return reply.code(409).send({ message: "通知已过期超过 1 分钟，不能再标记已广播" });
    }

    const result = await runWithActiveTenantLease(prisma, context.selectedTenant.id, async (transaction) => {
      const row = await transaction.tenantBroadcast.update({
        where: { id: target.id },
        // 计数加一，并清除 modified：广播代表对当前内容已确认，卡片由橙转绿。
        data: { broadcastCount: { increment: 1 }, modified: false },
        include: { author: { select: AUTHOR_SELECT } },
      });
      await writeAuditLog({
        tenantId: context.selectedTenant.id,
        actorId: context.user.id,
        action: "broadcast.mark_broadcast",
        targetType: "broadcast",
        targetId: target.id,
        detail: { displayId: target.displayId, broadcastCount: row.broadcastCount },
      }, transaction);
      return row;
    });
    if (!result.active) return reply.code(409).send({ message: "校园墙已暂停或归档" });
    return { ...toBroadcast(result.value as unknown as BroadcastRow) };
  });

  app.patch("/api/broadcasts/:id", async (request, reply) => {
    const context = await requireReadyTenant(request, reply, "submitter");
    const params = paramsSchema.parse(request.params);
    const target = await prisma.tenantBroadcast.findFirst({
      where: { id: params.id, tenantId: context.selectedTenant.id, removedAt: null },
    });
    if (!target) return reply.code(404).send({ message: "通知不存在或已删除" });
    // 只有发出者本人可以改；管理员代改不在需求范围内。
    if (target.authorId !== context.user.id) {
      return reply.code(403).send({ message: "只有通知发出者可以修改" });
    }
    if (target.endsAt <= new Date()) {
      return reply.code(409).send({ message: "通知已过期，不能再修改" });
    }

    const body = updateBodySchema.parse(request.body ?? {});
    let endsAt = target.endsAt;
    if (body.endsAt) {
      try {
        const parsed = parseEndsAt(body.endsAt);
        // 修改时效以原发出时间为基准，保证仍不超过 7 天。
        assertTtlValid(parsed, target.createdAt);
        endsAt = parsed;
      } catch (error) {
        return reply.code(statusOf(error)).send({ message: errorMessageOf(error) });
      }
    }
    const content = body.content ?? target.content;
    if (content === target.content && endsAt.getTime() === target.endsAt.getTime()) {
      return reply.code(400).send({ message: "通知内容没有变化" });
    }

    const result = await runWithActiveTenantLease(prisma, context.selectedTenant.id, async (transaction) => {
      const nextVersion = (
        await transaction.tenantBroadcastVersion.aggregate({
          where: { broadcastId: target.id },
          _max: { version: true },
        })
      )._max.version ?? 0;

      const row = await transaction.tenantBroadcast.update({
        where: { id: target.id },
        data: { content, endsAt, modified: true },
        include: { author: { select: AUTHOR_SELECT } },
      });
      await transaction.tenantBroadcastVersion.create({
        data: {
          broadcastId: target.id,
          version: nextVersion + 1,
          content,
          endsAt,
          broadcastCount: row.broadcastCount,
          changedById: context.user.id,
        },
        include: { changedBy: { select: VERSION_CHANGED_BY_SELECT } },
      });
      await writeAuditLog({
        tenantId: context.selectedTenant.id,
        actorId: context.user.id,
        action: "broadcast.update",
        targetType: "broadcast",
        targetId: target.id,
        detail: { displayId: target.displayId, version: nextVersion + 1 },
      }, transaction);
      return row;
    });
    if (!result.active) return reply.code(409).send({ message: "校园墙已暂停或归档" });
    return { ...toBroadcast(result.value as unknown as BroadcastRow) };
  });

  app.post("/api/broadcasts/:id/remove", async (request, reply) => {
    const context = await requireReadyTenant(request, reply, "submitter");
    if (!canRemoveBroadcast(context.selectedMembership.role)) {
      return reply.code(403).send({ message: "没有删除权限" });
    }
    const params = paramsSchema.parse(request.params);
    const target = await prisma.tenantBroadcast.findFirst({
      where: { id: params.id, tenantId: context.selectedTenant.id, removedAt: null },
    });
    if (!target) return reply.code(404).send({ message: "通知不存在或已删除" });

    const result = await runWithActiveTenantLease(prisma, context.selectedTenant.id, async (transaction) => {
      const row = await transaction.tenantBroadcast.update({
        where: { id: target.id },
        data: { removedAt: new Date(), removedById: context.user.id },
        include: { author: { select: AUTHOR_SELECT } },
      });
      await writeAuditLog({
        tenantId: context.selectedTenant.id,
        actorId: context.user.id,
        action: "broadcast.remove",
        targetType: "broadcast",
        targetId: target.id,
        detail: { displayId: target.displayId, reason: "违规删除" },
      }, transaction);
      return row;
    });
    if (!result.active) return reply.code(409).send({ message: "校园墙已暂停或归档" });
    return { ...toBroadcast(result.value as unknown as BroadcastRow) };
  });
}
