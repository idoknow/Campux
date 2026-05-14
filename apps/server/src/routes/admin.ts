import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { TenantRole } from "@campux/db";
import { requireTenantRole } from "../lib/auth";
import { prisma } from "../lib/prisma";
import { writeAuditLog } from "../lib/audit";
import { enqueueAttempt } from "../runtime/publishing";
import type { OneBotRuntime } from "../runtime/onebot";
import type { RuntimeQueue } from "../runtime/queue";

const roleSchema = z.enum(["submitter", "reviewer", "admin"]);

const memberParamsSchema = z.object({
  id: z.string().min(1),
});

const memberPatchSchema = z.object({
  role: roleSchema,
});

const targetParamsSchema = z.object({
  id: z.string().min(1),
});

const targetPatchSchema = z.object({
  displayName: z.string().min(1).max(80).optional(),
  enabled: z.boolean().optional(),
  required: z.boolean().optional(),
  publishDelaySeconds: z.number().int().min(0).max(86_400).optional(),
  failurePolicy: z.string().min(1).max(80).optional(),
});

const targetCreateSchema = z.object({
  botAccountId: z.string().min(1),
  displayName: z.string().min(1).max(80),
  enabled: z.boolean().default(true),
  required: z.boolean().default(true),
  publishDelaySeconds: z.number().int().min(0).max(86_400).default(0),
});

const botCreateSchema = z.object({
  qqUin: z.string().regex(/^\d+$/, "Bot QQ 必须是数字"),
  displayName: z.string().min(1).max(80),
  reviewGroupId: z.string().trim().max(40).optional(),
  enabled: z.boolean().default(true),
  createPublishTarget: z.boolean().default(true),
});

const botParamsSchema = z.object({
  id: z.string().min(1),
});

const attemptParamsSchema = z.object({
  id: z.string().min(1),
});

const postParamsSchema = z.object({
  id: z.string().min(1),
});

const banQuerySchema = z.object({
  onlyActive: z.coerce.boolean().default(true),
  q: z.string().max(80).optional(),
});

const banCreateSchema = z.object({
  userId: z.string().min(1).optional(),
  qqUin: z.string().regex(/^\d+$/).optional(),
  comment: z.string().min(1).max(500),
  endsAt: z.string().datetime(),
}).refine((body) => Boolean(body.userId || body.qqUin), {
  message: "需要指定用户",
});

const banParamsSchema = z.object({
  id: z.string().min(1),
});

