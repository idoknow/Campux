import type { FastifyInstance, FastifyReply } from "fastify";
import type { CampuxConfig } from "@campux/config";
import { Prisma, createManyDedup } from "@campux/db";
import { z } from "zod";
import { requirePlatformAdmin } from "../lib/auth";
import { writeAuditLog } from "../lib/audit";
import { prisma } from "../lib/prisma";
import { normalizeTenantHost } from "../lib/tenant-host";
import {
  buildTenantDomainHost,
  provisionTenantDomain,
  resolveDnsTargetHost,
  tenantDomainAutomationEnabled,
  TenantDomainProvisioningError,
} from "../lib/tenant-domain";
import { buildUserContainsSearch } from "../lib/user-search";
import type { RuntimeQueue } from "../runtime/queue";

const tenantStatusSchema = z.enum(["active", "paused", "archived"]);

const tenantPatchSchema = z.object({
  status: tenantStatusSchema.optional(),
  host: z.string().max(255).nullable().optional(),
});

const systemSettingsPatchSchema = z.object({
  managementHost: z.string().max(255).nullable().optional(),
});

const tenantRoleSchema = z.enum(["submitter", "reviewer", "admin"]);
const platformAssignableRoleSchema = z.enum(["operations_admin", "system_operator", "submitter", "reviewer", "admin"]);

const userMembershipCreateSchema = z.object({
  tenantId: z.string().min(1).optional(),
  role: platformAssignableRoleSchema,
});

const tenantCreateSchema = z.object({
  name: z.string().min(1).max(80),
  slug: z.string().min(2).max(64).regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/),
  host: z.string().max(255).nullable().optional(),
  themeColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#42a5f5"),
  banner: z.string().max(200).default(""),
  botQqUin: z.string().regex(/^\d+$/).optional(),
});

const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

const systemUserRoleFilterSchema = platformAssignableRoleSchema;

const systemUsersQuerySchema = paginationQuerySchema.extend({
  q: z.string().max(80).optional(),
  roles: z.string().optional(),
  tenantId: z.string().optional(),
});

const defaultPostRules = [
  "不发布隐私信息、辱骂、人身攻击和未经确认的指控。",
  "寻物招领请写清地点、时间和联系方式。",
  "图片最多 9 张，审核通过后会同步到本校启用的 QQ 墙号。",
];

const defaultServices = [
  { title: "修改名称", description: "账户资料" },
  { title: "修改密码", description: "账号服务" },
  { title: "投稿规则", description: "查看本墙规范" },
  { title: "校园服务", description: "推荐入口" },
];

type SystemTenantRecord = {
  id: string;
  slug: string;
  host: string | null;
  name: string;
  status: z.infer<typeof tenantStatusSchema>;
  readyAt: Date | null;
  archiveWarningAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  botAccounts?: Array<{
    id: string;
    qqUin: bigint;
    displayName: string;
    enabled: boolean;
    reviewGroupId: string | null;
    lastSeenAt: Date | null;
    publishTargets: Array<{
      id: string;
      displayName: string;
      enabled: boolean;
      required: boolean;
    }>;
  }>;
  _count: {
    botAccounts: number;
    posts: number;
    memberships: number;
  };
};

function toSystemTenant(tenant: SystemTenantRecord) {
  return {
    id: tenant.id,
    slug: tenant.slug,
    host: tenant.host,
    name: tenant.name,
    status: tenant.status,
    ready: tenant.readyAt !== null,
    readyAt: tenant.readyAt?.toISOString() ?? null,
    archiveWarningAt: tenant.archiveWarningAt?.toISOString() ?? null,
    createdAt: tenant.createdAt.toISOString(),
    updatedAt: tenant.updatedAt.toISOString(),
    botAccountCount: tenant._count.botAccounts,
    postCount: tenant._count.posts,
    memberCount: tenant._count.memberships,
    bots: (tenant.botAccounts ?? []).map((bot) => ({
      id: bot.id,
      qqUin: bot.qqUin.toString(),
      displayName: bot.displayName,
      enabled: bot.enabled,
      reviewGroupId: bot.reviewGroupId,
      lastSeenAt: bot.lastSeenAt?.toISOString() ?? null,
      publishTargets: bot.publishTargets.map((target) => ({
        id: target.id,
        displayName: target.displayName,
        enabled: target.enabled,
        required: target.required,
      })),
    })),
  };
}

