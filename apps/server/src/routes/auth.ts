import type { FastifyInstance } from "fastify";
import type { CampuxConfig } from "@campux/config";
import { hashPassword, verifyPassword } from "@campux/db";
import { z } from "zod";
import { clearSessionCookie, createSession, findActiveBan, getCookie, getSessionContext, hashToken, requireSession, sessionCookieName, setSessionCookie } from "../lib/auth";
import { prisma } from "../lib/prisma";
import { toMembership, toPublicUser, toTenantSummary } from "../lib/serializers";
import { findTenantByRequestHost } from "../lib/tenant-host";

const loginSchema = z.object({
  qqUin: z.string().regex(/^\d+$/, "QQ 号格式不正确"),
  password: z.string().min(1),
});

const selectTenantSchema = z.object({
  tenantId: z.string().min(1),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6).max(128),
});

export function registerAuthRoutes(app: FastifyInstance, config: CampuxConfig) {
  app.post("/api/auth/login", async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const qqUin = BigInt(body.qqUin);
    const user = await prisma.user.findUnique({
      where: { qqUin },
      include: {
        memberships: {
          include: {
            tenant: {
              include: {
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
      if (!hostMembership) {
        return reply.code(403).send({
          message: "该账号没有访问当前校园墙的权限",
        });
      }

      const token = await createSession(user.id, hostTenant.id);
      setSessionCookie(reply, token);

      return {
        authenticated: true,
        user: toPublicUser(user),
        memberships: [toMembership(hostMembership)],
        currentTenant: toTenantSummary(hostTenant),
        currentMembership: { id: hostMembership.id, role: hostMembership.role },
        activeBan: toActiveBan(await findActiveBan(hostTenant.id, user.id)),
        needsTenantSelection: false,
        hostLocked: true,
      };
    }

    const onlyMembership = user.memberships.length === 1 ? user.memberships[0] : undefined;
    const selectedTenantId = onlyMembership?.tenantId ?? null;
    const token = await createSession(user.id, selectedTenantId);
    setSessionCookie(reply, token);

    return {
      authenticated: true,
      user: toPublicUser(user),
      memberships: user.memberships.map(toMembership),
      currentTenant: onlyMembership ? toTenantSummary(onlyMembership.tenant) : null,
      currentMembership: onlyMembership ? { id: onlyMembership.id, role: onlyMembership.role } : null,
      activeBan: onlyMembership ? toActiveBan(await findActiveBan(onlyMembership.tenantId, user.id)) : null,
      needsTenantSelection: user.memberships.length > 1,
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

    return {
      authenticated: true,
      user: toPublicUser(context.user),
      memberships: context.memberships.map(toMembership),
      currentTenant: context.selectedTenant ? toTenantSummary(context.selectedTenant) : null,
      currentMembership: context.selectedMembership
        ? { id: context.selectedMembership.id, role: context.selectedMembership.role }
        : null,
      activeBan: toActiveBan(context.activeBan),
      needsTenantSelection: context.memberships.length > 1 && !context.selectedTenant,
      hostLocked: Boolean(context.hostTenant),
    };
  });

  app.post("/api/session/tenant", async (request, reply) => {
    const context = await getSessionContext(request);
    if (!context) {
      return reply.code(401).send({ message: "请先登录" });
    }

    const body = selectTenantSchema.parse(request.body);
    const hostTenant = await findTenantByRequestHost(request);
    if (hostTenant && body.tenantId !== hostTenant.id) {
      return reply.code(403).send({ message: "当前域名只能访问对应的校园墙" });
    }

    const membership = context.memberships.find((item) => item.tenantId === body.tenantId);
    if (!membership && context.user.systemRole !== "system_operator") {
      return reply.code(403).send({ message: "没有访问该校园墙的权限" });
    }

    await prisma.accountSession.update({
      where: { id: context.session.id },
      data: { selectedTenantId: body.tenantId },
    });

    const tenant = await prisma.tenant.findUniqueOrThrow({
      where: { id: body.tenantId },
      include: {
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
      currentMembership: membership ? { id: membership.id, role: membership.role } : null,
      activeBan: membership ? toActiveBan(await findActiveBan(body.tenantId, context.user.id)) : null,
    };
  });
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
