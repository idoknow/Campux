import type { FastifyInstance, FastifyRequest } from "fastify";
import type { CampuxConfig } from "@campux/config";
import { hashPassword, Prisma, TransactionIsolationLevel, verifyPassword } from "@campux/db";
import { randomInt } from "node:crypto";
import { z } from "zod";
import { clearSessionCookie, createSession, findActiveBan, getCookie, getSessionContext, hashToken, requireSession, sessionCookieName, setSessionCookie } from "../lib/auth";
import { generateEmailCode, hashEmailCode, normalizeEmail, sendEmail, sendVerificationEmail } from "../lib/email";
import { readTenantOperateMode } from "../lib/tenant-metadata";
import { readTenantPluginConfig } from "../lib/tenant-plugin-config";
import { prisma } from "../lib/prisma";
import { toMembership, toPublicUser, toTenantSummary } from "../lib/serializers";
import { resolveEffectiveTenantMembership } from "../lib/tenant-access";
import { isTransactionSerializationFailure, retryTransactionSerializationFailures } from "../lib/tenant-membership-removal";
import { findManagementHostByRequest, findTenantByRequestHost } from "../lib/tenant-host";
import { getDeployMode, resolveSingleModeTenantId } from "../lib/deploy-mode";

const loginSchema = z.object({
  account: z.string().trim().min(1).optional(),
  qqUin: z.string().trim().min(1).optional(),
  password: z.string().min(1),
});

const emailSchema = z
  .string()
  .trim()
  .regex(/^[1-9]\d{4,9}@qq\.com$/i, "只能使用 QQ 邮箱，例如 123456@qq.com")
  .max(255);

const registerQqUinFromEmail = (email: string) => {
  const trimmed = email.trim();
  const [qqNumber] = trimmed.split("@");
  if (!qqNumber || !/^[1-9]\d{4,9}$/.test(qqNumber)) return null;
  return BigInt(qqNumber);
};

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

// 游客投稿：直接用 QQ 号作账号注册，不要求 QQ 邮箱验证码。
const tenantRegisterSchema = z.object({
  qqUin: z.string().trim().regex(/^[1-9]\d{4,11}$/, "请输入正确的 QQ 号"),
  displayName: z.string().trim().min(1, "用户名不能为空").max(80, "用户名最多 80 个字符"),
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

// 忘记密码：用 QQ 号 + 该账号绑定的 QQ 邮箱验证码重置（未登录入口）。
const forgotPasswordSchema = z.object({
  account: z.string().trim().min(1, "请输入 QQ 号或邮箱"),
});

const resetPasswordSchema = z.object({
  account: z.string().trim().min(1, "请输入 QQ 号或邮箱"),
  code: z.string().trim().regex(/^\d{6}$/, "验证码格式不正确"),
  newPassword: z.string().min(6).max(128),
});

// 绑定邮箱：允许任意有效邮箱（不限于 QQ 邮箱），用于接收通知与找回密码。
export const bindEmailSchema = z
  .string()
  .trim()
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "请输入有效的邮箱地址")
  .max(255);

const bindEmailRequestCodeSchema = z.object({ email: bindEmailSchema });
const bindEmailConfirmSchema = z.object({ email: bindEmailSchema, code: z.string().trim().regex(/^\d{6}$/, "验证码格式不正确") });
const unbindEmailSchema = z.object({ password: z.string().min(1, "请输入当前密码") });

const RESET_PASSWORD_PURPOSE = "password_reset";
// 验证码频率限制：60 秒内只能发一次；同一账号 1 小时最多 5 次。
const RESET_CODE_COOLDOWN_SECONDS = 60;
const RESET_CODE_HOURLY_LIMIT = 5;
const RESET_CODE_TTL_SECONDS = 10 * 60;

const BIND_EMAIL_PURPOSE = "email_bind";
const BIND_CODE_TTL_SECONDS = 10 * 60;
// 按账号（登录用户）的发送限流：防止同一账号向大量不同地址发信。
const ACCOUNT_SEND_COOLDOWN_SECONDS = 60;
const ACCOUNT_SEND_HOURLY_LIMIT = 10;
// 邮件投递的兜底超时：避免服务商卡住时请求一直挂着。
const BIND_EMAIL_SEND_TIMEOUT_MS = 15_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => rejectPromise(new Error("email send timed out")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolvePromise(value);
      },
      (error) => {
        clearTimeout(timer);
        rejectPromise(error);
      },
    );
  });
}

