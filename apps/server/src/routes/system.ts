import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireSystemOperator } from "../lib/auth";
import { writeAuditLog } from "../lib/audit";
import { prisma } from "../lib/prisma";
import { normalizeTenantHost } from "../lib/tenant-host";
import type { RuntimeQueue } from "../runtime/queue";

const tenantStatusSchema = z.enum(["active", "paused", "archived"]);

const tenantPatchSchema = z.object({
  status: tenantStatusSchema.optional(),
  host: z.string().max(255).nullable().optional(),
});

const tenantCreateSchema = z.object({
  name: z.string().min(1).max(80),
  slug: z.string().min(2).max(64).regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/),
  host: z.string().max(255).nullable().optional(),
  themeColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#42a5f5"),
  banner: z.string().max(200).default(""),
  botQqUin: z.string().regex(/^\d+$/).optional(),
});

const defaultPostRules = [
  "不发布隐私信息、辱骂、人身攻击和未经确认的指控。",
  "寻物招领请写清地点、时间和联系方式。",
  "图片最多 9 张，审核通过后会同步到本校启用的 QQ 墙号。",
];

const defaultServices = [
  { title: "修改密码", description: "账号服务" },
  { title: "投稿规则", description: "查看本墙规范" },
  { title: "校园服务", description: "推荐入口" },
];

function toSystemTenant(
  tenant: Awaited<ReturnType<typeof prisma.tenant.findMany>>[number] & {
    _count: {
      botAccounts: number;
      posts: number;
      memberships: number;
    };
  },
) {
  return {
    id: tenant.id,
    slug: tenant.slug,
    host: tenant.host,
    name: tenant.name,
    status: tenant.status,
    createdAt: tenant.createdAt.toISOString(),
    updatedAt: tenant.updatedAt.toISOString(),
    botAccountCount: tenant._count.botAccounts,
    postCount: tenant._count.posts,
    memberCount: tenant._count.memberships,
  };
}

async function listSystemTenants() {
  const tenants = await prisma.tenant.findMany({
    include: {
      _count: {
        select: {
          botAccounts: true,
          posts: true,
          memberships: true,
        },
      },
    },
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
  });

  return tenants.map(toSystemTenant);
}