export function registerAdminRoutes(app: FastifyInstance, queue: RuntimeQueue, oneBot?: OneBotRuntime) {
  app.get("/api/admin/members", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    const members = await prisma.tenantMembership.findMany({
      where: {
        tenantId: context.selectedTenant.id,
      },
      include: {
        user: true,
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    return {
      members: members.map((member) => toMember(member)),
    };
  });

  app.patch("/api/admin/members/:id", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    const params = memberParamsSchema.parse(request.params);
    const body = memberPatchSchema.parse(request.body);
    const member = await prisma.tenantMembership.findFirst({
      where: {
        id: params.id,
        tenantId: context.selectedTenant.id,
      },
    });

    if (!member) {
      return reply.code(404).send({ message: "成员不存在" });
    }

    const updated = await prisma.tenantMembership.update({
      where: {
        id: member.id,
      },
      data: {
        role: body.role,
      },
      include: {
        user: true,
      },
    });

    await writeAuditLog({
      tenantId: context.selectedTenant.id,
      actorId: context.user.id,
      action: "member.update_role",
      targetType: "membership",
      targetId: member.id,
      detail: {
        oldRole: member.role,
        newRole: body.role,
      },
    });

    return {
      member: toMember(updated),
    };
  });

  app.get("/api/admin/ban-records", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    const query = banQuerySchema.parse(request.query);
    const now = new Date();
    const matchedUsers = query.q
      ? await prisma.user.findMany({
          where: {
            OR: [
              ...(Number.isNaN(Number(query.q)) ? [] : [{ qqUin: BigInt(query.q) }]),
              {
                displayName: {
                  contains: query.q,
                  mode: "insensitive",
                },
              },
            ],
          },
          select: {
            id: true,
          },
          take: 50,
        })
      : [];
    const bans = await prisma.banRecord.findMany({
      where: {
        tenantId: context.selectedTenant.id,
        ...(query.onlyActive ? { endsAt: { gt: now } } : {}),
        ...(query.q ? { userId: { in: matchedUsers.map((user) => user.id) } } : {}),
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 100,
    });

    return {
      bans: await toBanRecords(bans),
    };
  });

  app.post("/api/admin/ban-records", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    const body = banCreateSchema.parse(request.body);
    const endsAt = new Date(body.endsAt);
    if (endsAt.getTime() <= Date.now()) {
      return reply.code(400).send({ message: "封禁结束时间必须晚于当前时间" });
    }

    const user = body.userId
      ? await prisma.user.findUnique({ where: { id: body.userId } })
      : await prisma.user.findUnique({ where: { qqUin: BigInt(body.qqUin ?? "0") } });
    if (!user) {
      return reply.code(404).send({ message: "用户不存在" });
    }

    const membership = await prisma.tenantMembership.findUnique({
      where: {
        tenantId_userId: {
          tenantId: context.selectedTenant.id,
          userId: user.id,
        },
      },
    });
    if (!membership) {
      return reply.code(404).send({ message: "该用户不属于当前校园墙" });
    }
    if (membership.role === "admin") {
      return reply.code(409).send({ message: "不能封禁管理员" });
    }

    const ban = await prisma.banRecord.create({
      data: {
        tenantId: context.selectedTenant.id,
        userId: user.id,
        operatorId: context.user.id,
        comment: body.comment,
        endsAt,
      },
    });

    await writeAuditLog({
      tenantId: context.selectedTenant.id,
      actorId: context.user.id,
      action: "ban.create",
      targetType: "user",
      targetId: user.id,
      detail: {
        comment: body.comment,
        endsAt: endsAt.toISOString(),
      },
    });

    return {
      ban: (await toBanRecords([ban]))[0],
    };
  });

  app.post("/api/admin/ban-records/:id/unban", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    const params = banParamsSchema.parse(request.params);
    const ban = await prisma.banRecord.findFirst({
      where: {
        id: params.id,
        tenantId: context.selectedTenant.id,
      },
    });
    if (!ban) {
      return reply.code(404).send({ message: "封禁记录不存在" });
    }

    const updated = await prisma.banRecord.update({
      where: {
        id: ban.id,
      },
      data: {
        endsAt: new Date(),
      },
    });

    await writeAuditLog({
      tenantId: context.selectedTenant.id,
      actorId: context.user.id,
      action: "ban.unban",
      targetType: "user",
      targetId: ban.userId,
    });

    return {
      ban: (await toBanRecords([updated]))[0],
    };
  });

  app.get("/api/admin/bots", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    const bots = await prisma.botAccount.findMany({
      where: {
        tenantId: context.selectedTenant.id,
      },
      include: {
        sessions: {
          orderBy: {
            refreshedAt: "desc",
          },
          take: 3,
        },
        publishTargets: {
          orderBy: {
            displayName: "asc",
          },
        },
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    const auditLogs = await prisma.auditLog.findMany({
      where: {
        tenantId: context.selectedTenant.id,
        OR: [
          {
            action: {
              startsWith: "bot.",
            },
          },
          {
            targetType: {
              in: ["bot_account", "bot_session", "publish_target", "publish_attempt"],
            },
          },
        ],
      },
      include: {
        actor: true,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 30,
    });

    return {
      bots: bots.map((bot) => toBotAccount(bot, oneBot?.getBotConnectionStatus(bot.qqUin.toString()))),
      events: auditLogs.map(toTenantBotEvent),
    };
  });

  app.post("/api/admin/bots", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    const body = botCreateSchema.parse(request.body);
    const existing = await prisma.botAccount.findUnique({
      where: {
        tenantId_qqUin: {
          tenantId: context.selectedTenant.id,
          qqUin: BigInt(body.qqUin),
        },
      },
    });
    if (existing) {
      return reply.code(409).send({ message: "这个机器人已经绑定到当前校园墙" });
    }

    const bot = await prisma.botAccount.create({
      data: {
        tenantId: context.selectedTenant.id,
        qqUin: BigInt(body.qqUin),
        displayName: body.displayName,
        reviewGroupId: body.reviewGroupId?.trim() || null,
        enabled: body.enabled,
        ...(body.createPublishTarget
          ? {
              publishTargets: {
                create: {
                  tenantId: context.selectedTenant.id,
                  displayName: body.displayName,
                  enabled: true,
                  required: false,
                },
              },
            }
          : {}),
      },
      include: {
        sessions: true,
        publishTargets: true,
      },
    });

    await writeAuditLog({
      tenantId: context.selectedTenant.id,
      actorId: context.user.id,
      action: "bot_account.create",
      targetType: "bot_account",
      targetId: bot.id,
      detail: {
        qqUin: body.qqUin,
        displayName: body.displayName,
        reviewGroupId: body.reviewGroupId?.trim() || null,
      },
    });

    return {
      bot: toBotAccount(bot, oneBot?.getBotConnectionStatus(bot.qqUin.toString())),
    };
  });

  app.delete("/api/admin/bots/:id", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    const params = botParamsSchema.parse(request.params);
    const bot = await prisma.botAccount.findFirst({
      where: {
        id: params.id,
        tenantId: context.selectedTenant.id,
      },
      include: {
        publishTargets: true,
      },
    });

    if (!bot) {
      return reply.code(404).send({ message: "机器人不存在" });
    }

    await prisma.botAccount.delete({
      where: {
        id: bot.id,
      },
    });

    await writeAuditLog({
      tenantId: context.selectedTenant.id,
      actorId: context.user.id,
      action: "bot_account.delete",
      targetType: "bot_account",
      targetId: bot.id,
      detail: {
        qqUin: bot.qqUin.toString(),
        displayName: bot.displayName,
        publishTargetCount: bot.publishTargets.length,
      },
    });

    return {
      ok: true,
    };
  });

  app.get("/api/admin/publish-targets", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    const targets = await prisma.publishTarget.findMany({
      where: {
        tenantId: context.selectedTenant.id,
      },
      include: {
        botAccount: true,
      },
      orderBy: {
        displayName: "asc",
      },
    });

    return {
      targets: targets.map(toPublishTarget),
    };
  });

  app.post("/api/admin/publish-targets", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    const body = targetCreateSchema.parse(request.body);
    const botAccount = await prisma.botAccount.findFirst({
      where: {
        id: body.botAccountId,
        tenantId: context.selectedTenant.id,
      },
    });

    if (!botAccount) {
      return reply.code(404).send({ message: "Bot 账号不存在" });
    }

    const target = await prisma.publishTarget.create({
      data: {
        tenantId: context.selectedTenant.id,
        botAccountId: botAccount.id,
        displayName: body.displayName,
        enabled: body.enabled,
        required: body.required,
        publishDelaySeconds: body.publishDelaySeconds,
      },
      include: {
        botAccount: true,
      },
    });

    await writeAuditLog({
      tenantId: context.selectedTenant.id,
      actorId: context.user.id,
      action: "publish_target.create",
      targetType: "publish_target",
      targetId: target.id,
    });

    return {
      target: toPublishTarget(target),
    };
  });

  app.patch("/api/admin/publish-targets/:id", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    const params = targetParamsSchema.parse(request.params);
    const body = targetPatchSchema.parse(request.body);
    const target = await prisma.publishTarget.findFirst({
      where: {
        id: params.id,
        tenantId: context.selectedTenant.id,
      },
    });

    if (!target) {
      return reply.code(404).send({ message: "发布目标不存在" });
    }

    const updateData = {
      ...(body.displayName === undefined ? {} : { displayName: body.displayName }),
      ...(body.enabled === undefined ? {} : { enabled: body.enabled }),
      ...(body.required === undefined ? {} : { required: body.required }),
      ...(body.publishDelaySeconds === undefined ? {} : { publishDelaySeconds: body.publishDelaySeconds }),
      ...(body.failurePolicy === undefined ? {} : { failurePolicy: body.failurePolicy }),
    };
    const updated = await prisma.publishTarget.update({
      where: {
        id: target.id,
      },
      data: updateData,
      include: {
        botAccount: true,
      },
    });

    await writeAuditLog({
      tenantId: context.selectedTenant.id,
      actorId: context.user.id,
      action: "publish_target.update",
      targetType: "publish_target",
      targetId: target.id,
      detail: updateData,
    });

    return {
      target: toPublishTarget(updated),
    };
  });

  app.get("/api/admin/posts/:id/publish-attempts", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "reviewer");
    const params = postParamsSchema.parse(request.params);
    const attempts = await prisma.publishAttempt.findMany({
      where: {
        tenantId: context.selectedTenant.id,
        postId: params.id,
      },
      include: {
        publishTarget: {
          include: {
            botAccount: true,
          },
        },
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

    return {
      attempts: attempts.map(toPublishAttempt),
    };
  });

  app.post("/api/admin/publish-attempts/:id/retry", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    const params = attemptParamsSchema.parse(request.params);
    const attempt = await prisma.publishAttempt.findFirst({
      where: {
        id: params.id,
        tenantId: context.selectedTenant.id,
      },
    });

    if (!attempt) {
      return reply.code(404).send({ message: "发布记录不存在" });
    }

    const updated = await prisma.publishAttempt.update({
      where: {
        id: attempt.id,
      },
      data: {
        status: "queued",
        lastError: null,
        nextRunAt: new Date(),
      },
    });
    enqueueAttempt(queue, updated.tenantId, updated.id);

    await writeAuditLog({
      tenantId: context.selectedTenant.id,
      actorId: context.user.id,
      action: "publish_attempt.retry",
      targetType: "publish_attempt",
      targetId: attempt.id,
    });

    return {
      ok: true,
    };
  });
}