type DbClient = Prisma.TransactionClient | typeof prisma;

/** 频率限制检查：返回需要拒绝时的提示与重试秒数。 */
async function checkCodeRateLimit(client: DbClient, key: string, purpose: string) {
  const now = Date.now();
  const sinceHour = new Date(now - 60 * 60 * 1_000);
  const recent = await client.emailVerificationCode.findMany({
    where: {
      email: key,
      purpose,
      createdAt: { gte: sinceHour },
    },
    select: { createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  const latest = recent[0];
  if (latest) {
    const elapsedSeconds = (now - latest.createdAt.getTime()) / 1_000;
    if (elapsedSeconds < RESET_CODE_COOLDOWN_SECONDS) {
      return {
        retryAfterSeconds: Math.ceil(RESET_CODE_COOLDOWN_SECONDS - elapsedSeconds),
        reason: "cooldown" as const,
      };
    }
  }
  if (recent.length >= RESET_CODE_HOURLY_LIMIT) {
    return { retryAfterSeconds: 60 * 60, reason: "hourly" as const };
  }
  return null;
}

async function checkResetCodeRateLimit(key: string) {
  return checkCodeRateLimit(prisma, key, RESET_PASSWORD_PURPOSE);
}

/**
 * 按账号（登录用户）限制发码频率：只按收件地址限流时，同一账号可以给大量地址发信。
 * 与收件地址的限流相互独立，两者都通过才允许发码。
 */
async function checkAccountSendLimit(client: DbClient, userId: string, purpose: string) {
  const now = Date.now();
  const sinceHour = new Date(now - 60 * 60 * 1_000);
  const recent = await client.emailVerificationCode.findMany({
    where: { userId, purpose, createdAt: { gte: sinceHour } },
    select: { createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  const latest = recent[0];
  if (latest) {
    const elapsedSeconds = (now - latest.createdAt.getTime()) / 1_000;
    if (elapsedSeconds < ACCOUNT_SEND_COOLDOWN_SECONDS) {
      return {
        retryAfterSeconds: Math.ceil(ACCOUNT_SEND_COOLDOWN_SECONDS - elapsedSeconds),
        reason: "cooldown" as const,
      };
    }
  }
  if (recent.length >= ACCOUNT_SEND_HOURLY_LIMIT) {
    return { retryAfterSeconds: 60 * 60, reason: "hourly" as const };
  }
  return null;
}

/** 取 zod 校验失败的首条中文提示，避免 .parse() 抛错变成 500。 */
function firstIssueMessage(result: { success: false; error: { issues: Array<{ message?: string }> } }, fallback: string) {
  return result.error.issues[0]?.message ?? fallback;
}

function parseAccountKey(account: string): { email: string } | { qqUin: bigint } | null {
  const value = account.trim();
  if (value.includes("@")) {
    return { email: normalizeEmail(value) };
  }
  return /^\d+$/.test(value) ? { qqUin: BigInt(value) } : null;
}

/** 只回显邮箱首尾，避免把完整地址发给未登录请求方。 */
function maskEmail(email: string) {
  const [name = "", domain = ""] = email.split("@");
  const head = name.slice(0, Math.min(2, name.length));
  return `${head}${name.length > 2 ? "***" : ""}@${domain}`;
}

export function registerAuthRoutes(app: FastifyInstance, config: CampuxConfig) {
  // 游客投稿：单墙部署的租户 host 为空，回退到唯一的单墙租户，否则注册入口永远不可用。
  async function resolvePublicTenantByRequest(request: FastifyRequest): Promise<{ id: string } | null> {
    const hostTenant = await findTenantByRequestHost(request);
    if (hostTenant) {
      return hostTenant;
    }
    const singleModeTenantId = await resolveSingleModeTenantId();
    return singleModeTenantId ? { id: singleModeTenantId } : null;
  }

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

      const token = await createSession(user.id, hostTenant.id, user.tokenVersion);
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
    const token = await createSession(user.id, selectedTenantId, user.tokenVersion);
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
    const qqUin = registerQqUinFromEmail(email);
    if (!qqUin) {
      return reply.code(400).send({ message: "只能使用 QQ 邮箱" });
    }
    const existing = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existing) {
      return reply.code(409).send({ message: "这个邮箱已经注册，请直接登录" });
    }
    const existingQqUser = await prisma.user.findUnique({
      where: { qqUin },
      select: { id: true },
    });
    if (existingQqUser) {
      return reply.code(409).send({ message: "这个 QQ 号已经注册，请直接登录" });
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
      ...(config.resend.exposeCode && sent.skipped ? { devCode: code } : {}),
    };
  });

  app.post("/api/auth/register", async (request, reply) => {
    const managementHost = await findManagementHostByRequest(request);
    if (!managementHost) {
      return reply.code(404).send({ message: "当前入口不开放注册" });
    }

    const body = registerSchema.parse(request.body);
    const email = normalizeEmail(body.email);
    const qqUin = registerQqUinFromEmail(email);
    if (!qqUin) {
      return reply.code(400).send({ message: "只能使用 QQ 邮箱" });
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
    const existing = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existing) {
      return reply.code(409).send({ message: "这个邮箱已经注册，请直接登录" });
    }
    const existingQqUser = await prisma.user.findUnique({
      where: { qqUin },
      select: { id: true },
    });
    if (existingQqUser) {
      return reply.code(409).send({ message: "这个 QQ 号已经注册，请直接登录" });
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
          qqUin,
          email,
          displayName: body.displayName,
          passwordHash: await hashPassword(body.password),
          passwordChangeRequired: false,
          isTestAccount: false,
          systemRole: "operations_admin",
        },
      });
    });

    const token = await createSession(user.id, null, user.tokenVersion);
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

  // 游客投稿：登录页在未登录时查询本墙是否开放 QQ 号自助注册。
  app.get("/api/auth/tenant-registration", async (request) => {
    const hostTenant = await resolvePublicTenantByRequest(request);
    if (!hostTenant) {
      return { enabled: false, operateMode: "bot" as const };
    }
    const [pluginConfig, operateMode] = await Promise.all([
      readTenantPluginConfig(prisma, hostTenant.id),
      readTenantOperateMode(prisma, hostTenant.id),
    ]);
    return { enabled: pluginConfig.guestSubmission.enabled, operateMode };
  });

  // 游客投稿：QQ 号 + 用户名 + 密码注册，注册后直接成为该墙的投稿用户并登录。
  app.post("/api/auth/tenant-register", async (request, reply) => {
    const hostTenant = await resolvePublicTenantByRequest(request);
    if (!hostTenant) {
      return reply.code(404).send({ message: "当前入口不开放注册" });
    }

    const pluginConfig = await readTenantPluginConfig(prisma, hostTenant.id);
    if (!pluginConfig.guestSubmission.enabled) {
      return reply.code(403).send({ message: "当前校园墙未开放注册，请联系管理员" });
    }

    const body = tenantRegisterSchema.parse(request.body);
    const qqUin = BigInt(body.qqUin);
    const existing = await prisma.user.findUnique({
      where: { qqUin },
      select: { id: true },
    });
    if (existing) {
      return reply.code(409).send({ message: "这个 QQ 号已经注册，请直接登录" });
    }

    const user = await prisma.user.create({
      data: {
        qqUin,
        displayName: body.displayName,
        passwordHash: await hashPassword(body.password),
        passwordChangeRequired: false,
        isTestAccount: false,
        systemRole: null,
      },
    });
    const membership = await prisma.tenantMembership.create({
      data: { tenantId: hostTenant.id, userId: user.id, role: "submitter" },
    });

    const token = await createSession(user.id, hostTenant.id, user.tokenVersion);
    setSessionCookie(reply, token);

    const tenant = await prisma.tenant.findUniqueOrThrow({
      where: { id: hostTenant.id },
      include: {
        metadata: { where: { key: "logo_url" } },
        aiSettings: { select: { enabled: true } },
        _count: { select: { botAccounts: true, posts: { where: { status: "pending_approval" } } } },
      },
    });

    return {
      authenticated: true,
      user: toPublicUser(user),
      memberships: [{ id: membership.id, role: membership.role, tenant: toTenantSummary(tenant) }],
      currentTenant: toTenantSummary(tenant),
      currentMembership: { id: membership.id, role: membership.role },
      activeBan: null,
      needsTenantSelection: false,
      hostLocked: true,
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

    const passwordHash = await hashPassword(body.newPassword);
    const sessionStale = await retryTransactionSerializationFailures(
      async () => {
        let stale = false;
        await prisma.$transaction(
          async (tx) => {
            // 条件更新：只有用户版本号仍等于 requireSession 当时接受的版本时才写。否则说明
            // 期间有人改过密码（并发改密 / 管理员重置），这个过期请求既不能改密，也不能把
            // 自己救活 —— 直接放弃整个事务。
            const updated = await tx.user.updateMany({
              where: { id: user.id, tokenVersion: context.session.tokenVersion },
              data: { passwordHash, passwordChangeRequired: false, tokenVersion: { increment: 1 } },
            });
            if (updated.count === 0) {
              stale = true;
              return;
            }
            // 递增密码版本号让其他设备上的旧会话失效；当前会话同步到新版本号，避免把自己踢下线。
            await tx.accountSession.update({
              where: { id: context.session.id },
              data: { tokenVersion: context.session.tokenVersion + 1 },
            });
          },
          { isolationLevel: TransactionIsolationLevel.Serializable },
        );
        return stale;
      },
      isTransactionSerializationFailure,
    );
    if (sessionStale) {
      return reply.code(409).send({ code: "SESSION_STALE", message: "登录状态已过期，请重新登录后重试" });
    }

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

    const passwordHash = await hashPassword(body.newPassword);
    const sessionStale = await retryTransactionSerializationFailures(
      async () => {
        let stale = false;
        await prisma.$transaction(
          async (tx) => {
            // 条件更新：只有用户版本号仍等于 requireSession 当时接受的版本时才写。否则说明
            // 期间有人改过密码（并发改密 / 管理员重置），这个过期请求既不能改密，也不能把
            // 自己救活 —— 直接放弃整个事务。
            const updated = await tx.user.updateMany({
              where: { id: context.user.id, tokenVersion: context.session.tokenVersion },
              data: { passwordHash, passwordChangeRequired: false, tokenVersion: { increment: 1 } },
            });
            if (updated.count === 0) {
              stale = true;
              return;
            }
            // 递增密码版本号让其他设备上的旧会话失效；当前会话同步到新版本号，避免把自己踢下线。
            await tx.accountSession.update({
              where: { id: context.session.id },
              data: { tokenVersion: context.session.tokenVersion + 1 },
            });
          },
          { isolationLevel: TransactionIsolationLevel.Serializable },
        );
        return stale;
      },
      isTransactionSerializationFailure,
    );
    if (sessionStale) {
      return reply.code(409).send({ code: "SESSION_STALE", message: "登录状态已过期，请重新登录后重试" });
    }

    return { ok: true };
  });

  // 忘记密码第一步：按 QQ 号 / 邮箱找到账号，向账号邮箱发验证码。
  // 只对绑定了邮箱的账号发送，且不向外泄露该账号是否存在（统一返回 ok）。
  app.post("/api/auth/password/forgot", async (request, reply) => {
    const body = forgotPasswordSchema.parse(request.body);
    const key = parseAccountKey(body.account);
    if (!key) {
      return reply.code(400).send({ message: "请输入 QQ 号或邮箱" });
    }
    const user = await prisma.user.findUnique({
      where: key,
      select: { id: true, email: true },
    });
    if (!user) {
      return reply.code(400).send({ message: "该账号不存在，请确认 QQ 号或邮箱" });
    }

    // 没绑定邮箱的账号（例如游客注册或扫码建号）：给账号名下的第三方身份生成验证码，
    // 由本人持有的第三方账号完成所有权验证，而不依赖邮箱。
    if (!user.email) {
      const identities = await prisma.oAuthIdentity.findMany({
        where: { userId: user.id },
        select: { provider: true, providerUserId: true },
      });
      if (identities.length === 0) {
        // 既没邮箱也没第三方身份：用专用错误码告知前端弹“联系管理员”提示，
        // 不再与“验证码错误”混为同一个模糊报错。
        return reply.code(409).send({
          code: "RESET_UNAVAILABLE",
          message: "该账号未绑定 QQ 邮箱或第三方登录，无法自助重置密码，请联系校园墙管理员重置。",
        });
      }
      const rateLimited = await checkResetCodeRateLimit(`identity:${user.id}`);
      if (rateLimited) {
        return reply.code(429).send({
          code: "RATE_LIMITED",
          message: rateLimited.reason === "cooldown"
            ? `验证码发送过于频繁，请 ${rateLimited.retryAfterSeconds} 秒后再试`
            : "该账号获取验证码次数过多，请 1 小时后再试",
          retryAfterSeconds: rateLimited.retryAfterSeconds,
        });
      }
      const code = generateEmailCode();
      await prisma.$transaction([
        prisma.emailVerificationCode.deleteMany({ where: { email: `identity:${user.id}`, purpose: RESET_PASSWORD_PURPOSE, consumedAt: null } }),
        prisma.emailVerificationCode.create({
          data: {
            email: `identity:${user.id}`,
            userId: user.id,
            codeHash: hashEmailCode(`identity:${user.id}`, code),
            purpose: RESET_PASSWORD_PURPOSE,
            expiresAt: new Date(Date.now() + 10 * 60 * 1_000),
          },
        }),
      ]);
      // 回显验证码等于「报出 QQ 号即可重置」，因此只在显式打开调试开关时回显；
      // 否则改由用户用绑定的第三方身份扫码登录后自行改密。
      return {
        ok: true,
        channel: "identity" as const,
        providers: identities.map((identity) => identity.provider.replace(/^aggregate:/, "")),
        hint: "该账号未绑定邮箱。若已绑定第三方登录，可在登录页用对应身份扫码登录后到「服务 → 修改密码」重置；否则请联系校园墙管理员重置密码。",
        ...(config.resend.exposeCode ? { devCode: code } : {}),
        expiresInSeconds: RESET_CODE_TTL_SECONDS,
      };
    }

    const rateLimited = await checkResetCodeRateLimit(user.email);
    if (rateLimited) {
      return reply.code(429).send({
        code: "RATE_LIMITED",
        message: rateLimited.reason === "cooldown"
          ? `验证码发送过于频繁，请 ${rateLimited.retryAfterSeconds} 秒后再试`
          : "该账号获取验证码次数过多，请 1 小时后再试",
        retryAfterSeconds: rateLimited.retryAfterSeconds,
      });
    }

    const code = generateEmailCode();
    await prisma.emailVerificationCode.create({
      data: {
        email: user.email,
        userId: user.id,
        codeHash: hashEmailCode(user.email, code),
        purpose: RESET_PASSWORD_PURPOSE,
        expiresAt: new Date(Date.now() + 10 * 60 * 1_000),
      },
    });
    const sent = await sendVerificationEmail(config, { to: user.email, code });

    return {
      ok: true,
      channel: "email" as const,
      email: maskEmail(user.email),
      expiresInSeconds: RESET_CODE_TTL_SECONDS,
      // 只有显式打开调试开关且本次确实跳过投递时才回显；生产回显等于把重置码直接交给请求方。
      ...(config.resend.exposeCode && sent.skipped ? { devCode: code } : {}),
    };
  });

  // 忘记密码第二步：校验邮箱验证码并写入新密码。
  app.post("/api/auth/password/reset", async (request, reply) => {
    const body = resetPasswordSchema.parse(request.body);
    const key = parseAccountKey(body.account);
    if (!key) {
      return reply.code(400).send({ message: "请输入 QQ 号或邮箱" });
    }
    const user = await prisma.user.findUnique({
      where: key,
      select: { id: true, email: true },
    });
    if (!user) {
      return reply.code(400).send({ message: "该账号不存在，请确认 QQ 号或邮箱" });
    }
    const resetEmailKey = user.email ?? `identity:${user.id}`;

    const latestRecord = await prisma.emailVerificationCode.findFirst({
      where: {
        email: resetEmailKey,
        purpose: RESET_PASSWORD_PURPOSE,
        consumedAt: null,
      },
      orderBy: { createdAt: "desc" },
    });
    if (!latestRecord) {
      return reply.code(400).send({ code: "CODE_MISSING", message: "还没有获取过验证码，请先点击获取验证码" });
    }
    if (latestRecord.expiresAt.getTime() <= Date.now()) {
      return reply.code(400).send({
        code: "CODE_EXPIRED",
        message: `验证码已过期（有效期 ${RESET_CODE_TTL_SECONDS / 60} 分钟），请重新获取`,
      });
    }
    if (latestRecord.attempts >= 5) {
      return reply.code(429).send({ code: "CODE_ATTEMPTS", message: "验证码尝试次数过多，请重新获取" });
    }
    if (latestRecord.codeHash !== hashEmailCode(resetEmailKey, body.code)) {
      // 原子消费一次尝试机会：并发猜测无法再基于同一个旧计数全部通过。
      const consumed = await prisma.emailVerificationCode.updateMany({
        where: { id: latestRecord.id, attempts: { lt: 5 } },
        data: { attempts: { increment: 1 } },
      });
      if (consumed.count === 0) {
        return reply.code(429).send({ code: "CODE_ATTEMPTS", message: "验证码尝试次数过多，请重新获取" });
      }
      const fresh = await prisma.emailVerificationCode.findUnique({ where: { id: latestRecord.id }, select: { attempts: true } });
      const remaining = Math.max(0, 5 - (fresh?.attempts ?? 5));
      return reply.code(400).send({
        code: "CODE_INVALID",
        message: remaining > 0 ? `验证码不正确，还可以尝试 ${remaining} 次` : "验证码不正确，请重新获取",
      });
    }
    const record = latestRecord;

    await prisma.$transaction([
      prisma.emailVerificationCode.update({
        where: { id: record.id },
        data: { consumedAt: new Date(), attempts: { increment: 1 } },
      }),
      prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await hashPassword(body.newPassword), passwordChangeRequired: false },
      }),
      // 递增密码版本号：旧会话（含改密前登录、改密后才建会话的竞态会话）立即失效。
      prisma.user.update({ where: { id: user.id }, data: { tokenVersion: { increment: 1 } } }),
      // 重置密码后让旧会话失效，避免残留登录态继续使用。
      prisma.accountSession.deleteMany({ where: { userId: user.id } }),
    ]);

    return { ok: true };
  });

  // ── 绑定邮箱 ──────────────────────────────────────────
  // 切换到无 Bot 模式后，普通用户只能靠邮箱接收通知、自助找回密码，
  // 因此补一个登录后可自助绑定的入口（原先 email 只能在注册时写入一次）。

  app.post("/api/auth/email/bind/request-code", async (request, reply) => {
    const context = await getSessionContext(request);
    if (!context) {
      return reply.code(401).send({ message: "请先登录" });
    }
    const parsed = bindEmailRequestCodeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: firstIssueMessage(parsed, "请求参数不正确") });
    }
    const email = normalizeEmail(parsed.data.email);
    if (context.user.email === email) {
      return reply.code(409).send({ message: "该邮箱已是当前账号的绑定邮箱" });
    }
    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) {
      return reply.code(409).send({ code: "EMAIL_TAKEN", message: "该邮箱已被其他账号绑定，请换一个邮箱" });
    }

    // 限流检查与验证码落库放在同一个 Serializable 事务里：并发请求不会再基于
    // 同一个旧计数全部通过，也不会在没有任何记录前并发把信发出去。
    let issued: { kind: "issued"; code: string } | { kind: "limited"; retryAfterSeconds: number; reason: string };
    try {
      issued = await retryTransactionSerializationFailures(
        () =>
          prisma.$transaction(
            async (tx) => {
              const recipientLimited = await checkCodeRateLimit(tx, email, BIND_EMAIL_PURPOSE);
              if (recipientLimited) {
                return { kind: "limited" as const, ...recipientLimited };
              }
              const accountLimited = await checkAccountSendLimit(tx, context.user.id, BIND_EMAIL_PURPOSE);
              if (accountLimited) {
                return { kind: "limited" as const, ...accountLimited };
              }
              const code = generateEmailCode();
              await tx.emailVerificationCode.create({
                data: {
                  email,
                  userId: context.user.id,
                  codeHash: hashEmailCode(email, code),
                  purpose: BIND_EMAIL_PURPOSE,
                  expiresAt: new Date(Date.now() + BIND_CODE_TTL_SECONDS * 1_000),
                },
              });
              return { kind: "issued" as const, code };
            },
            { isolationLevel: TransactionIsolationLevel.Serializable },
          ),
        isTransactionSerializationFailure,
      );
    } catch {
      return reply.code(500).send({ message: "发送验证码失败，请稍后重试" });
    }

    if (issued.kind === "limited") {
      return reply.code(429).send({
        code: "RATE_LIMITED",
        message: issued.reason === "cooldown"
          ? `验证码发送过于频繁，请 ${issued.retryAfterSeconds} 秒后再试`
          : "获取验证码次数过多，请 1 小时后再试",
        retryAfterSeconds: issued.retryAfterSeconds,
      });
    }

    const code = issued.code;
    let sent: { skipped: boolean };
    try {
      sent = await withTimeout(
        sendEmail(config, {
          to: email,
          subject: "Campux 绑定邮箱验证码",
          html: `<p>你正在把该邮箱绑定为 Campux 账号邮箱，验证码是：</p><p style="font-size:24px;font-weight:700;letter-spacing:4px">${code}</p><p>验证码 ${BIND_CODE_TTL_SECONDS / 60} 分钟内有效。如果不是你本人操作，可以忽略这封邮件。</p>`,
          text: `你正在把该邮箱绑定为 Campux 账号邮箱，验证码是：${code}\n验证码 ${BIND_CODE_TTL_SECONDS / 60} 分钟内有效。如果不是你本人操作，可以忽略这封邮件。`,
        }),
        BIND_EMAIL_SEND_TIMEOUT_MS,
      );
    } catch {
      // 投递失败时删掉刚落库的验证码：否则它会触发冷却，用户既没收到码也无法立刻重试。
      await prisma.emailVerificationCode.deleteMany({
        where: { email, userId: context.user.id, purpose: BIND_EMAIL_PURPOSE, consumedAt: null },
      });
      return reply.code(502).send({ message: "验证码邮件发送失败，请稍后重试" });
    }

    return {
      ok: true,
      email: maskEmail(email),
      expiresInSeconds: BIND_CODE_TTL_SECONDS,
      // 只有在显式打开 CAMPUX_EMAIL_EXPOSE_CODE 且本次确实跳过了投递时才回显验证码。
      // 生产环境绝不回显：回显等于把绑定码直接交给请求方，无需证明能访问该邮箱。
      ...(config.resend.exposeCode && sent.skipped ? { devCode: code } : {}),
    };
  });

  app.post("/api/auth/email/bind", async (request, reply) => {
    const context = await getSessionContext(request);
    if (!context) {
      return reply.code(401).send({ message: "请先登录" });
    }
    const parsed = bindEmailConfirmSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: firstIssueMessage(parsed, "请求参数不正确") });
    }
    const email = normalizeEmail(parsed.data.email);

    const latestRecord = await prisma.emailVerificationCode.findFirst({
      where: { email, purpose: BIND_EMAIL_PURPOSE, consumedAt: null },
      orderBy: { createdAt: "desc" },
    });
    if (!latestRecord) {
      return reply.code(400).send({ code: "CODE_MISSING", message: "还没有获取过验证码，请先点击获取验证码" });
    }
    if (latestRecord.expiresAt.getTime() <= Date.now()) {
      return reply.code(400).send({ code: "CODE_EXPIRED", message: `验证码已过期（有效期 ${BIND_CODE_TTL_SECONDS / 60} 分钟），请重新获取` });
    }
    if (latestRecord.attempts >= 5) {
      return reply.code(429).send({ code: "CODE_ATTEMPTS", message: "验证码尝试次数过多，请重新获取" });
    }
    if (latestRecord.codeHash !== hashEmailCode(email, parsed.data.code)) {
      // 原子消费一次尝试机会：并发猜测无法再基于同一个旧计数全部通过。
      const consumed = await prisma.emailVerificationCode.updateMany({
        where: { id: latestRecord.id, attempts: { lt: 5 } },
        data: { attempts: { increment: 1 } },
      });
      if (consumed.count === 0) {
        return reply.code(429).send({ code: "CODE_ATTEMPTS", message: "验证码尝试次数过多，请重新获取" });
      }
      const fresh = await prisma.emailVerificationCode.findUnique({ where: { id: latestRecord.id }, select: { attempts: true } });
      const remaining = Math.max(0, 5 - (fresh?.attempts ?? 5));
      return reply.code(400).send({ code: "CODE_INVALID", message: remaining > 0 ? `验证码不正确，还可以尝试 ${remaining} 次` : "验证码不正确，请重新获取" });
    }

    // 绑定前再查一次唯一性。
    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing && existing.id !== context.user.id) {
      return reply.code(409).send({ code: "EMAIL_TAKEN", message: "该邮箱已被其他账号绑定，请换一个邮箱" });
    }

    const previousEmail = context.user.email;
    try {
      // 邮箱写入、验证码消费、重置码清理放在同一事务：并发绑定时 P2002 也能转 409，
      // 且不会出现「邮箱已改但码没消费」的中间态。
      const changed = await prisma.$transaction(async (tx) => {
        // 条件更新：只在邮箱仍等于读取时的值时才写入，避免并发绑定/解绑互相覆盖。
        const emailUpdate = await tx.user.updateMany({
          where: { id: context.user.id, email: previousEmail },
          data: { email },
        });
        if (emailUpdate.count === 0) {
          return false;
        }
        await tx.emailVerificationCode.update({ where: { id: latestRecord.id }, data: { consumedAt: new Date(), attempts: { increment: 1 } } });
        // 撤销该地址上遗留的密码重置码：邮箱改绑后，旧主人的码不能用来重置新主人。
        await tx.emailVerificationCode.deleteMany({ where: { email, purpose: RESET_PASSWORD_PURPOSE, consumedAt: null } });
        if (previousEmail) {
          await tx.emailVerificationCode.deleteMany({ where: { email: previousEmail, purpose: RESET_PASSWORD_PURPOSE, consumedAt: null } });
        }
        return true;
      });
      if (!changed) {
        return reply.code(409).send({ code: "EMAIL_CHANGED", message: "邮箱状态已变化，请重新获取验证码" });
      }
    } catch (error) {
      // 只有邮箱唯一性冲突才转 409，其他错误照常抛出。
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return reply.code(409).send({ code: "EMAIL_TAKEN", message: "该邮箱已被其他账号绑定，请换一个邮箱" });
      }
      throw error;
    }

    return { ok: true, email };
  });

  app.post("/api/auth/email/unbind", async (request, reply) => {
    const context = await getSessionContext(request);
    if (!context) {
      return reply.code(401).send({ message: "请先登录" });
    }
    const parsed = unbindEmailSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: firstIssueMessage(parsed, "请求参数不正确") });
    }
    const user = await prisma.user.findUniqueOrThrow({ where: { id: context.user.id } });
    if (!(await verifyPassword(parsed.data.password, user.passwordHash))) {
      return reply.code(401).send({ message: "当前密码不正确" });
    }
    if (!user.email) {
      return reply.code(409).send({ message: "当前账号尚未绑定邮箱" });
    }

    const releasedEmail = user.email;
    // 条件更新 + 同事务清理：只在邮箱仍等于读取时的值时才解绑，避免与并发绑定互相覆盖；
    // 同时撤销该地址上遗留的密码重置码，否则旧主人留下的码可能被后来绑定该地址的人用来重置。
    const released = await prisma.$transaction(async (tx) => {
      const updated = await tx.user.updateMany({ where: { id: user.id, email: releasedEmail }, data: { email: null } });
      if (updated.count === 0) {
        return false;
      }
      await tx.emailVerificationCode.deleteMany({ where: { email: releasedEmail, purpose: RESET_PASSWORD_PURPOSE, consumedAt: null } });
      return true;
    });
    if (!released) {
      return reply.code(409).send({ code: "EMAIL_CHANGED", message: "邮箱状态已变化，请刷新后重试" });
    }
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
