import type { FastifyInstance } from "fastify";
import type { CampuxConfig } from "@campux/config";
import { hashPassword, Prisma, verifyPassword } from "@campux/db";
import { randomInt } from "node:crypto";
import { z } from "zod";
import { clearSessionCookie, createSession, findActiveBan, getCookie, getSessionContext, hashToken, requireSession, sessionCookieName, setSessionCookie } from "../lib/auth";
import { generateEmailCode, hashEmailCode, normalizeEmail, sendVerificationEmail } from "../lib/email";
import { prisma } from "../lib/prisma";
import { toMembership, toPublicUser, toTenantSummary } from "../lib/serializers";
import { resolveEffectiveTenantMembership } from "../lib/tenant-access";
import { findManagementHostByRequest, findTenantByRequestHost } from "../lib/tenant-host";
import { getDeployMode, resolveSingleModeTenantId } from "../lib/deploy-mode";

const loginSchema = z.object({
  account: z.string().trim().min(1).optional(),
  qqUin: z.string().trim().min(1).optional(),
  password: z.string().min(1),
});

const emailSchema = z.string().trim().email("邮箱格式不正确").max(255);

const updateMeSettingsSchema = z.object({
  autoFollowOwnPosts: z.boolean().optional(),
});

const requestRegisterCodeSchema = z.object({
  email: emailSchema,
});

const registerSchema = z.object({
  email: emailSchema,
  code: z.string().trim().regex(/^\d{6}$/, "验证码格式不正确"),
  displayName: z.string().trim().min(1, "账户名称不能为空").max(80, "账户名称最多 80 个字符"),
  password: z.string().min(6).max(128),
});

const selectTenantSchema = z.object({
  tenantId: z.string().min(1),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6).max(128),
});

const updateProfileSchema = z.object({
  displayName: z.string().trim().min(1, "账户名称不能为空").max(80, "账户名称最多 80 个字符"),
});

const requiredPasswordChangeSchema = z.object({
  newPassword: z.string().min(6).max(128),
});

