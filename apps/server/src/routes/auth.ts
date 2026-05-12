import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { clearSessionCookie, createSession, getCookie, getSessionContext, hashToken, sessionCookieName, setSessionCookie } from "../lib/auth";
import { prisma } from "../lib/prisma";
import { toMembership, toPublicUser, toTenantSummary } from "../lib/serializers";

const loginSchema = z.object({
  qqUin: z.string().min(1),
  password: z.string().min(1),
});

const selectTenantSchema = z.object({
  tenantId: z.string().min(1),
});

export function registerAuthRoutes(app: FastifyInstance) {
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

    if (!user || !(await Bun.password.verify(body.password, user.passwordHash))) {
      return reply.code(401).send({
        message: "账号或密码错误",
      });
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
      needsTenantSelection: user.memberships.length > 1,
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
      needsTenantSelection: context.memberships.length > 1 && !context.selectedTenant,
    };
  });

  app.post("/api/session/tenant", async (request, reply) => {
    const context = await getSessionContext(request);
    if (!context) {
      return reply.code(401).send({ message: "请先登录" });
    }

    const body = selectTenantSchema.parse(request.body);
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
    };
  });
}