type PlatformContext = Awaited<ReturnType<typeof requirePlatformAdmin>>;

function isSystemOperator(context: PlatformContext) {
  return context.user.systemRole === "system_operator";
}

function manageableTenantIds(context: PlatformContext) {
  if (isSystemOperator(context)) {
    return null;
  }

  return context.memberships.filter((membership) => membership.role === "admin").map((membership) => membership.tenantId);
}

function assertCanManageTenant(context: PlatformContext, tenantId: string, reply: FastifyReply) {
  const tenantIds = manageableTenantIds(context);
  if (tenantIds === null || tenantIds.includes(tenantId)) {
    return;
  }

  reply.code(403);
  throw new Error("只能管理自己所属的校园墙");
}

async function getManagementHost() {
  const setting = await prisma.systemSetting.findUnique({
    where: {
      key: "management_host",
    },
  });
  return typeof setting?.value === "string" ? normalizeTenantHost(setting.value) : null;
}

async function assertHostNotReserved(host: string | null, reply: FastifyReply, options: { tenantId?: string; setting?: "management_host" } = {}) {
  if (!host) {
    return;
  }

  if (options.setting !== "management_host") {
    const managementHost = await getManagementHost();
    if (managementHost === host) {
      return reply.code(409).send({ message: "这个 host 已经被设置为管理端 host" });
    }
  }

  const existingTenant = await prisma.tenant.findFirst({
    where: {
      host,
      ...(options.tenantId ? { id: { not: options.tenantId } } : {}),
    },
    select: { id: true },
  });
  if (existingTenant) {
    return reply.code(409).send({ message: "这个 host 已经绑定到其他校园墙" });
  }
}

