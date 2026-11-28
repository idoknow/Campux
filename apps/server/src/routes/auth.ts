import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { CampuxConfig } from "@campux/config";
import { hashPassword, Prisma, verifyPassword } from "@campux/db";
import { randomInt } from "node:crypto";
import { z } from "zod";
import { clearSessionCookie, createSession, findActiveBan, getCookie, getSessionContext, hashToken, requireSession, sessionCookieName, setSessionCookie } from "../lib/auth";
import { generateEmailCode, hashEmailCode, normalizeEmail, sendEmail, sendVerificationEmail } from "../lib/email";
import { readTenantOperateMode, resolvePasswordResetChannel } from "../lib/tenant-metadata";
import { readTenantPluginConfig } from "../lib/tenant-plugin-config";
import {
  checkQqEmailMatchesQqUin,
  isEmailAllowedByPolicy,
  readRegistrationEmailPolicy,
} from "../lib/registration-email-policy";
import { officialMailerAvailable, readTenantMailSenderConfig, sendTenantMail } from "../lib/tenant-mail-sender";
import { buildMergePreview, findMergeCandidate, isMergeScopeSingleTenant, maskEmailForPreview, mergeUserAccounts, resolveActiveAccount, shouldPromptAccountMerge, UserMergeError } from "../lib/user-merge";
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

// 游客投稿：QQ 号 + 用户名 + 密码注册。开启邮箱验证时还需邮箱 + 验证码。
const tenantRegisterSchema = z.object({
  qqUin: z.string().trim().regex(/^[1-9]\d{4,11}$/, "请输入正确的 QQ 号"),
  displayName: z.string().trim().min(1, "用户名不能为空").max(80, "用户名最多 80 个字符"),
  password: z.string().min(6).max(128),
  email: z.string().trim().max(255).optional(),
  code: z.string().trim().max(10).optional(),
});