export function registerSystemRoutes(app: FastifyInstance, queue: RuntimeQueue) {
  app.get("/api/system/tenants", async (request, reply) => {
    await requireSystemOperator(request, reply);

    return {
      tenants: await listSystemTenants(),
    };
  });

  app.post("/api/system/tenants", async (request, reply) => {
    const context = await requireSystemOperator(request, reply);
    const body = tenantCreateSchema.parse(request.body);
    const normalizedHost = body.host === undefined ? null : normalizeTenantHost(body.host);
    if (normalizedHost) {
      const existingTenant = await prisma.tenant.findFirst({
        where: { host: normalizedHost },
        select: { id: true },
      });
      if (existingTenant) {
        return reply.code(409).send({ message: "这个 host 已经绑定到其他校园墙" });
      }
    }
    if (body.botQqUin) {
      const existingBot = await prisma.botAccount.findUnique({
        where: {
          qqUin: BigInt(body.botQqUin),
        },
        select: {
          id: true,
        },
      });
      if (existingBot) {
        return reply.code(409).send({ message: "这个机器人 QQ 已经绑定到其他校园墙" });
      }
    }

    const tenant = await prisma.$transaction(async (tx) => {
      const created = await tx.tenant.create({
        data: {
          name: body.name,
          slug: body.slug,
          host: normalizedHost,
          themeColor: body.themeColor,
          status: "active",
          metadata: {
            create: [
              { key: "brand", value: body.name },
              { key: "banner", value: body.banner },
              { key: "post_rules", value: defaultPostRules },
              { key: "services", value: defaultServices },
            ],
          },
        },
      });

      if (body.botQqUin) {
        const bot = await tx.botAccount.create({
          data: {
            tenantId: created.id,
            qqUin: BigInt(body.botQqUin),
            displayName: `${body.name} 1 号墙`,
            enabled: true,
          },
        });
        await tx.publishTarget.create({
          data: {
            tenantId: created.id,
            botAccountId: bot.id,
            displayName: "主墙号",
            enabled: true,
            required: true,
          },
        });
      }

      return created;
    });

    await writeAuditLog({
      tenantId: tenant.id,
      actorId: context.user.id,
      action: "tenant.create",
      targetType: "tenant",
      targetId: tenant.id,
      detail: {
        slug: tenant.slug,
      },
    });

    return {
      tenants: await listSystemTenants(),
    };
  });

  app.patch("/api/system/tenants/:tenantId", async (request, reply) => {
    const context = await requireSystemOperator(request, reply);
    const params = z.object({ tenantId: z.string().min(1) }).parse(request.params);
    const body = tenantPatchSchema.parse(request.body);
    const normalizedHost = body.host === undefined ? undefined : normalizeTenantHost(body.host);
    if (normalizedHost) {
      const existingTenant = await prisma.tenant.findFirst({
        where: {
          host: normalizedHost,
          id: {
            not: params.tenantId,
          },
        },
        select: { id: true },
      });
      if (existingTenant) {
        return reply.code(409).send({ message: "这个 host 已经绑定到其他校园墙" });
      }
    }

    const updateData: {
      status?: z.infer<typeof tenantStatusSchema>;
      host?: string | null;
    } = {};
    if (body.status !== undefined) updateData.status = body.status;
    if (body.host !== undefined) updateData.host = normalizedHost ?? null;

    const tenant = await prisma.tenant.update({
      where: { id: params.tenantId },
      data: updateData,
    });
    await writeAuditLog({
      tenantId: tenant.id,
      actorId: context.user.id,
      action: "tenant.lifecycle.update",
      targetType: "tenant",
      targetId: tenant.id,
      detail: {
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.host !== undefined ? { host: normalizedHost } : {}),
      },
    });

    return {
      tenants: await listSystemTenants(),
    };
  });

  app.get("/api/system/users", async (request, reply) => {
    await requireSystemOperator(request, reply);
    const users = await prisma.user.findMany({
      include: {
        memberships: {
          include: {
            tenant: true,
          },
          orderBy: {
            createdAt: "asc",
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 100,
    });

    return {
      users: users.map((user) => ({
        id: user.id,
        qqUin: user.qqUin.toString(),
        displayName: user.displayName,
        systemRole: user.systemRole,
        isTestAccount: user.isTestAccount,
        createdAt: user.createdAt.toISOString(),
        memberships: user.memberships.map((membership) => ({
          id: membership.id,
          role: membership.role,
          tenant: {
            id: membership.tenant.id,
            name: membership.tenant.name,
            slug: membership.tenant.slug,
            status: membership.tenant.status,
          },
        })),
      })),
    };
  });

  app.get("/api/system/bots", async (request, reply) => {
    await requireSystemOperator(request, reply);
    const bots = await prisma.botAccount.findMany({
      include: {
        tenant: true,
        publishTargets: true,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 100,
    });

    return {
      bots: bots.map((bot) => ({
        id: bot.id,
        qqUin: bot.qqUin.toString(),
        displayName: bot.displayName,
        enabled: bot.enabled,
        reviewGroupId: bot.reviewGroupId,
        lastSeenAt: bot.lastSeenAt?.toISOString() ?? null,
        tenant: {
          id: bot.tenant.id,
          name: bot.tenant.name,
          slug: bot.tenant.slug,
          status: bot.tenant.status,
        },
        publishTargets: bot.publishTargets.map((target) => ({
          id: target.id,
          displayName: target.displayName,
          enabled: target.enabled,
          required: target.required,
        })),
      })),
    };
  });

  app.get("/api/system/queue", async (request, reply) => {
    await requireSystemOperator(request, reply);
    const [queued, running, failed, succeeded] = await Promise.all([
      prisma.publishAttempt.count({ where: { status: "queued" } }),
      prisma.publishAttempt.count({ where: { status: "running" } }),
      prisma.publishAttempt.count({ where: { status: "failed" } }),
      prisma.publishAttempt.count({ where: { status: "succeeded" } }),
    ]);

    return {
      runtime: queue.snapshot(),
      publishAttempts: {
        queued,
        running,
        failed,
        succeeded,
      },
    };
  });

  app.get("/api/system/audit-logs", async (request, reply) => {
    await requireSystemOperator(request, reply);
    const logs = await prisma.auditLog.findMany({
      include: {
        tenant: true,
        actor: true,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 100,
    });

    return {
      logs: logs.map((log) => ({
        id: log.id,
        action: log.action,
        targetType: log.targetType,
        targetId: log.targetId,
        detail: log.detail,
        createdAt: log.createdAt.toISOString(),
        tenant: log.tenant
          ? {
              id: log.tenant.id,
              name: log.tenant.name,
              slug: log.tenant.slug,
            }
          : null,
        actor: log.actor
          ? {
              id: log.actor.id,
              qqUin: log.actor.qqUin.toString(),
              displayName: log.actor.displayName,
            }
          : null,
      })),
    };
  });
}