async function listSystemTenants(context: PlatformContext) {
  const tenantIds = manageableTenantIds(context);
  const tenants = await prisma.tenant.findMany({
    where: tenantIds === null ? {} : { id: { in: tenantIds } },
    include: {
      botAccounts: {
        include: {
          publishTargets: {
            orderBy: {
              displayName: "asc",
            },
          },
        },
        orderBy: {
          createdAt: "asc",
        },
      },
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

export function registerSystemRoutes(app: FastifyInstance, queue: RuntimeQueue, config: CampuxConfig) {
  app.get("/api/system/settings", async (request, reply) => {
    const context = await requirePlatformAdmin(request, reply);
    if (!isSystemOperator(context)) {
      return reply.code(403).send({ message: "只有系统运维可以查看全局设置" });
    }

    return {
      managementHost: await getManagementHost(),
    };
  });

  app.patch("/api/system/settings", async (request, reply) => {
    const context = await requirePlatformAdmin(request, reply);
    if (!isSystemOperator(context)) {
      return reply.code(403).send({ message: "只有系统运维可以修改全局设置" });
    }
    const body = systemSettingsPatchSchema.parse(request.body);
    const normalizedManagementHost = body.managementHost === undefined ? undefined : normalizeTenantHost(body.managementHost);
    if (normalizedManagementHost !== undefined) {
      const conflict = await assertHostNotReserved(normalizedManagementHost, reply, { setting: "management_host" });
      if (conflict) return conflict;
    }

    if (body.managementHost !== undefined) {
      if (normalizedManagementHost) {
        await prisma.systemSetting.upsert({
          where: { key: "management_host" },
          update: { value: normalizedManagementHost },
          create: { key: "management_host", value: normalizedManagementHost },
        });
      } else {
        await prisma.systemSetting.deleteMany({
          where: { key: "management_host" },
        });
      }

      await writeAuditLog({
        tenantId: null,
        actorId: context.user.id,
        action: "system.settings.update",
        targetType: "system_setting",
        targetId: "management_host",
        detail: {
          managementHost: normalizedManagementHost,
        },
      });
    }

    return {
      managementHost: await getManagementHost(),
    };
  });

  app.get("/api/system/tenants", async (request, reply) => {
    const context = await requirePlatformAdmin(request, reply);

    return {
      tenants: await listSystemTenants(context),
    };
  });

  app.post("/api/system/tenants", async (request, reply) => {
    const context = await requirePlatformAdmin(request, reply);
    const body = tenantCreateSchema.parse(request.body);
    const manualHost = body.host === undefined ? null : normalizeTenantHost(body.host);
    let normalizedHost = manualHost;
    if (!normalizedHost && tenantDomainAutomationEnabled(config)) {
      try {
        normalizedHost = buildTenantDomainHost(body.slug, config.tenantDomains.suffix);
      } catch (caught) {
        if (caught instanceof TenantDomainProvisioningError) {
          return reply.code(500).send({ message: caught.message });
        }
        throw caught;
      }
    }
    if (normalizedHost) {
      const conflict = await assertHostNotReserved(normalizedHost, reply);
      if (conflict) return conflict;
    }
    const existingSlug = await prisma.tenant.findUnique({
      where: {
        slug: body.slug,
      },
      select: {
        id: true,
      },
    });
    if (existingSlug) {
      return reply.code(409).send({ message: "这个网址标识已经被其他校园墙使用" });
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

    let cloudflareDnsRecordId: string | null = null;
    if (!manualHost && normalizedHost && tenantDomainAutomationEnabled(config)) {
      try {
        const targetHost = resolveDnsTargetHost(config.tenantDomains.targetHost ?? await getManagementHost() ?? config.webOrigin);
        if (!targetHost) {
          return reply.code(500).send({ message: "自动域名已启用，但没有可用的 DNS CNAME 目标" });
        }
        const record = await provisionTenantDomain({
          config,
          host: normalizedHost,
          targetHost,
        });
        cloudflareDnsRecordId = record?.id ?? null;
      } catch (caught) {
        request.log.error({ err: caught, host: normalizedHost }, "failed to provision tenant domain");
        if (caught instanceof TenantDomainProvisioningError) {
          return reply.code(502).send({ message: caught.message });
        }
        throw caught;
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
              { key: "pending_post_limit", value: 1 },
              { key: "services", value: defaultServices },
              { key: "publish_mode", value: "single" },
            ],
          },
        },
      });

      const adminUserIds = isSystemOperator(context)
        ? await tx.user
            .findMany({
              where: {
                systemRole: "system_operator",
              },
              select: {
                id: true,
              },
            })
            .then((users) => users.map((user) => user.id))
        : [context.user.id];

      const uniqueAdminUserIds = [...new Set([...adminUserIds, context.user.id])];
      if (uniqueAdminUserIds.length > 0) {
        await createManyDedup(
          tx.tenantMembership,
          uniqueAdminUserIds.map((userId) => ({
            tenantId: created.id,
            userId,
            role: "admin" as const,
          })),
          (row) => `${row.tenantId}:${row.userId}`,
        );
      }

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
        host: tenant.host,
        cloudflareDnsRecordId,
      },
    });

    return {
      tenants: await listSystemTenants(context),
    };
  });

  app.patch("/api/system/tenants/:tenantId", async (request, reply) => {
    const context = await requirePlatformAdmin(request, reply);
    const params = z.object({ tenantId: z.string().min(1) }).parse(request.params);
    assertCanManageTenant(context, params.tenantId, reply);
    const body = tenantPatchSchema.parse(request.body);
    const normalizedHost = body.host === undefined ? undefined : normalizeTenantHost(body.host);
    if (normalizedHost) {
      const conflict = await assertHostNotReserved(normalizedHost, reply, { tenantId: params.tenantId });
      if (conflict) return conflict;
    }

    const updateData: {
      status?: z.infer<typeof tenantStatusSchema>;
      host?: string | null;
      archiveWarningAt?: Date | null;
    } = {};
    if (body.status !== undefined) updateData.status = body.status;
    if (body.host !== undefined) updateData.host = normalizedHost ?? null;
    // Restoring a wall to active clears any pending auto-archive warning so the
    // scheduler does not immediately re-archive it.
    if (body.status === "active") updateData.archiveWarningAt = null;

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
      tenants: await listSystemTenants(context),
    };
  });

  app.get("/api/system/users", async (request, reply) => {
    const context = await requirePlatformAdmin(request, reply);
    const query = systemUsersQuerySchema.parse(request.query);
    const roleFilters = parseSystemUserRoleFilters(query.roles);
    const tenantRoleFilters = roleFilters.filter((role): role is z.infer<typeof tenantRoleSchema> => tenantRoleSchema.safeParse(role).success);
    const includeSystemOperator = isSystemOperator(context) && roleFilters.includes("system_operator");
    const includeOperationsAdmin = isSystemOperator(context) && roleFilters.includes("operations_admin");
    const keyword = query.q?.trim();
    const filters: Prisma.UserWhereInput[] = [];
    const tenantIds = manageableTenantIds(context);
    if (tenantIds !== null && tenantIds.length === 0) {
      return {
        total: 0,
        pagination: toPagination(query.page, query.limit, 0),
        users: [],
      };
    }
    if (query.tenantId && tenantIds !== null && !tenantIds.includes(query.tenantId)) {
      return reply.code(403).send({ message: "只能查看自己所属校园墙的用户" });
    }
    const scopedTenantIds = query.tenantId ? [query.tenantId] : tenantIds;

    if (scopedTenantIds !== null && roleFilters.length === 0) {
      filters.push({
        memberships: {
          some: {
            tenantId: { in: scopedTenantIds },
          },
        },
      });
    }

    if (roleFilters.length > 0) {
      const roleFilterTenantIds = query.tenantId ? [query.tenantId] : scopedTenantIds;
      const roleConditions: Prisma.UserWhereInput[] = [
        ...(includeSystemOperator ? [{ systemRole: "system_operator" as const }] : []),
        ...(includeOperationsAdmin ? [{ systemRole: "operations_admin" as const }] : []),
      ];

      if (tenantRoleFilters.length > 0) {
        roleConditions.push({
          memberships: {
            some: {
              ...(roleFilterTenantIds === null ? {} : { tenantId: { in: roleFilterTenantIds } }),
              role: { in: tenantRoleFilters },
            },
          },
        });
      }

      if (roleConditions.length > 0) {
        filters.push({ OR: roleConditions });
      } else {
        filters.push({ id: "__no_visible_role_match__" });
      }
    }
    if (keyword) {
      const searchWhere = await buildUserContainsSearch(keyword);
      if (searchWhere) filters.push(searchWhere);
    }
    const where: Prisma.UserWhereInput = filters.length > 0 ? { AND: filters } : {};
    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
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
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);

    return {
      total,
      pagination: toPagination(query.page, query.limit, total),
      users: users.map((user) => ({
        id: user.id,
        qqUin: user.qqUin.toString(),
        email: user.email,
        displayName: user.displayName,
        isTestAccount: user.isTestAccount,
        createdAt: user.createdAt.toISOString(),
        systemRole: isSystemOperator(context) ? user.systemRole : null,
        memberships: user.memberships
          .filter((membership) => tenantIds === null || tenantIds.includes(membership.tenantId))
          .map((membership) => ({
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

  app.post("/api/system/users/:userId/memberships", async (request, reply) => {
    const context = await requirePlatformAdmin(request, reply);
    const params = z.object({ userId: z.string().min(1) }).parse(request.params);
    const body = userMembershipCreateSchema.parse(request.body);

    const user = await prisma.user.findUnique({ where: { id: params.userId } });
    if (!user) {
      return reply.code(404).send({ message: "用户不存在" });
    }

    if (body.role === "system_operator" || body.role === "operations_admin") {
      if (!isSystemOperator(context)) {
        return reply.code(403).send({ message: "只有系统运维可以授予平台级身份" });
      }
      if (body.role === "operations_admin" && user.systemRole === "system_operator") {
        return {
          ok: true,
          systemRole: user.systemRole,
          retainedHigherRole: true,
        };
      }
      await prisma.user.update({
        where: { id: user.id },
        data: { systemRole: body.role },
      });

      await writeAuditLog({
        tenantId: null,
        actorId: context.user.id,
        action: "system.user.role.assign",
        targetType: "user",
        targetId: user.id,
        detail: {
          qqUin: user.qqUin.toString(),
          systemRole: body.role,
        },
      });

      return {
        ok: true,
        systemRole: body.role,
      };
    }

    if (!body.tenantId) {
      return reply.code(400).send({ message: "添加租户身份时必须选择校园墙" });
    }
    assertCanManageTenant(context, body.tenantId, reply);

    const tenant = await prisma.tenant.findUnique({ where: { id: body.tenantId } });
    if (!tenant) {
      return reply.code(404).send({ message: "租户不存在" });
    }

    const membership = await prisma.tenantMembership.upsert({
      where: {
        tenantId_userId: {
          tenantId: tenant.id,
          userId: user.id,
        },
      },
      update: {
        role: body.role,
      },
      create: {
        tenantId: tenant.id,
        userId: user.id,
        role: body.role,
      },
    });

    await writeAuditLog({
      tenantId: tenant.id,
      actorId: context.user.id,
      action: "system.member.assign",
      targetType: "membership",
      targetId: membership.id,
      detail: {
        qqUin: user.qqUin.toString(),
        tenantId: tenant.id,
        tenantName: tenant.name,
        role: body.role,
      },
    });

    return {
      ok: true,
      membership: {
        id: membership.id,
        role: membership.role,
      },
    };
  });

  app.delete("/api/system/users/:userId/memberships/:membershipId", async (request, reply) => {
    const context = await requirePlatformAdmin(request, reply);
    const params = z.object({ userId: z.string().min(1), membershipId: z.string().min(1) }).parse(request.params);
    const membership = await prisma.tenantMembership.findFirst({
      where: {
        id: params.membershipId,
        userId: params.userId,
      },
      include: {
        tenant: true,
        user: true,
      },
    });
    if (!membership) {
      return reply.code(404).send({ message: "租户身份不存在" });
    }
    assertCanManageTenant(context, membership.tenantId, reply);

    await prisma.tenantMembership.delete({
      where: {
        id: membership.id,
      },
    });

    await writeAuditLog({
      tenantId: membership.tenantId,
      actorId: context.user.id,
      action: "system.member.revoke",
      targetType: "membership",
      targetId: membership.id,
      detail: {
        qqUin: membership.user.qqUin.toString(),
        tenantId: membership.tenantId,
        tenantName: membership.tenant.name,
        role: membership.role,
      },
    });

    return {
      ok: true,
    };
  });

  app.get("/api/system/bots", async (request, reply) => {
    const context = await requirePlatformAdmin(request, reply);
    const tenantIds = manageableTenantIds(context);
    const bots = await prisma.botAccount.findMany({
      where: tenantIds === null ? {} : { tenantId: { in: tenantIds } },
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
    const context = await requirePlatformAdmin(request, reply);
    const tenantIds = manageableTenantIds(context);
    const attemptWhere: Prisma.PublishAttemptWhereInput = tenantIds === null ? {} : { tenantId: { in: tenantIds } };
    const [queued, running, failed, succeeded] = await Promise.all([
      prisma.publishAttempt.count({ where: { ...attemptWhere, status: "queued" } }),
      prisma.publishAttempt.count({ where: { ...attemptWhere, status: "running" } }),
      prisma.publishAttempt.count({ where: { ...attemptWhere, status: "failed" } }),
      prisma.publishAttempt.count({ where: { ...attemptWhere, status: "succeeded" } }),
    ]);
    const runtime = queue.snapshot();

    return {
      runtime: tenantIds === null ? runtime : { ...runtime, queued, processing: running, failed, lastError: null },
      publishAttempts: {
        queued,
        running,
        failed,
        succeeded,
      },
    };
  });

  app.get("/api/system/audit-logs", async (request, reply) => {
    const context = await requirePlatformAdmin(request, reply);
    const query = paginationQuerySchema.parse(request.query);
    const tenantIds = manageableTenantIds(context);
    const where: Prisma.AuditLogWhereInput = tenantIds === null ? {} : { tenantId: { in: tenantIds } };
    const [total, logs] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        include: {
          tenant: true,
          actor: true,
        },
        orderBy: {
          createdAt: "desc",
        },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);

    return {
      pagination: toPagination(query.page, query.limit, total),
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

function toPagination(page: number, limit: number, total: number) {
  return {
    page,
    limit,
    total,
    pageCount: Math.max(1, Math.ceil(total / limit)),
  };
}

function parseSystemUserRoleFilters(value: string | undefined) {
  if (!value) {
    return [];
  }
  return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))]
    .map((item) => systemUserRoleFilterSchema.safeParse(item))
    .filter((result) => result.success)
    .map((result) => result.data);
}
