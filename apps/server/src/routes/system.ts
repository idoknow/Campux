import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireSystemOperator } from "../lib/auth";
import { writeAuditLog } from "../lib/audit";
import { prisma } from "../lib/prisma";
import type { RuntimeQueue } from "../runtime/queue";

const tenantStatusSchema = z.enum(["active", "paused", "archived"]);

const tenantPatchSchema = z.object({
  status: tenantStatusSchema,
});

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

  app.patch("/api/system/tenants/:tenantId", async (request, reply) => {
    const context = await requireSystemOperator(request, reply);
    const params = z.object({ tenantId: z.string().min(1) }).parse(request.params);
    const body = tenantPatchSchema.parse(request.body);

    const tenant = await prisma.tenant.update({
      where: { id: params.tenantId },
      data: {
        status: body.status,
      },
    });
    await writeAuditLog({
      tenantId: tenant.id,
      actorId: context.user.id,
      action: "tenant.lifecycle.update",
      targetType: "tenant",
      targetId: tenant.id,
      detail: {
        status: body.status,
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