export function registerAuthRoutes(app: FastifyInstance, config: CampuxConfig) {
  app.get("/api/auth/context", async (request) => {
    const [managementHost, hostTenant, deployMode] = await Promise.all([
      findManagementHostByRequest(request),
      findTenantByRequestHost(request),
      getDeployMode(),
    ]);
    return {
      managementHost: Boolean(managementHost),
      currentTenant: hostTenant ? toTenantSummary(hostTenant) : null,
      deployMode,
    };
  });

  app.post("/api/auth/login", async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const account = (body.account ?? body.qqUin ?? "").trim();
    const email = account.includes("@") ? normalizeEmail(account) : null;
    const qqUin = /^\d+$/.test(account) ? BigInt(account) : null;
    if (!email && qqUin === null) {
      return reply.code(400).send({ message: "请输入 QQ 号或邮箱" });
    }
    const user = await prisma.user.findUnique({
      where: email ? { email } : { qqUin: qqUin! },
      include: {
        memberships: {
          include: {
            tenant: {
              include: {
                metadata: {
                  where: {
                    key: "logo_url",
                  },
                },
                aiSettings: {
                  select: {
                    enabled: true,
                  },
                },
                _count: {
                  select: {
                    botAccounts: true,
                    posts: {
                      where: {
                        status: "pending_approval",
                      },
                    },
                  },
                },
              },
            },
          },
          orderBy: {
            createdAt: "asc",
          },
        },
      },
    });

    if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
      return reply.code(401).send({
        message: "账号或密码错误",
      });
    }

    if (user.isTestAccount && config.nodeEnv !== "development") {
      return reply.code(403).send({
        message: "测试账号只能在开发环境登录",
      });
    }

    const hostTenant = await findTenantByRequestHost(request);
    if (hostTenant) {
      const hostMembership = user.memberships.find((membership) => membership.tenantId === hostTenant.id);
      const effectiveMembership = resolveEffectiveTenantMembership({
        userId: user.id,
        systemRole: user.systemRole,
        tenantId: hostTenant.id,
        memberships: user.memberships,
      });
      if (!effectiveMembership) {
        return reply.code(403).send({
          message: "该账号没有访问当前校园墙的权限",
        });
      }

      const token = await createSession(user.id, hostTenant.id);
      setSessionCookie(reply, token);
      const visibleMemberships = hostMembership === undefined ? [] : [toMembership(hostMembership)];

      return {
        authenticated: true,
        user: toPublicUser(user),
        memberships: visibleMemberships,
        currentTenant: toTenantSummary(hostTenant),
        currentMembership: { id: effectiveMembership.id, role: effectiveMembership.role },
        activeBan: hostMembership ? toActiveBan(await findActiveBan(hostTenant.id, user.id)) : null,
        needsTenantSelection: false,
        hostLocked: true,
      };
    }

    const systemAccessibleTenants = await listSystemAccessibleTenants(user.systemRole);
    // Single-mode: bind directly to the sole wall so the operator never sees a
    // wall picker (mirrors getSessionContext's auto-selection).
    const singleModeTenantId = await resolveSingleModeTenantId();
    const singleModeMembership = singleModeTenantId
      ? resolveEffectiveTenantMembership({
          userId: user.id,
          systemRole: user.systemRole,
          tenantId: singleModeTenantId,
          memberships: user.memberships,
        })
      : null;
    const visibleMemberships = user.memberships.filter((membership) => membership.tenant.status !== "archived");
    const onlyMembership = singleModeTenantId
      ? user.memberships.find((membership) => membership.tenantId === singleModeTenantId)
        ?? (singleModeMembership ? user.memberships[0] : undefined)
      : user.systemRole === "system_operator" ? undefined : visibleMemberships.length === 1 ? visibleMemberships[0] : undefined;
    const selectedTenantId = singleModeTenantId && singleModeMembership ? singleModeTenantId : onlyMembership?.tenantId ?? null;
    const token = await createSession(user.id, selectedTenantId);
    setSessionCookie(reply, token);

    if (singleModeTenantId && singleModeMembership) {
      const tenant = await prisma.tenant.findUnique({
        where: { id: singleModeTenantId },
        include: {
          metadata: { where: { key: "logo_url" } },
          aiSettings: { select: { enabled: true } },
          _count: { select: { botAccounts: true, posts: { where: { status: "pending_approval" } } } },
        },
      });
      const ban = user.memberships.some((m) => m.tenantId === singleModeTenantId) ? await findActiveBan(singleModeTenantId, user.id) : null;
      return {
        authenticated: true,
        user: toPublicUser(user),
        memberships: user.memberships.map(toMembership),
        systemAccessibleTenants,
        currentTenant: tenant ? toTenantSummary(tenant) : null,
        currentMembership: { id: singleModeMembership.id, role: singleModeMembership.role },
        activeBan: toActiveBan(ban),
        needsTenantSelection: false,
        hostLocked: false,
      };
    }

    return {
      authenticated: true,
      user: toPublicUser(user),
      memberships: user.memberships.map(toMembership),
      systemAccessibleTenants,
      currentTenant: onlyMembership ? toTenantSummary(onlyMembership.tenant) : null,
      currentMembership: onlyMembership ? { id: onlyMembership.id, role: onlyMembership.role } : null,
      activeBan: onlyMembership ? toActiveBan(await findActiveBan(onlyMembership.tenantId, user.id)) : null,
      needsTenantSelection: !selectedTenantId && (visibleMemberships.length > 1 || systemAccessibleTenants.length > 0),
      hostLocked: false,
    };
  });

  app.post("/api/auth/register/request-code", async (request, reply) => {
    const managementHost = await findManagementHostByRequest(request);
    if (!managementHost) {
      return reply.code(404).send({ message: "当前入口不开放注册" });
    }

    const body = requestRegisterCodeSchema.parse(request.body);
    const email = normalizeEmail(body.email);
    const existing = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existing) {
      return reply.code(409).send({ message: "这个邮箱已经注册，请直接登录" });
    }

    const code = generateEmailCode();
    await prisma.emailVerificationCode.create({
      data: {
        email,
        codeHash: hashEmailCode(email, code),
        purpose: "operations_admin_register",
        expiresAt: new Date(Date.now() + 10 * 60 * 1_000),
      },
    });
    const sent = await sendVerificationEmail(config, { to: email, code });

    return {
      ok: true,
      ...(sent.skipped ? { devCode: code } : {}),
    };
  });

  app.post("/api/auth/register", async (request, reply) => {
    const managementHost = await findManagementHostByRequest(request);
    if (!managementHost) {
      return reply.code(404).send({ message: "当前入口不开放注册" });
    }

    const body = registerSchema.parse(request.body);
    const email = normalizeEmail(body.email);
    const existing = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existing) {
      return reply.code(409).send({ message: "这个邮箱已经注册，请直接登录" });
    }

    const record = await prisma.emailVerificationCode.findFirst({
      where: {
        email,
        purpose: "operations_admin_register",
        consumedAt: null,
        expiresAt: {
          gt: new Date(),
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });
    if (!record) {
      return reply.code(400).send({ message: "验证码不存在或已过期" });
    }
    if (record.attempts >= 5) {
      return reply.code(429).send({ message: "验证码尝试次数过多，请重新获取" });
    }
    if (record.codeHash !== hashEmailCode(email, body.code)) {
      await prisma.emailVerificationCode.update({
        where: { id: record.id },
        data: { attempts: { increment: 1 } },
      });
      return reply.code(400).send({ message: "验证码不正确" });
    }

    const user = await prisma.$transaction(async (tx) => {
      await tx.emailVerificationCode.update({
        where: { id: record.id },
        data: {
          consumedAt: new Date(),
          attempts: { increment: 1 },
        },
      });

      return tx.user.create({
        data: {
          qqUin: await generateSyntheticQqUin(tx),
          email,
          displayName: body.displayName,
          passwordHash: await hashPassword(body.password),
          passwordChangeRequired: false,
          isTestAccount: false,
          systemRole: "operations_admin",
        },
      });
    });

    const token = await createSession(user.id, null);
    setSessionCookie(reply, token);

    return {
      authenticated: true,
      user: toPublicUser(user),
      memberships: [],
      systemAccessibleTenants: [],
      currentTenant: null,
      currentMembership: null,
      activeBan: null,
      needsTenantSelection: false,
      hostLocked: false,
    };
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const token = getCookie(request, sessionCookieName);
    if (token) {
      await prisma.accountSession.deleteMany({
        where: {
          tokenHash: hashToken(token),
        },
      });
    }

    clearSessionCookie(reply);
    return { ok: true };
  });

  app.post("/api/auth/password", async (request, reply) => {
    const context = await requireSession(request, reply);
    const body = changePasswordSchema.parse(request.body);
    const user = await prisma.user.findUniqueOrThrow({
      where: {
        id: context.user.id,
      },
    });

    if (!(await verifyPassword(body.currentPassword, user.passwordHash))) {
      return reply.code(401).send({ message: "当前密码不正确" });
    }

    await prisma.user.update({
      where: {
        id: user.id,
      },
      data: {
        passwordHash: await hashPassword(body.newPassword),
        passwordChangeRequired: false,
      },
    });

    return { ok: true };
  });

  app.patch("/api/auth/profile", async (request, reply) => {
    const context = await requireSession(request, reply);
    const body = updateProfileSchema.parse(request.body);

    const user = await prisma.user.update({
      where: {
        id: context.user.id,
      },
      data: {
        displayName: body.displayName,
      },
    });

    return {
      ok: true,
      user: toPublicUser(user),
    };
  });

  app.post("/api/auth/password/required", async (request, reply) => {
    const context = await requireSession(request, reply);
    const body = requiredPasswordChangeSchema.parse(request.body);
    if (!context.user.passwordChangeRequired) {
      return reply.code(409).send({ message: "当前账号不需要强制修改密码" });
    }

    await prisma.user.update({
      where: {
        id: context.user.id,
      },
      data: {
        passwordHash: await hashPassword(body.newPassword),
        passwordChangeRequired: false,
      },
    });

    return { ok: true };
  });

  app.get("/api/me", async (request) => {
    const context = await getSessionContext(request);
    if (!context) {
      return {
        authenticated: false,
      };
    }

    const systemAccessibleTenants = await listSystemAccessibleTenants(context.user.systemRole);
    const visibleMemberships = context.memberships.filter((membership) => membership.tenant.status !== "archived");
    const needsTenantSelection = !context.selectedTenant && (visibleMemberships.length > 1 || systemAccessibleTenants.length > 0);

    return {
      authenticated: true,
      user: toPublicUser(context.user),
      memberships: context.memberships.map(toMembership),
      systemAccessibleTenants,
      currentTenant: context.selectedTenant ? toTenantSummary(context.selectedTenant) : null,
      currentMembership: context.selectedMembership
        ? { id: context.selectedMembership.id, role: context.selectedMembership.role }
        : null,
      activeBan: toActiveBan(context.activeBan),
      needsTenantSelection,
      hostLocked: Boolean(context.hostTenant),
    };
  });

  app.patch("/api/me/settings", async (request, reply) => {
    const context = await getSessionContext(request);
    if (!context) {
      return reply.code(401).send({ message: "请先登录" });
    }
    const body = updateMeSettingsSchema.parse(request.body ?? {});
    if (body.autoFollowOwnPosts === undefined) {
      return { user: toPublicUser(context.user) };
    }
    const user = await prisma.user.update({
      where: { id: context.user.id },
      data: { autoFollowOwnPosts: body.autoFollowOwnPosts },
    });
    return { user: toPublicUser(user) };
  });

  app.post("/api/session/tenant", async (request, reply) => {
    const context = await getSessionContext(request);
    if (!context) {
      return reply.code(401).send({ message: "请先登录" });
    }

    const body = selectTenantSchema.parse(request.body);
    if (context.user.passwordChangeRequired) {
      return reply.code(403).send({ message: "请先修改初始密码" });
    }

    const hostTenant = await findTenantByRequestHost(request);
    if (hostTenant && body.tenantId !== hostTenant.id) {
      return reply.code(403).send({ message: "当前域名只能访问对应的校园墙" });
    }

    const membership = context.memberships.find((item) => item.tenantId === body.tenantId);
    const effectiveMembership = resolveEffectiveTenantMembership({
      userId: context.user.id,
      systemRole: context.user.systemRole,
      tenantId: body.tenantId,
      memberships: context.memberships,
    });
    if (!effectiveMembership) {
      return reply.code(403).send({ message: "没有访问该校园墙的权限" });
    }

    await prisma.accountSession.update({
      where: { id: context.session.id },
      data: { selectedTenantId: body.tenantId },
    });

    const tenant = await prisma.tenant.findUniqueOrThrow({
      where: { id: body.tenantId },
      include: {
        metadata: {
          where: {
            key: "logo_url",
          },
        },
        aiSettings: {
          select: {
            enabled: true,
          },
        },
        _count: {
          select: {
            botAccounts: true,
            posts: {
              where: {
                status: "pending_approval",
              },
            },
          },
        },
      },
    });

    return {
      ok: true,
      currentTenant: toTenantSummary(tenant),
      currentMembership: { id: effectiveMembership.id, role: effectiveMembership.role },
      activeBan: membership ? toActiveBan(await findActiveBan(body.tenantId, context.user.id)) : null,
    };
  });
}

