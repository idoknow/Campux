import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Prisma, type TenantRole } from "@campux/db";
import { requireTenantRole } from "../lib/auth";
import { prisma } from "../lib/prisma";
import { decryptJson } from "../lib/secret-json";
import { writeAuditLog } from "../lib/audit";
import { buildUserContainsSearch, findUserIdsByContainsSearch } from "../lib/user-search";
import { defaultPublishIntervalSeconds, enqueueAttempt, resumePublishAttemptsWaitingForCookies, schedulePublishAttempt } from "../runtime/publishing";
import type { OneBotRuntime } from "../runtime/onebot";
import type { RuntimeQueue } from "../runtime/queue";
import { qzoneCookieDomain, refreshQZoneCookiesViaBot } from "../lib/bot-workflows";
import { checkAndUpdateQZoneSession } from "../lib/qzone-cookies";
import { pollQZoneQrLogin, startQZoneQrLogin } from "../lib/qzone-login";

const roleSchema = z.enum(["submitter", "reviewer", "admin"]);

const memberParamsSchema = z.object({
  id: z.string().min(1),
});

const memberUserParamsSchema = z.object({
  userId: z.string().min(1),
});

const memberPatchSchema = z.object({
  role: roleSchema,
});

const memberCreateSchema = z.object({
  qqUin: z.string().regex(/^\d+$/, "QQ 号必须是数字"),
  role: roleSchema.default("submitter"),
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
  qzoneRefreshMode: z.enum(["protocol", "qr"]).optional(),
});

const targetCreateSchema = z.object({
  botAccountId: z.string().min(1),
  displayName: z.string().min(1).max(80),
  enabled: z.boolean().default(true),
  required: z.boolean().default(true),
  publishDelaySeconds: z.number().int().min(0).max(86_400).default(defaultPublishIntervalSeconds),
  qzoneRefreshMode: z.enum(["protocol", "qr"]).default("protocol"),
});

const botCreateSchema = z.object({
  qqUin: z.string().regex(/^\d+$/, "Bot QQ 必须是数字"),
  displayName: z.string().min(1).max(80),
  reviewGroupId: z.string().trim().max(40).optional(),
  enabled: z.boolean().default(true),
  createPublishTarget: z.boolean().default(true),
});

const publishTextTemplateSchema = z.object({
  customText: z.string().max(1000).default(""),
  suffixText: z.string().max(1000).default(""),
  includePostId: z.boolean().default(true),
  includeAuthorMention: z.boolean().default(false),
  includeLinks: z.boolean().default(false),
});

const botPatchSchema = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  enabled: z.boolean().optional(),
  reviewGroupId: z.string().trim().max(40).nullable().optional(),
  userMessageReply: z.string().trim().min(1).max(1000).optional(),
  userMessageReplyCooldownSeconds: z.number().int().min(0).max(86_400).optional(),
  reviewGroupMessageReply: z.string().trim().min(1).max(1000).optional(),
  publishTextTemplate: publishTextTemplateSchema.optional(),
});

const botParamsSchema = z.object({
  id: z.string().min(1),
});

const botLoginParamsSchema = z.object({
  id: z.string().min(1),
  loginId: z.string().min(1),
});

const botParamsOnlySchema = z.object({
  id: z.string().min(1),
});

const attemptParamsSchema = z.object({
  id: z.string().min(1),
});

const attemptQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

const memberQuerySchema = paginationQuerySchema.extend({
  q: z.string().max(80).optional(),
  role: z.enum(["all", "submitter", "reviewer", "admin"]).default("all"),
});

const postParamsSchema = z.object({
  id: z.string().min(1),
});

