import { createHash, randomBytes } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { SystemRole, TenantRole } from "@campux/db";
import { prisma } from "./prisma";
import { findTenantByRequestHost } from "./tenant-host";

export const sessionCookieName = "campux_session";
const sessionMaxAgeSeconds = 60 * 60 * 24 * 7;

export type SessionContext = Awaited<ReturnType<typeof getSessionContext>>;
export type ActiveBanContext = Awaited<ReturnType<typeof findActiveBan>>;

const tenantSummaryInclude = {
  metadata: {
    where: {
      key: "logo_url" as const,
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
          status: "pending_approval" as const,
        },
      },
    },
  },
};

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function issueSessionToken() {
  return randomBytes(32).toString("base64url");
}

function serializeSessionCookie(value: string, maxAgeSeconds: number) {
  return [
    `${sessionCookieName}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
    process.env.NODE_ENV === "production" ? "Secure" : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join("; ");
}

export function setSessionCookie(reply: FastifyReply, token: string) {
  reply.header("Set-Cookie", serializeSessionCookie(token, sessionMaxAgeSeconds));
}

export function clearSessionCookie(reply: FastifyReply) {
  reply.header("Set-Cookie", serializeSessionCookie("", 0));
}

export function getCookie(request: FastifyRequest, name: string) {
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) {
    return undefined;
  }

  for (const part of cookieHeader.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (rawKey === name) {
      return decodeURIComponent(rawValue.join("="));
    }
  }

  return undefined;
}

export async function createSession(userId: string, selectedTenantId?: string | null) {
  const token = issueSessionToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + sessionMaxAgeSeconds * 1000);

  await prisma.accountSession.create({
    data: {
      userId,
      tokenHash,
      selectedTenantId: selectedTenantId ?? null,
      expiresAt,
    },
  });

  return token;
}

export async function getSessionContext(request: FastifyRequest) {
  const token = getCookie(request, sessionCookieName);
  if (!token) {
    return null;
  }

  const session = await prisma.accountSession.findUnique({
    where: {
      tokenHash: hashToken(token),
    },
    include: {
      selectedTenant: {
        include: tenantSummaryInclude,
      },
      user: {
        include: {
          memberships: {
            include: {
              tenant: {
                include: tenantSummaryInclude,
              },
            },
            orderBy: {
              createdAt: "asc",
            },
          },
        },
      },
    },
  });

  if (!session || session.expiresAt.getTime() <= Date.now()) {
    if (session) {
      await prisma.accountSession.delete({ where: { id: session.id } });
    }
    return null;
  }

  const hostTenant = await findTenantByRequestHost(request);
  if (hostTenant) {
    const hostMembership = session.user.memberships.find((membership) => membership.tenantId === hostTenant.id);
    if (!hostMembership) {
      return null;
    }
    if (session.selectedTenantId !== hostTenant.id) {
      await prisma.accountSession.update({
        where: { id: session.id },
        data: { selectedTenantId: hostTenant.id },
      });
      session.selectedTenantId = hostTenant.id;
      session.selectedTenant = hostTenant;
    }

    const activeBan = await findActiveBan(hostTenant.id, session.user.id);

    return {
      session,
      user: session.user,
      memberships: [hostMembership],
      selectedTenant: hostTenant,
      selectedMembership: hostMembership,
      activeBan,
      hostTenant,
    };
  }

  const selectedMembership = session.selectedTenantId
    ? session.user.memberships.find((membership) => membership.tenantId === session.selectedTenantId)
    : null;

  return {
    session,
    user: session.user,
    memberships: session.user.memberships,
    selectedTenant: session.selectedTenant,
    selectedMembership,
    activeBan: session.selectedTenantId ? await findActiveBan(session.selectedTenantId, session.user.id) : null,
    hostTenant: null,
  };
}

export async function findActiveBan(tenantId: string, userId: string) {
  return prisma.banRecord.findFirst({
    where: {
      tenantId,
      userId,
      endsAt: {
        gt: new Date(),
      },
    },
    orderBy: {
      endsAt: "desc",
    },
  });
}

export async function requireSession(request: FastifyRequest, reply: FastifyReply) {
  const context = await getSessionContext(request);
  if (!context) {
    reply.code(401);
    throw new Error("请先登录");
  }

  return context;
}

export async function requireTenantContext(request: FastifyRequest, reply: FastifyReply) {
  const context = await requireSession(request, reply);
  if (!context.selectedTenant || !context.selectedMembership) {
    reply.code(400);
    throw new Error("请先选择校园墙");
  }
  if (context.activeBan) {
    reply.code(403);
    throw new Error(`账号已被封禁：${context.activeBan.comment}`);
  }
  if (context.user.passwordChangeRequired) {
    reply.code(403);
    throw new Error("请先修改初始密码");
  }

  return {
    ...context,
    selectedTenant: context.selectedTenant,
    selectedMembership: context.selectedMembership,
  };
}

const roleRank: Record<TenantRole, number> = {
  submitter: 1,
  reviewer: 2,
  admin: 3,
};

export function hasTenantRole(actualRole: TenantRole, requiredRole: TenantRole) {
  return (roleRank[actualRole] ?? 0) >= (roleRank[requiredRole] ?? Number.POSITIVE_INFINITY);
}

export async function requireTenantRole(request: FastifyRequest, reply: FastifyReply, requiredRole: TenantRole) {
  const context = await requireTenantContext(request, reply);
  if (!hasTenantRole(context.selectedMembership.role, requiredRole)) {
    reply.code(403);
    throw new Error("没有权限执行此操作");
  }

  return context;
}

export async function requireSystemOperator(request: FastifyRequest, reply: FastifyReply) {
  const context = await requireSession(request, reply);
  if (context.user.systemRole !== "system_operator") {
    reply.code(403);
    throw new Error("没有系统运维权限");
  }

  return context;
}

export function isPlatformAdminRole(role: SystemRole | null) {
  return role === "operations_admin" || role === "system_operator";
}

export async function requirePlatformAdmin(request: FastifyRequest, reply: FastifyReply) {
  const context = await requireSession(request, reply);
  if (!isPlatformAdminRole(context.user.systemRole)) {
    reply.code(403);
    throw new Error("没有运营管理权限");
  }

  return context;
}