async function generateSyntheticQqUin(tx: Prisma.TransactionClient) {
  for (let index = 0; index < 10; index += 1) {
    const candidate = BigInt(`8${Date.now()}${randomInt(100, 999)}`);
    const existing = await tx.user.findUnique({
      where: { qqUin: candidate },
      select: { id: true },
    });
    if (!existing) {
      return candidate;
    }
  }

  throw new Error("无法生成账号编号，请稍后再试");
}

function toActiveBan(ban: Awaited<ReturnType<typeof findActiveBan>>) {
  if (!ban) {
    return null;
  }

  return {
    id: ban.id,
    comment: ban.comment,
    startsAt: ban.startsAt.toISOString(),
    endsAt: ban.endsAt.toISOString(),
    createdAt: ban.createdAt.toISOString(),
  };
}

async function listSystemAccessibleTenants(systemRole: string | null) {
  if (systemRole !== "system_operator") {
    return [];
  }

  const tenants = await prisma.tenant.findMany({
    where: {
      status: {
        not: "archived",
      },
    },
    include: {
      metadata: {
        where: {
          key: "logo_url",
        },
      },
      aiSettings: {
        select: {
          enabled: true,
        },
      },
      _count: {
        select: {
          botAccounts: true,
          posts: {
            where: {
              status: "pending_approval",
            },
          },
        },
      },
    },
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
  });

  return tenants.map(toTenantSummary);
}