function toMember(member: {
  id: string;
  role: TenantRole;
  createdAt: Date;
  user: {
    id: string;
    qqUin: bigint;
    displayName: string | null;
    systemRole: string | null;
  };
}) {
  return {
    id: member.id,
    role: member.role,
    createdAt: member.createdAt.toISOString(),
    user: {
      id: member.user.id,
      qqUin: member.user.qqUin.toString(),
      displayName: member.user.displayName,
      systemRole: member.user.systemRole,
    },
  };
}

function toPublishTarget(target: {
  id: string;
  type: string;
  displayName: string;
  enabled: boolean;
  required: boolean;
  publishDelaySeconds: number;
  failurePolicy: string;
  botAccount: {
    id: string;
    qqUin: bigint;
    displayName: string;
    enabled: boolean;
  };
}) {
  return {
    id: target.id,
    type: target.type,
    displayName: target.displayName,
    enabled: target.enabled,
    required: target.required,
    publishDelaySeconds: target.publishDelaySeconds,
    failurePolicy: target.failurePolicy,
    botAccount: {
      id: target.botAccount.id,
      qqUin: target.botAccount.qqUin.toString(),
      displayName: target.botAccount.displayName,
      enabled: target.botAccount.enabled,
    },
  };
}

function toBotAccount(
  bot: {
    id: string;
    qqUin: bigint;
    displayName: string;
    enabled: boolean;
    reviewGroupId: string | null;
    lastSeenAt: Date | null;
    createdAt: Date;
    sessions: Array<{
      id: string;
      type: string;
      domain: string;
      refreshedAt: Date;
      expiresAt: Date | null;
    }>;
    publishTargets: Array<{
      id: string;
      displayName: string;
      enabled: boolean;
      required: boolean;
      type: string;
    }>;
  },
  connection: { online: boolean; connectionCount: number } | undefined,
) {
  return {
    id: bot.id,
    qqUin: bot.qqUin.toString(),
    displayName: bot.displayName,
    enabled: bot.enabled,
    reviewGroupId: bot.reviewGroupId,
    lastSeenAt: bot.lastSeenAt?.toISOString() ?? null,
    createdAt: bot.createdAt.toISOString(),
    connection: connection ?? {
      online: false,
      connectionCount: 0,
    },
    sessions: bot.sessions.map((session) => ({
      id: session.id,
      type: session.type,
      domain: session.domain,
      refreshedAt: session.refreshedAt.toISOString(),
      expiresAt: session.expiresAt?.toISOString() ?? null,
    })),
    publishTargets: bot.publishTargets.map((target) => ({
      id: target.id,
      type: target.type,
      displayName: target.displayName,
      enabled: target.enabled,
      required: target.required,
    })),
  };
}