// 游客注册时请求邮箱验证码。
const tenantRegisterCodeSchema = z.object({
  email: z.string().trim().min(1, "请输入邮箱").max(255),
  qqUin: z.string().trim().regex(/^[1-9]\d{4,11}$/, "请输入正确的 QQ 号").optional(),
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

/**
 * 决定「重置密码走哪条渠道」时应该看哪个校园墙的运营模式。
 *
 * 规则（Web 与 Bot 共用）：
 * 1. 优先用请求所在入口对应的墙（`requestedTenantId`）——用户在哪个墙的页面操作，
 *    就按那个墙的规则来。这消除了「A 墙是 bot、B 墙是 manual，用户从 B 墙页面
 *    却被要求去私聊 A 墙墙号」的错位。
 * 2. 否则退回该账号最早的成员身份（会话里没有墙上下文时）。
 *
 * Bot 侧本来就知道 `bot.tenantId`，直接传进来即可，两者口径一致。
 */
async function resolveResetChannelTenantId(
  userId: string,
  requestedTenantId?: string | null,
): Promise<string | null> {
  if (requestedTenantId) {
    const membership = await prisma.tenantMembership.findFirst({
      where: { userId, tenantId: requestedTenantId },
      select: { tenantId: true },
    });
    if (membership) {
      return membership.tenantId;
    }
  }
  const membership = await prisma.tenantMembership.findFirst({
    where: { userId },
    select: { tenantId: true },
    orderBy: { createdAt: "asc" },
  });
  return membership?.tenantId ?? null;
}

const RESET_PASSWORD_PURPOSE = "password_reset";
const TENANT_REGISTER_PURPOSE = "tenant_register";

/**
 * 游客注册验证码的 purpose：带上签发墙 ID。
 *
 * 不做这层绑定的话，A 墙签发的码可以在 B 墙使用——只要 B 墙的邮箱策略更宽松，
 * 用户就能绕过 A 墙的后缀限制。代价是同一个邮箱在不同墙的验证码互不通用，
 * 这正是我们要的语义。
 */
function tenantRegisterPurpose(tenantId: string): string {
  return `${TENANT_REGISTER_PURPOSE}:${tenantId}`;
}
const ACCOUNT_MERGE_PURPOSE = "account_merge";

/**
 * 发送「注册 / 绑定 / 重置」类验证码，并明确区分三种结果：
 *
 * - `sent`：真的投递出去了（租户 SMTP 或平台官方发件）；
 * - `unconfigured`：本实例**根本没有**任何可用邮件服务（典型是自托管既没配 Resend 也没配 SMTP）。
 *   这是「部署形态导致发不出信」，调用方可以回显验证码，否则自托管用户永远无法注册/重置。
 * - `failed`：有邮件服务但发送失败（SMTP 认证/连接错误等）。**绝不能**回显验证码。
 *
 * 区分 `unconfigured` 与 `failed` 很关键：把「配置坏了」当成「没配邮件」处理，
 * 等于让未认证的调用者拿到可用的重置码。
 */
type MailOutcome =
  | { status: "sent" }
  | { status: "unconfigured" }
  | { status: "failed"; error: string };

async function sendSignupMail(
  config: CampuxConfig,
  tenantId: string | null,
  message: { to: string; subject: string; html: string; text: string },
): Promise<MailOutcome> {
  const officialAvailable = officialMailerAvailable(config);
  // 有租户上下文时优先用该墙的发件配置（运营者可能自备 SMTP）。
  if (tenantId) {
    const sender = await readTenantMailSenderConfig(prisma, tenantId);
    if (sender.mode === "smtp" || officialAvailable) {
      const result = await sendTenantMail({ sender, config, ...message });
      if (result.ok) return { status: "sent" };
      // 有配置但发失败：官方还可用就回退一次，否则如实报失败（不回显验证码）。
      if (!officialAvailable) {
        return { status: "failed", error: result.error };
      }
    }
  }

  if (!officialAvailable) {
    return { status: "unconfigured" };
  }
  try {
    const result = await sendEmail(config, message);
    return result.skipped ? { status: "unconfigured" } : { status: "sent" };
  } catch (error) {
    return { status: "failed", error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * 只经平台官方发件的发送入口。
 *
 * 用于**账号级**凭证（密码重置、账号合并）：同一账号可能属于多个墙，
 * 让某个墙的 SMTP 经手它的验证码，等于让该墙管理员获得重置/接管全局账号的能力。
 */
async function sendOfficialMail(
  config: CampuxConfig,
  message: { to: string; subject: string; html: string; text: string },
): Promise<MailOutcome> {
  if (!officialMailerAvailable(config)) {
    return { status: "unconfigured" };
  }
  try {
    const result = await sendEmail(config, message);
    return result.skipped ? { status: "unconfigured" } : { status: "sent" };
  } catch (error) {
    return { status: "failed", error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * 密码重置发信。
 *
 * 这是**账号级**操作（同一账号可能属于多个墙），因此不允许租户自控的 SMTP 经手。
 */
async function sendRegistrationMail(
  config: CampuxConfig,
  to: string,
  subject: string,
  code: string,
  actionLabel: string,
): Promise<MailOutcome> {
  const html = `<p>你的 Campux ${actionLabel}验证码是：</p><p style="font-size:24px;font-weight:700;letter-spacing:4px">${code}</p><p>验证码 10 分钟内有效。如果不是你本人操作，可以忽略这封邮件。</p>`;
  const text = `你的 Campux ${actionLabel}验证码是：${code}\n验证码 10 分钟内有效。如果不是你本人操作，可以忽略这封邮件。`;
  return sendOfficialMail(config, { to, subject, html, text });
}



// 账号合并：把「之前的账号」并进当前账号。
const accountMergePreviewSchema = z.object({
  oldQqUin: z.string().trim().regex(/^[1-9]\d{4,11}$/, "请输入正确的 QQ 号"),
});

const accountMergeCodeSchema = z.object({
  oldQqUin: z.string().trim().regex(/^[1-9]\d{4,11}$/, "请输入正确的 QQ 号"),
  email: z.string().trim().max(255).optional(),
});

const accountMergeConfirmSchema = z.object({
  oldQqUin: z.string().trim().regex(/^[1-9]\d{4,11}$/, "请输入正确的 QQ 号"),
  email: z.string().trim().max(255).optional(),
  code: z.string().trim().regex(/^\d{6}$/, "验证码格式不正确"),
});
// 验证码频率限制：60 秒内只能发一次；同一账号 1 小时最多 5 次。
const RESET_CODE_COOLDOWN_SECONDS = 60;
const RESET_CODE_HOURLY_LIMIT = 5;
const RESET_CODE_TTL_SECONDS = 10 * 60;

/** 频率限制检查：返回需要拒绝时的提示与重试秒数。按 purpose 分别计数，避免不同用途互相消耗配额。 */
async function checkResetCodeRateLimit(emailKey: string, purpose: string = RESET_PASSWORD_PURPOSE) {
  const now = Date.now();
  const sinceHour = new Date(now - 60 * 60 * 1_000);
  const recent = await prisma.emailVerificationCode.findMany({
    where: {
      email: emailKey,
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
  async function resolvePublicTenantByRequest(request: FastifyRequest): Promise<{ id: string; name: string } | null> {
    const hostTenant = await findTenantByRequestHost(request);
    if (hostTenant) {
      return { id: hostTenant.id, name: hostTenant.name };
    }
    const singleModeTenantId = await resolveSingleModeTenantId();
    if (!singleModeTenantId) {
      return null;
    }
    const tenant = await prisma.tenant.findUnique({
      where: { id: singleModeTenantId },
      select: { id: true, name: true },
    });
    return tenant ? { id: tenant.id, name: tenant.name } : null;
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

  /** 登录查询的 include：登录与「旧号→主账号」两条路径共用，保证类型一致。 */
  const loginUserInclude = {
    memberships: {
      include: {
        tenant: {
          include: {
            metadata: { where: { key: "logo_url" } },
            aiSettings: { select: { enabled: true } },
            _count: {
              select: {
                botAccounts: true,
                posts: { where: { status: "pending_approval" } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    },
  } as const;

  type LoginUser = Prisma.UserGetPayload<{ include: typeof loginUserInclude }>;

  /**
   * 登录成功后的共用收尾：按 host / 单墙 / 多墙决定会话与响应。
   *
   * `mergedFrom` 非空表示「用户是用已合并旧号的凭据登录的」，已被解析到主账号，
   * 响应里带上 `mergedAccount` 让前端提示「已用旧账号登录到合并后的账号」。
   */
  async function completeLogin(
    reply: FastifyReply,
    request: FastifyRequest,
    user: LoginUser,
    mergedFrom: { mergedFromQqUin: string } | null,
  ) {
    // 测试账号策略必须对「用旧号凭据登录、解析到主账号」的路径同样生效，
    // 否则拿一个测试账号被合并过去的主账号就能在生产环境登录。
    if (user.isTestAccount && config.nodeEnv !== "development") {
      return reply.code(403).send({
        message: "测试账号只能在开发环境登录",
      });
    }

    const mergedNotice = mergedFrom
      ? { mergedFromQqUin: mergedFrom.mergedFromQqUin, message: "该账号已合并，已为你登录到合并后的账号" }
      : null;

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
        ...(mergedNotice ? { mergedAccount: mergedNotice } : {}),
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
        // 靠私聊 Bot 建号、且还没绑过邮箱的同学：提示他把之前的网页账号绑过来。
        shouldPromptAccountMerge: shouldPromptAccountMerge(user),
        ...(mergedNotice ? { mergedAccount: mergedNotice } : {}),
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
      // 靠私聊 Bot 建号、且还没绑过邮箱的同学：提示他把之前的网页账号绑过来。
      shouldPromptAccountMerge: shouldPromptAccountMerge(user),
      ...(mergedNotice ? { mergedAccount: mergedNotice } : {}),
    };
  }

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
      include: loginUserInclude,
    });

    if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
      return reply.code(401).send({
        message: "账号或密码错误",
      });
    }

    // 账号合并后，旧号仍占用原 QQ 号/邮箱（用于审计与反查），所以用旧凭据会先查到旧号。
    // 这里解析到真正的主账号，让「用旧邮箱 + 旧密码登录」也能进到合并后的账号。
    if (user.mergedAt !== null) {
      const resolved = await resolveActiveAccount(prisma, user);
      const activeUser = await prisma.user.findUnique({
        where: { id: resolved.userId },
        include: loginUserInclude,
      });
      if (!activeUser) {
        return reply.code(401).send({ message: "账号或密码错误" });
      }
      return completeLogin(reply, request, activeUser, {
        mergedFromQqUin: user.qqUin.toString(),
      });
    }

    if (user.isTestAccount && config.nodeEnv !== "development") {
      return reply.code(403).send({
        message: "测试账号只能在开发环境登录",
      });
    }

    return completeLogin(reply, request, user, null);
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
    const codeRecord = await prisma.emailVerificationCode.create({
      data: {
        email,
        codeHash: hashEmailCode(email, code),
        purpose: "operations_admin_register",
        expiresAt: new Date(Date.now() + 10 * 60 * 1_000),
      },
      select: { id: true },
    });
    // 运营管理员开墙注册属于平台入口，没有租户上下文，统一用官方发件。
    try {
      const sent = await sendVerificationEmail(config, { to: email, code });
      return {
        ok: true,
        ...(sent.skipped ? { devCode: code } : {}),
      };
    } catch (error) {
      // 发送失败：只作废本次生成的这条码，不误伤此前已送达的验证码。
      await prisma.emailVerificationCode.deleteMany({ where: { id: codeRecord.id } });
      return reply.code(502).send({
        message: `验证码发送失败：${error instanceof Error ? error.message : String(error)}`,
      });
    }
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

  // 游客投稿：登录页在未登录时查询本墙是否开放 QQ 号自助注册，以及是否需要邮箱验证。
  app.get("/api/auth/tenant-registration", async (request) => {
    const hostTenant = await resolvePublicTenantByRequest(request);
    if (!hostTenant) {
      return { enabled: false, operateMode: "bot" as const, emailRequired: false, allowedEmailSuffixes: [] };
    }
    const [pluginConfig, operateMode, emailPolicy] = await Promise.all([
      readTenantPluginConfig(prisma, hostTenant.id),
      readTenantOperateMode(prisma, hostTenant.id),
      readRegistrationEmailPolicy(prisma, hostTenant.id),
    ]);
    return {
      enabled: pluginConfig.guestSubmission.enabled,
      operateMode,
      emailRequired: emailPolicy.required,
      // 空数组表示不限制后缀，前端据此提示「任意邮箱均可」。
      allowedEmailSuffixes: emailPolicy.required ? emailPolicy.allowedSuffixes : [],
    };
  });

  // 游客注册：发送邮箱验证码（仅在该墙开启邮箱验证时可用）。
  app.post("/api/auth/tenant-register/request-code", async (request, reply) => {
    const hostTenant = await resolvePublicTenantByRequest(request);
    if (!hostTenant) {
      return reply.code(404).send({ message: "当前入口不开放注册" });
    }
    const pluginConfig = await readTenantPluginConfig(prisma, hostTenant.id);
    if (!pluginConfig.guestSubmission.enabled) {
      return reply.code(403).send({ message: "当前校园墙未开放注册，请联系管理员" });
    }
    const policy = await readRegistrationEmailPolicy(prisma, hostTenant.id);
    if (!policy.required) {
      return reply.code(400).send({ message: "当前校园墙注册不需要邮箱验证" });
    }

    const body = tenantRegisterCodeSchema.parse(request.body);
    const email = normalizeEmail(body.email);
    const allowed = isEmailAllowedByPolicy(email, policy);
    if (!allowed.ok) {
      return reply.code(400).send({ message: allowed.reason ?? "邮箱不符合本墙要求" });
    }
    if (body.qqUin) {
      const consistent = checkQqEmailMatchesQqUin(email, body.qqUin);
      if (!consistent.ok) {
        return reply.code(400).send({ message: consistent.reason });
      }
    }

    // 按签到本墙的 purpose 计数：否则注册发码与密码重置共用同一配额，
    // 一方被限流会连累另一方。
    const rateLimit = await checkResetCodeRateLimit(email, tenantRegisterPurpose(hostTenant.id));
    if (rateLimit) {
      return reply.code(429).send({
        message: `发送过于频繁，请 ${rateLimit.retryAfterSeconds} 秒后再试`,
      });
    }

    const taken = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (taken) {
      return reply.code(409).send({ message: "这个邮箱已经注册，请直接登录" });
    }

    const code = generateEmailCode();
    const codeRecord = await prisma.emailVerificationCode.create({
      data: {
        email,
        codeHash: hashEmailCode(email, code),
        // 把签发墙编进 purpose：否则 A 墙发的码能在 B 墙用（B 墙若邮箱策略更宽松，
        // 等于绕过了 A 墙的后缀限制）。
        purpose: tenantRegisterPurpose(hostTenant.id),
        expiresAt: new Date(Date.now() + RESET_CODE_TTL_SECONDS * 1000),
      },
      select: { id: true },
    });

    const sent = await sendSignupMail(config, hostTenant.id, {
      to: email,
      subject: `Campux 注册验证码 - ${hostTenant.name}`,
      html: `<p>你的「${hostTenant.name}」注册验证码是：</p><p style="font-size:24px;font-weight:700;letter-spacing:4px">${code}</p><p>验证码 10 分钟内有效。如果不是你本人操作，可以忽略这封邮件。</p>`,
      text: `你的「${hostTenant.name}」注册验证码是：${code}\n验证码 10 分钟内有效。如果不是你本人操作，可以忽略这封邮件。`,
    });
    if (sent.status === "failed") {
      // 有邮件服务但发不出去：只作废本次生成的这条码，不误伤其它未消费的码。
      await prisma.emailVerificationCode.deleteMany({ where: { id: codeRecord.id } });
      return reply.code(502).send({ message: `验证码发送失败：${sent.error}` });
    }

    return {
      ok: true,
      email,
      expiresInSeconds: RESET_CODE_TTL_SECONDS,
      // 仅当本实例完全没有邮件服务时回显，方便自托管部署注册。
      ...(sent.status === "unconfigured" ? { devCode: code } : {}),
    };
  });

  // 游客投稿：QQ 号 + 用户名 + 密码注册，注册后直接成为该墙的投稿用户并登录。
  // 开启邮箱验证时还需要邮箱 + 验证码，并校验后缀与 QQ 号一致性。
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

    const policy = await readRegistrationEmailPolicy(prisma, hostTenant.id);
    let email: string | null = null;
    let verificationRecordId: string | null = null;
    if (policy.required) {
      const rawEmail = normalizeEmail(body.email ?? "");
      if (!rawEmail) {
        return reply.code(400).send({ message: "本墙要求邮箱验证，请填写邮箱" });
      }
      const allowed = isEmailAllowedByPolicy(rawEmail, policy);
      if (!allowed.ok) {
        return reply.code(400).send({ message: allowed.reason ?? "邮箱不符合本墙要求" });
      }
      const consistent = checkQqEmailMatchesQqUin(rawEmail, body.qqUin);
      if (!consistent.ok) {
        return reply.code(400).send({ message: consistent.reason });
      }
      const code = (body.code ?? "").trim();
      if (!/^\d{6}$/.test(code)) {
        return reply.code(400).send({ message: "请输入 6 位邮箱验证码" });
      }
      const record = await prisma.emailVerificationCode.findFirst({
        where: {
          email: rawEmail,
          // 只认本墙签发的码。
          purpose: tenantRegisterPurpose(hostTenant.id),
          consumedAt: null,
          expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: "desc" },
      });
      if (!record) {
        return reply.code(400).send({ message: "验证码不存在或已过期，请重新获取" });
      }
      if (record.attempts >= 5) {
        return reply.code(429).send({ message: "验证码尝试次数过多，请重新获取" });
      }
      if (record.codeHash !== hashEmailCode(rawEmail, code)) {
        await prisma.emailVerificationCode.update({
          where: { id: record.id },
          data: { attempts: { increment: 1 } },
        });
        return reply.code(400).send({ message: "验证码不正确" });
      }
      email = rawEmail;
      verificationRecordId = record.id;
    }

    const passwordHash = await hashPassword(body.password);
    // 建号与验证码消费必须同一个事务：否则并发请求能用同一个验证码建出多个账号。
    const created = await prisma.$transaction(async (transaction) => {
      if (verificationRecordId) {
        // 以「未消费 + 未过期 + 尝试次数未超限」为条件更新：
        // 并发下只有一个请求能成功；在校验与写入之间过期的码也不会被接受。
        const consumed = await transaction.emailVerificationCode.updateMany({
          where: {
            id: verificationRecordId,
            consumedAt: null,
            expiresAt: { gt: new Date() },
            attempts: { lt: 5 },
          },
          data: { consumedAt: new Date() },
        });
        if (consumed.count !== 1) {
          return null;
        }
      }
      if (email) {
        const emailTaken = await transaction.user.findUnique({ where: { email }, select: { id: true } });
        if (emailTaken) {
          // 抛出让事务回滚，验证码消费一并撤销。
          throw new Error("EMAIL_TAKEN");
        }
      }
      const createdUser = await transaction.user.create({
        data: {
          qqUin,
          email,
          displayName: body.displayName,
          passwordHash,
          passwordChangeRequired: false,
          isTestAccount: false,
          systemRole: null,
        },
      });
      const createdMembership = await transaction.tenantMembership.create({
        data: { tenantId: hostTenant.id, userId: createdUser.id, role: "submitter" },
      });
      return { user: createdUser, membership: createdMembership };
    }).catch((error: unknown) => {
      if (error instanceof Error && error.message === "EMAIL_TAKEN") return "EMAIL_TAKEN" as const;
      throw error;
    });

    if (created === "EMAIL_TAKEN") {
      return reply.code(409).send({ message: "这个邮箱已经注册，请直接登录" });
    }
    if (!created) {
      return reply.code(400).send({ message: "验证码已失效，请重新获取" });
    }
    const user = created.user;
    const membership = created.membership;

    const token = await createSession(user.id, hostTenant.id);
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

  // 忘记密码第一步：按 QQ 号 / 邮箱找到账号，向账号邮箱发验证码。
  // 只对绑定了邮箱的账号发送，且不向外泄露该账号是否存在（统一返回 ok）。
  app.post("/api/auth/password/forgot", async (request, reply) => {
    const body = forgotPasswordSchema.parse(request.body);
    const key = parseAccountKey(body.account);
    if (!key) {
      return reply.code(400).send({ message: "请输入 QQ 号或邮箱" });
    }
    const found = await prisma.user.findUnique({
      where: key,
      select: { id: true, email: true, mergedAt: true, mergedIntoUserId: true },
    });
    if (!found) {
      return reply.code(400).send({ message: "该账号不存在，请确认 QQ 号或邮箱" });
    }
    // 旧号已合并：密码重置应作用在合并后的主账号上，与登录行为保持一致，
    // 否则用户会把旧号的密码改掉却仍然登不进主账号。
    const resolved = await resolveActiveAccount(prisma, found);
    const user = resolved.redirectedFrom === null
      ? found
      : await prisma.user.findUnique({ where: { id: resolved.userId }, select: { id: true, email: true } });
    if (!user) {
      return reply.code(400).send({ message: "该账号不存在，请确认 QQ 号或邮箱" });
    }

    // 按运营模式决定重置渠道：
    // - 墙号机器人模式：用户应私聊墙号发「#重置密码」（Bot 会私信新密码）；
    // - 无 Bot 模式：没有墙号可私聊，走这里的邮箱验证码。
    // 合并账号已在上面解析到主账号，因此这里判断的是主账号所属墙的模式。
    // 若请求来自某个具体墙的页面，则按该墙的规则判断（与 Bot 侧口径一致）。
    const requestTenant = await resolvePublicTenantByRequest(request).catch(() => null);
    const modeTenantId = await resolveResetChannelTenantId(user.id, requestTenant?.id ?? null);
    if (modeTenantId && resolvePasswordResetChannel(await readTenantOperateMode(prisma, modeTenantId)) === "bot-private-message") {
      return reply.code(409).send({
        code: "USE_BOT_RESET",
        message: "本墙当前通过墙号机器人重置密码：请私聊墙号发送「#重置密码」，机器人会把新密码私信给你。",
      });
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
            codeHash: hashEmailCode(`identity:${user.id}`, code),
            purpose: RESET_PASSWORD_PURPOSE,
            expiresAt: new Date(Date.now() + 10 * 60 * 1_000),
          },
        }),
      ]);
      // 自托管环境没有邮件服务时直接回显验证码；生产下请通过第三方渠道确认身份后再重置。
      return {
        ok: true,
        channel: "identity" as const,
        providers: identities.map((identity) => identity.provider.replace(/^aggregate:/, "")),
        devCode: code,
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
    const codeRecord = await prisma.emailVerificationCode.create({
      data: {
        email: user.email,
        codeHash: hashEmailCode(user.email, code),
        purpose: RESET_PASSWORD_PURPOSE,
        expiresAt: new Date(Date.now() + 10 * 60 * 1_000),
      },
      select: { id: true },
    });
    const sent = await sendRegistrationMail(config, user.email, "Campux 密码重置验证码", code, "重置密码");

    if (sent.status === "failed") {
      // 有邮件服务但发送失败：只作废本次生成的码，不误伤此前已送达的验证码。
      await prisma.emailVerificationCode.deleteMany({ where: { id: codeRecord.id } });
      return reply.code(502).send({
        code: "RESET_MAIL_FAILED",
        message: `验证码发送失败：${sent.error}`,
      });
    }

    return {
      ok: true,
      channel: "email" as const,
      email: maskEmail(user.email),
      expiresInSeconds: RESET_CODE_TTL_SECONDS,
      // 仅当本实例完全没有邮件服务时才回显验证码（自托管无邮件场景）。
      ...(sent.status === "unconfigured" ? { devCode: code } : {}),
    };
  });

  // 忘记密码第二步：校验邮箱验证码并写入新密码。
  app.post("/api/auth/password/reset", async (request, reply) => {
    const body = resetPasswordSchema.parse(request.body);
    const key = parseAccountKey(body.account);
    if (!key) {
      return reply.code(400).send({ message: "请输入 QQ 号或邮箱" });
    }
    const foundReset = await prisma.user.findUnique({
      where: key,
      select: { id: true, email: true, mergedAt: true, mergedIntoUserId: true },
    });
    if (!foundReset) {
      return reply.code(400).send({ message: "该账号不存在，请确认 QQ 号或邮箱" });
    }
    // 与忘记密码第一步保持一致：旧号已合并时，重置作用在合并后的主账号上。
    const resolvedReset = await resolveActiveAccount(prisma, foundReset);
    const user = resolvedReset.redirectedFrom === null
      ? foundReset
      : await prisma.user.findUnique({ where: { id: resolvedReset.userId }, select: { id: true, email: true } });
    if (!user) {
      return reply.code(400).send({ message: "该账号不存在，请确认 QQ 号或邮箱" });
    }

    // 与第一步一致：机器人模式下网页不提供邮箱重置，避免绕过渠道限制。
    // 选墙规则也必须一致（优先请求所在墙），否则第一步放行、第二步拦截（或相反）。
    const resetRequestTenant = await resolvePublicTenantByRequest(request).catch(() => null);
    const resetModeTenantId = await resolveResetChannelTenantId(user.id, resetRequestTenant?.id ?? null);
    if (resetModeTenantId && resolvePasswordResetChannel(await readTenantOperateMode(prisma, resetModeTenantId)) === "bot-private-message") {
      return reply.code(409).send({
        code: "USE_BOT_RESET",
        message: "本墙当前通过墙号机器人重置密码：请私聊墙号发送「#重置密码」。",
      });
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
      await prisma.emailVerificationCode.update({
        where: { id: latestRecord.id },
        data: { attempts: { increment: 1 } },
      });
      const remaining = Math.max(0, 4 - latestRecord.attempts);
      return reply.code(400).send({
        code: "CODE_INVALID",
        message: remaining > 0 ? `验证码不正确，还可以尝试 ${remaining} 次` : "验证码不正确，请重新获取",
      });
    }
    const record = latestRecord;

    // 验签后到写入之间可能已被并发请求消费、或刚好过期：把过期时间与尝试次数
    // 一并放进原子条件，避免“哈希耗时”窗口里继续消费一个已失效的码。
    const newPasswordHash = await hashPassword(body.newPassword);
    const resetApplied = await prisma.$transaction(async (transaction) => {
      const consumed = await transaction.emailVerificationCode.updateMany({
        where: { id: record.id, consumedAt: null, expiresAt: { gt: new Date() }, attempts: { lt: 5 } },
        data: { consumedAt: new Date(), attempts: { increment: 1 } },
      });
      if (consumed.count === 0) {
        return false;
      }
      await transaction.user.update({
        where: { id: user.id },
        data: { passwordHash: newPasswordHash, passwordChangeRequired: false },
      });
      // 重置密码后让旧会话失效，避免残留登录态继续使用。
      await transaction.accountSession.deleteMany({ where: { userId: user.id } });
      return true;
    });
    if (!resetApplied) {
      return reply.code(409).send({ code: "CODE_STALE", message: "验证码已失效，请重新获取" });
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
      // 首次登录引导：刷新页面后仍需恢复这个提示，所以放在 /api/me 里一起下发。
      shouldPromptAccountMerge: shouldPromptAccountMerge(context.user) && context.selectedMembership !== null,
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

  // ── 账号合并（绑定之前的账号）───────────────────────────────
  // 场景：管理员切换运营模式后，原本靠私聊 Bot 建号的同学首次登录，
  // 手里其实还有一个无 Bot 期用网页注册的账号。这里让他把旧账号并进来。

  // 查询当前账号是否需要提示合并、以及是否存在可合并的旧账号。
  app.get("/api/me/account-merge", async (request, reply) => {
    const context = await getSessionContext(request);
    if (!context) {
      return reply.code(401).send({ message: "请先登录" });
    }
    const tenantId = context.selectedTenant?.id ?? null;
    if (!tenantId) {
      return { shouldPrompt: false, candidate: null };
    }
    const shouldPrompt = shouldPromptAccountMerge(context.user) && context.selectedMembership !== null;
    return { shouldPrompt, candidate: null, email: context.user.email ?? null };
  });

  // 校验「之前账号的 QQ 号」并给出预览（不落库）。
  app.post("/api/me/account-merge/preview", async (request, reply) => {
    const context = await getSessionContext(request);
    if (!context) {
      return reply.code(401).send({ message: "请先登录" });
    }
    const tenantId = context.selectedTenant?.id;
    if (!tenantId) {
      return reply.code(400).send({ message: "请先选择校园墙" });
    }
    const body = accountMergePreviewSchema.parse(request.body ?? {});
    const result = await buildMergePreview({
      tenantId,
      targetUserId: context.user.id,
      oldQqUin: body.oldQqUin,
    });
    if (!result.ok) {
      // 跨墙在这里就拒绝，不浪费用户一次验证码。
      const status = result.code === "CROSS_TENANT" ? 409 : 404;
      return reply.code(status).send({ message: result.reason, code: result.code });
    }
    return { preview: result.preview };
  });

  // 发送验证码到「旧账号绑定的邮箱」——只有它能证明操作者控制的就是 oldQqUin 指向的那个账号。
  // 不接受 body.email，也不回退到当前账号邮箱：那只能证明「你控制自己的账号」，
  // 攻击者登录自己的账号后知道某人 QQ 号就能把对方账号吞掉。
  app.post("/api/me/account-merge/request-code", async (request, reply) => {
    const context = await getSessionContext(request);
    if (!context) {
      return reply.code(401).send({ message: "请先登录" });
    }
    const tenantId = context.selectedTenant?.id;
    if (!tenantId) {
      return reply.code(400).send({ message: "请先选择校园墙" });
    }
    const body = accountMergeCodeSchema.parse(request.body ?? {});

    const candidate = await findMergeCandidate(prisma, {
      targetUserId: context.user.id,
      oldQqUin: body.oldQqUin,
    });
    if (!candidate) {
      return reply.code(404).send({ message: "没有找到这个 QQ 号对应的可合并旧账号" });
    }
    // 跨墙的旧号不能自助合并：在发码前就拒绝，避免用户白收一次验证码。
    if (!await isMergeScopeSingleTenant(prisma, { oldQqUin: body.oldQqUin, tenantId })) {
      return reply.code(409).send({
        code: "CROSS_TENANT",
        message: "这个旧账号还属于其他校园墙，无法在这里自助合并，请联系系统运维处理",
      });
    }
    // 凭证地址只能是旧账号的邮箱；没有邮箱就无法证明归属，直接拒绝。
    const email = normalizeEmail(candidate.email ?? "");
    if (!email) {
      return reply.code(400).send({
        code: "MERGE_PROOF_UNAVAILABLE",
        message: "旧账号没有绑定邮箱，无法验证归属，请联系管理员处理",
      });
    }
    if (!/^[^\s@]+@[^\s@]+$/.test(email)) {
      return reply.code(400).send({ message: "邮箱格式不正确" });
    }

    const rateLimit = await checkResetCodeRateLimit(email, ACCOUNT_MERGE_PURPOSE);
    if (rateLimit) {
      return reply.code(429).send({ message: `发送过于频繁，请 ${rateLimit.retryAfterSeconds} 秒后再试` });
    }

    const code = generateEmailCode();
    const codeRecord = await prisma.emailVerificationCode.create({
      data: {
        email,
        codeHash: hashEmailCode(email, code),
        purpose: ACCOUNT_MERGE_PURPOSE,
        expiresAt: new Date(Date.now() + RESET_CODE_TTL_SECONDS * 1000),
      },
      select: { id: true },
    });

    // 合并是账号级操作：验证码只经平台官方发件，不经租户 SMTP
    // （否则该墙管理员可读到验证码，从而接管这个账号）。
    const sent = await sendOfficialMail(config, {
      to: email,
      subject: "Campux 账号绑定验证码",
      html: `<p>你正在把之前的账号绑定到当前 Campux 账号，验证码是：</p><p style="font-size:24px;font-weight:700;letter-spacing:4px">${code}</p><p>验证码 10 分钟内有效。如果不是你本人操作，请忽略这封邮件并尽快修改密码。</p>`,
      text: `你正在把之前的账号绑定到当前 Campux 账号，验证码是：${code}\n验证码 10 分钟内有效。如果不是你本人操作，请忽略这封邮件并尽快修改密码。`,
    });
    if (sent.status !== "sent") {
      // 发送失败或平台没有配发件服务：都作废验证码，且不回显。
      // 账号合并是接管他人的高危操作，不能像自托管注册那样把码交给调用者。
      await prisma.emailVerificationCode.deleteMany({
        where: { id: codeRecord.id },
      });
      return reply.code(502).send({
        code: "MERGE_MAIL_UNAVAILABLE",
        message: sent.status === "unconfigured"
          ? "平台未配置发件服务，无法发送验证码。请联系系统运维处理账号合并。"
          : `验证码发送失败：${sent.error}`,
      });
    }

    return {
      ok: true,
      // 与合并预览一致只回显脱敏地址：验证码发出前后都不能把旧账号完整邮箱交给调用者。
      email: maskEmailForPreview(email) ?? "",
      expiresInSeconds: RESET_CODE_TTL_SECONDS,
    };
  });

  // 确认合并。
  app.post("/api/me/account-merge/confirm", async (request, reply) => {
    const context = await getSessionContext(request);
    if (!context) {
      return reply.code(401).send({ message: "请先登录" });
    }
    const tenantId = context.selectedTenant?.id;
    if (!tenantId) {
      return reply.code(400).send({ message: "请先选择校园墙" });
    }
    const body = accountMergeConfirmSchema.parse(request.body ?? {});

    const candidate = await findMergeCandidate(prisma, {
      targetUserId: context.user.id,
      oldQqUin: body.oldQqUin,
    });
    if (!candidate) {
      return reply.code(404).send({ message: "没有找到这个 QQ 号对应的可合并旧账号" });
    }
    const email = normalizeEmail(candidate.email ?? "");
    if (!email) {
      return reply.code(400).send({
        code: "MERGE_PROOF_UNAVAILABLE",
        message: "旧账号没有绑定邮箱，无法验证归属，请联系管理员处理",
      });
    }

    const record = await prisma.emailVerificationCode.findFirst({
      where: { email, purpose: ACCOUNT_MERGE_PURPOSE, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });
    if (!record) {
      return reply.code(400).send({ message: "验证码不存在或已过期，请重新获取" });
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
    await prisma.emailVerificationCode.update({ where: { id: record.id }, data: { consumedAt: new Date() } });

    try {
      const result = await mergeUserAccounts({
        tenantId,
        targetUserId: context.user.id,
        oldQqUin: body.oldQqUin,
        actorId: context.user.id,
      });
      return { ok: true, ...result };
    } catch (error) {
      if (error instanceof UserMergeError) {
        return reply.code(409).send({ message: error.message, code: error.code });
      }
      throw error;
    }
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