const banQuerySchema = z.object({
  onlyActive: z.coerce.boolean().default(true),
  q: z.string().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
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
    const query = memberQuerySchema.parse(request.query);
    const searchWhere = query.q ? await buildUserContainsSearch(query.q) : null;
    const where: Prisma.TenantMembershipWhereInput = {
      tenantId: context.selectedTenant.id,
      ...(query.role === "all" ? {} : { role: query.role }),
      ...(searchWhere ? { user: searchWhere } : {}),
    };
    const [total, tenantMemberTotal, members] = await Promise.all([
      prisma.tenantMembership.count({ where }),
      prisma.tenantMembership.count({
        where: {
          tenantId: context.selectedTenant.id,
        },
      }),
      prisma.tenantMembership.findMany({
        where,
        include: {
          user: true,
        },
        orderBy: {
          createdAt: "asc",
        },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);

    return {
      members: members.map((member) => toMember(member)),
      pagination: toPagination(query.page, query.limit, total),
      tenantMemberTotal,
    };
  });

  app.get("/api/admin/members/users/:userId", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    const params = memberUserParamsSchema.parse(request.params);

    const membership = await prisma.tenantMembership.findUnique({
      where: {
        tenantId_userId: {
          tenantId: context.selectedTenant.id,
          userId: params.userId,
        },
      },
      include: {
        user: true,
      },
    });
    if (!membership) {
      return reply.code(404).send({ message: "该用户不属于当前校园墙" });
    }

    const now = new Date();
    const [postStatusGroups, postsTotal, recentPosts, banRecords] = await Promise.all([
      prisma.post.groupBy({
        by: ["status"],
        where: {
          tenantId: context.selectedTenant.id,
          authorId: params.userId,
        },
        _count: { _all: true },
      }),
      prisma.post.count({
        where: {
          tenantId: context.selectedTenant.id,
          authorId: params.userId,
        },
      }),
      prisma.post.findMany({
        where: {
          tenantId: context.selectedTenant.id,
          authorId: params.userId,
        },
        select: {
          id: true,
          displayId: true,
          text: true,
          anonymous: true,
          status: true,
          attachments: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
      prisma.banRecord.findMany({
        where: {
          tenantId: context.selectedTenant.id,
          userId: params.userId,
        },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
    ]);

    const postsByStatus = Object.fromEntries(postStatusGroups.map((group) => [group.status, group._count._all]));

    return {
      member: toMember(membership),
      stats: {
        postsTotal,
        postsByStatus,
        activeBanCount: banRecords.filter((ban) => ban.endsAt > now).length,
      },
      posts: recentPosts.map((post) => ({
        id: post.id,
        displayId: post.displayId,
        text: post.text,
        anonymous: post.anonymous,
        status: post.status,
        imageCount: getJsonArrayLength(post.attachments),
        createdAt: post.createdAt.toISOString(),
        updatedAt: post.updatedAt.toISOString(),
      })),
      bans: (await toBanRecords(banRecords)).map((ban) => ({
        id: ban.id,
        comment: ban.comment,
        startsAt: ban.startsAt,
        endsAt: ban.endsAt,
        createdAt: ban.createdAt,
        active: ban.active,
        operator: ban.operator,
      })),
    };
  });

  app.post("/api/admin/members", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    const body = memberCreateSchema.parse(request.body);
    const user = await prisma.user.findUnique({
      where: {
        qqUin: BigInt(body.qqUin),
      },
    });
    if (!user) {
      return reply.code(404).send({ message: "账号不存在，请先让该账号通过 Bot 注册或由运维创建" });
    }

    const member = await prisma.tenantMembership.upsert({
      where: {
        tenantId_userId: {
          tenantId: context.selectedTenant.id,
          userId: user.id,
        },
      },
      update: {
        role: body.role,
      },
      create: {
        tenantId: context.selectedTenant.id,
        userId: user.id,
        role: body.role,
      },
      include: {
        user: true,
      },
    });

    await writeAuditLog({
      tenantId: context.selectedTenant.id,
      actorId: context.user.id,
      action: "member.add",
      targetType: "membership",
      targetId: member.id,
      detail: {
        qqUin: body.qqUin,
        role: body.role,
      },
    });

    return {
      member: toMember(member),
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
    const matchedUserIds = query.q ? await findUserIdsByContainsSearch(query.q) : [];
    const where: Prisma.BanRecordWhereInput = {
      tenantId: context.selectedTenant.id,
      ...(query.onlyActive ? { endsAt: { gt: now } } : {}),
      ...(query.q ? { userId: { in: matchedUserIds } } : {}),
    };
    const [total, bans] = await Promise.all([
      prisma.banRecord.count({ where }),
      prisma.banRecord.findMany({
        where,
        orderBy: {
          createdAt: "desc",
        },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);

    return {
      bans: await toBanRecords(bans),
      pagination: toPagination(query.page, query.limit, total),
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
        qqUin: BigInt(body.qqUin),
      },
    });
    if (existing) {
      return reply.code(409).send({ message: "这个机器人 QQ 已经绑定到其他校园墙" });
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
                  publishDelaySeconds: defaultPublishIntervalSeconds,
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

  app.patch("/api/admin/bots/:id", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    const params = botParamsSchema.parse(request.params);
    const body = botPatchSchema.parse(request.body);
    const bot = await prisma.botAccount.findFirst({
      where: {
        id: params.id,
        tenantId: context.selectedTenant.id,
      },
    });
    if (!bot) {
      return reply.code(404).send({ message: "Bot 账号不存在" });
    }

    const updated = await prisma.botAccount.update({
      where: {
        id: bot.id,
      },
      data: {
        ...(body.displayName === undefined ? {} : { displayName: body.displayName }),
        ...(body.enabled === undefined ? {} : { enabled: body.enabled }),
        ...(body.reviewGroupId === undefined ? {} : { reviewGroupId: body.reviewGroupId?.trim() || null }),
        ...(body.userMessageReply === undefined ? {} : { userMessageReply: body.userMessageReply }),
        ...(body.userMessageReplyCooldownSeconds === undefined ? {} : { userMessageReplyCooldownSeconds: body.userMessageReplyCooldownSeconds }),
        ...(body.reviewGroupMessageReply === undefined ? {} : { reviewGroupMessageReply: body.reviewGroupMessageReply }),
        ...(body.publishTextTemplate === undefined ? {} : { publishTextTemplate: body.publishTextTemplate }),
      },
      include: {
        sessions: true,
        publishTargets: true,
      },
    });

    await writeAuditLog({
      tenantId: context.selectedTenant.id,
      actorId: context.user.id,
      action: "bot_account.update",
      targetType: "bot_account",
      targetId: bot.id,
      detail: body,
    });

    return {
      bot: toBotAccount(updated, oneBot?.getBotConnectionStatus(updated.qqUin.toString())),
    };
  });

  app.post("/api/admin/bots/:id/qzone-cookies/protocol", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    const params = botParamsSchema.parse(request.params);
    const bot = await prisma.botAccount.findFirst({
      where: {
        id: params.id,
        tenantId: context.selectedTenant.id,
      },
    });
    if (!bot) {
      return reply.code(404).send({ message: "Bot 账号不存在" });
    }
    if (!oneBot) {
      return reply.code(503).send({ message: "OneBot 运行时不可用" });
    }
    const data = await oneBot.callAction(bot.qqUin.toString(), "get_cookies", {
      domain: qzoneCookieDomain,
    });
    const rawCookies = extractCookiesFromActionData(data);
    const result = await refreshQZoneCookiesViaBot({
      botQqUin: bot.qqUin.toString(),
      operatorQqUin: context.user.qqUin.toString(),
      groupId: bot.reviewGroupId,
      rawCookies,
    });
    const checked = await checkAndUpdateQZoneSession(result.session.id);
    if (checked?.healthStatus === "available") {
      await resumePublishAttemptsWaitingForCookies(queue, bot.id, app.log);
    }
    return {
      cookieNames: result.cookieNames,
    };
  });

  app.post("/api/admin/bots/:id/qzone-cookies/check", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    const params = botParamsOnlySchema.parse(request.params);
    const session = await prisma.botSession.findFirst({
      where: {
        type: "qzone",
        domain: qzoneCookieDomain,
        botAccount: {
          id: params.id,
          tenantId: context.selectedTenant.id,
        },
      },
      orderBy: {
        refreshedAt: "desc",
      },
    });
    if (!session) {
      return reply.code(404).send({ message: "这个 Bot 还没有 QZone cookies" });
    }

    const updated = await checkAndUpdateQZoneSession(session.id);
    if (updated?.healthStatus === "available") {
      await resumePublishAttemptsWaitingForCookies(queue, params.id, app.log);
    }
    return {
      session: updated ? toBotSession(updated) : null,
    };
  });

  app.get("/api/admin/bots/:id/qzone-cookies", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    const params = botParamsOnlySchema.parse(request.params);
    const session = await prisma.botSession.findFirst({
      where: {
        type: "qzone",
        domain: qzoneCookieDomain,
        botAccount: {
          id: params.id,
          tenantId: context.selectedTenant.id,
        },
      },
      include: {
        botAccount: true,
      },
      orderBy: {
        refreshedAt: "desc",
      },
    });
    if (!session) {
      return reply.code(404).send({ message: "这个 Bot 还没有 QZone cookies" });
    }

    const cookies = toCookieRecord(decryptJson(session.cookies));
    return {
      bot: {
        id: session.botAccount.id,
        qqUin: session.botAccount.qqUin.toString(),
        displayName: session.botAccount.displayName,
      },
      session: toBotSession(session),
      cookies: Object.entries(cookies).map(([name, value]) => ({ name, value })),
      cookieHeader: Object.entries(cookies).map(([name, value]) => `${name}=${value}`).join("; "),
    };
  });

  app.post("/api/admin/bots/:id/qzone-login", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    const params = botParamsSchema.parse(request.params);
    const bot = await prisma.botAccount.findFirst({
      where: {
        id: params.id,
        tenantId: context.selectedTenant.id,
      },
    });
    if (!bot) {
      return reply.code(404).send({ message: "Bot 账号不存在" });
    }
    return startQZoneQrLogin({
      botAccountId: bot.id,
      tenantId: context.selectedTenant.id,
      actorId: context.user.id,
    });
  });

  app.get("/api/admin/bots/:id/qzone-login/:loginId", async (request, reply) => {
    await requireTenantRole(request, reply, "admin");
    const params = botLoginParamsSchema.parse(request.params);
    const result = await pollQZoneQrLogin(params.loginId);
    if (result.status === "succeeded") {
      const session = await prisma.botSession.findFirst({
        where: {
          botAccountId: params.id,
          type: "qzone",
          domain: qzoneCookieDomain,
        },
        orderBy: {
          refreshedAt: "desc",
        },
      });
      const checked = session ? await checkAndUpdateQZoneSession(session.id) : null;
      if (checked?.healthStatus === "available") {
        await resumePublishAttemptsWaitingForCookies(queue, params.id, app.log);
      }
    }
    return result;
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
        botAccount: {
          include: {
            sessions: {
              where: {
                type: "qzone",
                domain: qzoneCookieDomain,
              },
              orderBy: {
                refreshedAt: "desc",
              },
              take: 1,
            },
          },
        },
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
        qzoneRefreshMode: body.qzoneRefreshMode,
      },
      include: {
        botAccount: {
          include: {
            sessions: {
              where: {
                type: "qzone",
                domain: qzoneCookieDomain,
              },
              orderBy: {
                refreshedAt: "desc",
              },
              take: 1,
            },
          },
        },
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

  app.get("/api/admin/publish-attempts", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    const query = attemptQuerySchema.parse(request.query);
    const attempts = await prisma.publishAttempt.findMany({
      where: {
        tenantId: context.selectedTenant.id,
      },
      include: {
        publishTarget: {
          include: {
            botAccount: true,
          },
        },
        post: {
          include: {
            author: true,
          },
        },
      },
      orderBy: {
        updatedAt: "desc",
      },
      take: query.limit,
    });

    return {
      attempts: attempts.map(toPublishAttempt),
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
      ...(body.qzoneRefreshMode === undefined ? {} : { qzoneRefreshMode: body.qzoneRefreshMode }),
    };
    const updated = await prisma.publishTarget.update({
      where: {
        id: target.id,
      },
      data: updateData,
      include: {
        botAccount: {
          include: {
            sessions: {
              where: {
                type: "qzone",
                domain: qzoneCookieDomain,
              },
              orderBy: {
                refreshedAt: "desc",
              },
              take: 1,
            },
          },
        },
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
        post: {
          include: {
            author: true,
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
      include: {
        publishTarget: true,
      },
    });

    if (!attempt) {
      return reply.code(404).send({ message: "发布记录不存在" });
    }

    const { attempt: updated, nextRunAt } = await schedulePublishAttempt({
      tenantId: context.selectedTenant.id,
      postId: attempt.postId,
      publishTargetId: attempt.publishTargetId,
      botAccountId: attempt.publishTarget.botAccountId,
      intervalSeconds: attempt.publishTarget.publishDelaySeconds,
      excludeAttemptId: attempt.id,
      resetAttempt: true,
    });
    enqueueAttempt(queue, updated.tenantId, updated.id, nextRunAt);

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

function toPagination(page: number, limit: number, total: number) {
  return {
    page,
    limit,
    total,
    pageCount: Math.max(1, Math.ceil(total / limit)),
  };
}

function getJsonArrayLength(value: Prisma.JsonValue) {
  return Array.isArray(value) ? value.length : 0;
}

function toPublishTarget(target: {
  id: string;
  type: string;
  displayName: string;
  enabled: boolean;
  required: boolean;
  publishDelaySeconds: number;
  failurePolicy: string;
  qzoneRefreshMode: string;
  botAccount: {
    id: string;
    qqUin: bigint;
    displayName: string;
    enabled: boolean;
    connectionToken: string;
    publishTextTemplate: Prisma.JsonValue;
    sessions: Array<{
      id: string;
      type: string;
      domain: string;
      refreshedAt: Date;
      expiresAt: Date | null;
      healthStatus: string;
      healthCheckedAt: Date | null;
      healthMessage: string | null;
    }>;
  };
}) {
  const session = target.botAccount.sessions[0];
  return {
    id: target.id,
    type: target.type,
    displayName: target.displayName,
    enabled: target.enabled,
    required: target.required,
    publishDelaySeconds: target.publishDelaySeconds,
    failurePolicy: target.failurePolicy,
    qzoneRefreshMode: target.qzoneRefreshMode,
    botAccount: {
      id: target.botAccount.id,
      qqUin: target.botAccount.qqUin.toString(),
      displayName: target.botAccount.displayName,
      enabled: target.botAccount.enabled,
      connectionToken: target.botAccount.connectionToken,
      publishTextTemplate: normalizePublishTextTemplate(target.botAccount.publishTextTemplate),
      qzoneSession: session ? toBotSession(session) : null,
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
    connectionToken: string;
    publishTextTemplate: Prisma.JsonValue;
    userMessageReply: string;
    userMessageReplyCooldownSeconds: number;
    reviewGroupMessageReply: string;
    lastSeenAt: Date | null;
    createdAt: Date;
    sessions: Array<{
      id: string;
      type: string;
      domain: string;
      refreshedAt: Date;
      expiresAt: Date | null;
      healthStatus: string;
      healthCheckedAt: Date | null;
      healthMessage: string | null;
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
    connectionToken: bot.connectionToken,
    publishTextTemplate: normalizePublishTextTemplate(bot.publishTextTemplate),
    userMessageReply: bot.userMessageReply,
    userMessageReplyCooldownSeconds: bot.userMessageReplyCooldownSeconds,
    reviewGroupMessageReply: bot.reviewGroupMessageReply,
    lastSeenAt: bot.lastSeenAt?.toISOString() ?? null,
    createdAt: bot.createdAt.toISOString(),
    connection: connection ?? {
      online: false,
      connectionCount: 0,
    },
    sessions: bot.sessions.map(toBotSession),
    publishTargets: bot.publishTargets.map((target) => ({
      id: target.id,
      type: target.type,
      displayName: target.displayName,
      enabled: target.enabled,
      required: target.required,
    })),
  };
}

function normalizePublishTextTemplate(value: Prisma.JsonValue) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return defaultPublishTextTemplate();
  }
  const record = value as Record<string, unknown>;
  return {
    customText: typeof record.customText === "string" ? record.customText : "",
    suffixText: typeof record.suffixText === "string" ? record.suffixText : "",
    includePostId: typeof record.includePostId === "boolean" ? record.includePostId : true,
    includeAuthorMention: typeof record.includeAuthorMention === "boolean" ? record.includeAuthorMention : false,
    includeLinks: typeof record.includeLinks === "boolean" ? record.includeLinks : false,
  };
}

function defaultPublishTextTemplate() {
  return {
    customText: "",
    suffixText: "",
    includePostId: true,
    includeAuthorMention: false,
    includeLinks: false,
  };
}

function toBotSession(session: {
  id: string;
  type: string;
  domain: string;
  refreshedAt: Date;
  expiresAt: Date | null;
  healthStatus: string;
  healthCheckedAt: Date | null;
  healthMessage: string | null;
}) {
  return {
    id: session.id,
    type: session.type,
    domain: session.domain,
    refreshedAt: session.refreshedAt.toISOString(),
    expiresAt: session.expiresAt?.toISOString() ?? null,
    status: session.expiresAt && session.expiresAt.getTime() <= Date.now() ? "expired" : session.healthStatus,
    checkedAt: session.healthCheckedAt?.toISOString() ?? null,
    message: session.healthMessage,
  };
}

function extractCookiesFromActionData(data: unknown) {
  if (typeof data === "string") {
    return data;
  }
  if (data && typeof data === "object" && "cookies" in data) {
    const cookies = (data as { cookies?: unknown }).cookies;
    if (typeof cookies === "string") {
      return cookies;
    }
    if (cookies && typeof cookies === "object") {
      return Object.entries(cookies as Record<string, unknown>)
        .map(([name, value]) => `${name}=${String(value)}`)
        .join("; ");
    }
  }
  throw new Error("协议端没有返回 cookies 数据");
}

function toCookieRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).flatMap(([name, cookieValue]) => (typeof cookieValue === "string" ? [[name, cookieValue]] : [])),
  );
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
  nextRunAt: Date | null;
  externalId: string | null;
  qzoneTid: string | null;
  verbose: Prisma.JsonValue | null;
  updatedAt: Date;
  post: {
    id: string;
    displayId: number;
    text: string;
    anonymous: boolean;
    status: string;
    author: {
      qqUin: bigint;
      displayName: string | null;
    };
  };
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
    nextRunAt: attempt.nextRunAt?.toISOString() ?? null,
    externalId: attempt.externalId,
    qzoneTid: attempt.qzoneTid,
    verbose: attempt.verbose,
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
    post: {
      id: attempt.post.id,
      displayId: attempt.post.displayId,
      text: attempt.post.text,
      anonymous: attempt.post.anonymous,
      status: attempt.post.status,
      author: {
        qqUin: attempt.post.author.qqUin.toString(),
        displayName: attempt.post.author.displayName,
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