function toTenantBotEvent(event: {
  id: string;
  action: string;
  targetType: string;
  targetId: string | null;
  detail: unknown;
  createdAt: Date;
  actor: {
    id: string;
    qqUin: bigint;
    displayName: string | null;
  } | null;
}) {
  return {
    id: event.id,
    action: event.action,
    targetType: event.targetType,
    targetId: event.targetId,
    detail: event.detail,
    createdAt: event.createdAt.toISOString(),
    actor: event.actor
      ? {
          id: event.actor.id,
          qqUin: event.actor.qqUin.toString(),
          displayName: event.actor.displayName,
        }
      : null,
  };
}

function toPublishAttempt(attempt: {
  id: string;
  status: string;
  attempt: number;
  lastError: string | null;
  externalId: string | null;
  updatedAt: Date;
  publishTarget: {
    id: string;
    displayName: string;
    required: boolean;
    botAccount: {
      qqUin: bigint;
      displayName: string;
    };
  };
}) {
  return {
    id: attempt.id,
    status: attempt.status,
    attempt: attempt.attempt,
    lastError: attempt.lastError,
    externalId: attempt.externalId,
    updatedAt: attempt.updatedAt.toISOString(),
    publishTarget: {
      id: attempt.publishTarget.id,
      displayName: attempt.publishTarget.displayName,
      required: attempt.publishTarget.required,
      botAccount: {
        qqUin: attempt.publishTarget.botAccount.qqUin.toString(),
        displayName: attempt.publishTarget.botAccount.displayName,
      },
    },
  };
}

async function toBanRecords(
  bans: Array<{
    id: string;
    tenantId: string;
    userId: string;
    operatorId: string | null;
    comment: string;
    startsAt: Date;
    endsAt: Date;
    createdAt: Date;
  }>,
) {
  const userIds = [...new Set(bans.flatMap((ban) => [ban.userId, ban.operatorId]).filter((id): id is string => Boolean(id)))];
  const users = await prisma.user.findMany({
    where: {
      id: {
        in: userIds,
      },
    },
  });
  const userById = new Map(users.map((user) => [user.id, user]));
  const now = Date.now();

  return bans.map((ban) => {
    const user = userById.get(ban.userId);
    const operator = ban.operatorId ? userById.get(ban.operatorId) : null;
    return {
      id: ban.id,
      comment: ban.comment,
      startsAt: ban.startsAt.toISOString(),
      endsAt: ban.endsAt.toISOString(),
      createdAt: ban.createdAt.toISOString(),
      active: ban.endsAt.getTime() > now,
      user: user
        ? {
            id: user.id,
            qqUin: user.qqUin.toString(),
            displayName: user.displayName,
          }
        : null,
      operator: operator
        ? {
            id: operator.id,
            qqUin: operator.qqUin.toString(),
            displayName: operator.displayName,
          }
        : null,
    };
  });
}
