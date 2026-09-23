/**
 * 聚合登录（第三方登录）路由。
 *
 * 把第三方平台（QQ/微信/支付宝/抖音/微博/百度/华为/小米/Gitee/Gitea/B站/快手）身份
 * 绑定到已有 Campux 账号后，用该身份直接登录。严格「只做第三方登录、不涉及注册」：
 * 未绑定的第三方身份绝不会自动创建账号，而是提示先登录已有账号完成绑定。
 *
 * 凭证（appid/appkey/endpoint）与开关、可用的登录方式都是租户级配置
 * （tenant_metadata.plugin_config.aggregateLogin），由「插件设置」页维护。
 *
 * ── state / CSRF 模型（重要）────────────────────────────────────────────
 * 部分聚合站（如 login.mapay.cn）在 act=login 返回的授权 URL 上自带自己的 state，
 * 并依赖它原样回传到聚合站 return.php 才能把第三方回调转回我们的 redirect_uri，
 * 因此 Campux 绝不能覆盖授权 URL 上的 state。
 *
 * Campux 自己的防 CSRF / 回跳凭证改走 HttpOnly cookie（签名负载 = provider +
 * returnTo + 过期 + nonce）：发起登录时种下，callback 时要求 cookie 与会话匹配。
 * 这同时修复了旧实现的登录 CSRF：旧签名 state 任何浏览器都可重放，攻击者可把
 * 自己的第三方身份绑到受害者账号（SameSite=Lax 挡不住顶级 GET 导航）。
 */

import type { FastifyInstance } from "fastify";
import { createHmac, randomBytes } from "node:crypto";
import { z } from "zod";
import type { CampuxConfig } from "@campux/config";
import {
  createSession,
  getSessionContext,
  requireSession,
  setSessionCookie,
} from "../lib/auth";
import { getServerSigningSecret } from "../lib/server-signing-secret";
import { prisma } from "../lib/prisma";
import {
  AGGREGATE_OAUTH_LOGIN_TYPES,
  exchangeAggregateOauthCode,
  extractAggregateLoginUrlState,
  fetchAggregateLoginUrl,
  getAggregateOauthLoginTypesOrDefault,
  normalizeAggregateEndpoint,
  parseAggregateOauthUserInfo,
  type AggregateOauthLoginType,
} from "../lib/aggregate-oauth";
import { readTenantPluginConfig } from "../lib/tenant-plugin-config";
import { findManagementHostByRequest, findTenantByRequestHost } from "../lib/tenant-host";
import { resolveEffectiveTenantMembership } from "../lib/tenant-access";

const AGGREGATE_STATE_TTL_MS = 10 * 60 * 1000;
const AGGREGATE_STATE_COOKIE = "campux_agg_oauth";
const AGGREGATE_STATE_COOKIE_PATH = "/api/auth/aggregate-login/";

interface AggregateStatePayload {
  /** 常量，区分其他签名用途。 */
  t: "agg";
  /** 第三方登录方式。 */
  p: AggregateOauthLoginType;
  /** 回调后回跳的内部路径（已校验为站内路径）。 */
  r?: string;
  /** 过期时间戳（ms）。 */
  e: number;
  /** 一次性随机数。 */
  n: string;
}

function signAggregateState(payload: AggregateStatePayload): string {
  const secret = getServerSigningSecret();
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function parseAggregateState(token: string): AggregateStatePayload | null {
  try {
    const dot = token.lastIndexOf(".");
    if (dot <= 0) {
      return null;
    }
    const body = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const secret = getServerSigningSecret();
    const expected = createHmac("sha256", secret).update(body).digest("base64url");
    if (sig.length !== expected.length || !safeEqual(sig, expected)) {
      return null;
    }
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<AggregateStatePayload>;
    if (payload.t !== "agg") {
      return null;
    }
    if (
      typeof payload.p !== "string" ||
      !(AGGREGATE_OAUTH_LOGIN_TYPES as readonly string[]).includes(payload.p) ||
      typeof payload.e !== "number" ||
      typeof payload.n !== "string"
    ) {
      return null;
    }
    if (payload.e < Date.now()) {
      return null;
    }
    return payload as AggregateStatePayload;
  } catch {
    return null;
  }
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** 校验回跳目标是站内路径，阻止开放重定向与控制字符。 */
function normalizeReturnPath(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  if (!value.startsWith("/") || value.startsWith("//")) {
    return undefined;
  }
  // 控制字符（CR/LF 等）会让 Node setHeader 抛错 → 直接丢弃。
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    return undefined;
  }
  try {
    const url = new URL(value, "https://campux.invalid");
    if (url.origin !== "https://campux.invalid") {
      return undefined;
    }
  } catch {
    return undefined;
  }
  return value;
}

const loginUrlQuerySchema = z.object({
  type: z.string().trim().min(1),
  returnTo: z.string().max(1024).optional(),
});

/** 聚合站 return.php 转回时携带 code（文档 Step3；type 可能出现，仅透传日志用）。 */
const callbackQuerySchema = z.object({
  code: z.string().trim().min(1),
  type: z.string().trim().min(1).optional(),
});

const unbindBodySchema = z.object({
  type: z.string().trim().min(1),
});

const isAggregateLoginType = (value: string): value is AggregateOauthLoginType =>
  (AGGREGATE_OAUTH_LOGIN_TYPES as readonly string[]).includes(value);

/** 校验该方式已被租户启用，并且凭证已配齐。 */
function assertAggregateReady(plugin: { enabled: boolean; loginTypes: string[]; appId: string; appKey: string; endpoint: string }, type: AggregateOauthLoginType): void {
  if (!plugin.enabled) {
    throw new Error("聚合登录未启用");
  }
  if (!(plugin.loginTypes as string[]).includes(type)) {
    throw new Error(`未启用该登录方式`);
  }
  if (!plugin.appId || !plugin.appKey || !plugin.endpoint) {
    throw new Error("未配置聚合登录凭证（appid/appkey/接口地址）");
  }
  // 验证 endpoint，尽早暴露配置错误。
  try {
    normalizeAggregateEndpoint(plugin.endpoint);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "聚合登录接口地址配置错误");
  }
}

function buildAggregateStateCookie(token: string, maxAgeSeconds: number): string {
  const parts = [
    `${AGGREGATE_STATE_COOKIE}=${encodeURIComponent(token)}`,
    `Path=${AGGREGATE_STATE_COOKIE_PATH}`,
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
    process.env.NODE_ENV === "production" ? "Secure" : null,
  ];
  return parts.filter((part): part is string => Boolean(part)).join("; ");
}

function clearAggregateStateCookie(): string {
  return buildAggregateStateCookie("", 0);
}

export function registerAggregateOAuthRoutes(app: FastifyInstance, _config: CampuxConfig) {
  // ─── 公开配置：登录页读取（无需登录，按请求 host 解析租户）────────────────
  app.get("/api/public/aggregate-login/config", async (request, reply) => {
    const tenant = await findTenantByRequestHost(request);
    if (!tenant) {
      return reply.code(404).send({ message: "未找到对应校园墙" });
    }
    const config = await readTenantPluginConfig(prisma, tenant.id);
    const loginTypes = getAggregateOauthLoginTypesOrDefault(config.aggregateLogin.loginTypes);
    return {
      enabled: config.aggregateLogin.enabled,
      loginTypes,
    };
  });

  // ─── 发起登录：生成第三方授权跳转地址 ────────────────────────────────────
  app.get("/api/auth/aggregate-login/login-url", async (request, reply) => {
    const query = loginUrlQuerySchema.parse(request.query);
    if (!isAggregateLoginType(query.type)) {
      return reply.code(400).send({ message: "不支持的登录方式" });
    }
    const tenant = await findTenantByRequestHost(request);
    if (!tenant) {
      return reply.code(404).send({ message: "未找到对应校园墙" });
    }
    const plugin = (await readTenantPluginConfig(prisma, tenant.id)).aggregateLogin;
    try {
      assertAggregateReady(plugin, query.type);
    } catch (error) {
      return reply.code(409).send({ message: error instanceof Error ? error.message : "聚合登录暂不可用" });
    }
    const returnTo = normalizeReturnPath(query.returnTo);
    const statePayload: AggregateStatePayload = {
      t: "agg",
      p: query.type,
      e: Date.now() + AGGREGATE_STATE_TTL_MS,
      n: randomBytes(12).toString("base64url"),
    };
    if (returnTo) {
      statePayload.r = returnTo;
    }
    const signedState = signAggregateState(statePayload);

    const managementHost = await findManagementHostByRequest(request);
    const scheme = "https:";
    const host = managementHost ?? request.headers.host ?? "campux.invalid";
    const redirectUri = `${scheme}//${host}/api/auth/aggregate-login/callback`;

    let loginUrl: string;
    let providerState: string | undefined;
    try {
      const result = await fetchAggregateLoginUrl(
        {
          appId: plugin.appId,
          appKey: plugin.appKey,
          loginType: query.type,
          endpoint: plugin.endpoint,
        },
        redirectUri,
      );
      loginUrl = result.url;
      // 聚合站返回的授权 URL 可能自带它自己的 state（供其 return.php 回调会话用）。
      providerState = extractAggregateLoginUrlState(loginUrl);
    } catch (error) {
      app.log.warn({ err: error, queryType: query.type, endpoint: plugin.endpoint }, "aggregate login-url fetch failed");
      const detail = error instanceof Error && error.message.trim() ? error.message : "聚合登录授权地址获取失败";
      return reply.code(502).send({ message: detail });
    }

    // Campux 的防 CSRF state 走 HttpOnly cookie（见文件头说明）；授权 URL 上的
    // state 属于聚合站，绝不能覆盖，否则聚合站无法把第三方回调转回我们。
    reply.header("Set-Cookie", buildAggregateStateCookie(signedState, Math.ceil(AGGREGATE_STATE_TTL_MS / 1000)));
    if (providerState) {
      app.log.info({ queryType: query.type }, "aggregate login-url: preserving provider-owned state");
    }

    return { url: loginUrl };
  });

  // ─── 第三方回调（聚合站 return.php 转回）：处理登录 / 绑定 ───────────────
  app.get("/api/auth/aggregate-login/callback", async (request, reply) => {
    const query = callbackQuerySchema.parse(request.query);
    const cookieHeader = request.headers.cookie ?? "";
    const cookieMatch = cookieHeader
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${AGGREGATE_STATE_COOKIE}=`));
    let stateToken = "";
    if (cookieMatch) {
      const rawValue = cookieMatch.slice(AGGREGATE_STATE_COOKIE.length + 1);
      // 畸形编码（如裸 %）不应导致 500：当作无 cookie 处理，走统一的 400 分支。
      try {
        stateToken = decodeURIComponent(rawValue);
      } catch {
        stateToken = "";
      }
    }
    const state = stateToken ? parseAggregateState(stateToken) : null;
    // 立即清掉一次性 cookie，无论后续成败。
    reply.header("Set-Cookie", clearAggregateStateCookie());
    if (!state || !isAggregateLoginType(state.p)) {
      return reply
        .code(400)
        .send({ message: "无效或过期的登录请求，请回到登录页重新发起（登录请求与浏览器会话绑定，链接无法转交他人）" });
    }
    const tenant = await findTenantByRequestHost(request);
    if (!tenant) {
      return reply.code(404).send({ message: "未找到对应校园墙" });
    }
    const plugin = (await readTenantPluginConfig(prisma, tenant.id)).aggregateLogin;

    let providerUserId: string;
    let name: string | undefined;
    let avatar: string | undefined;
    try {
      assertAggregateReady(plugin, state.p);
      const token = await exchangeAggregateOauthCode(
        {
          appId: plugin.appId,
          appKey: plugin.appKey,
          loginType: state.p,
          endpoint: plugin.endpoint,
        },
        query.code,
      );
      const info = parseAggregateOauthUserInfo(token);
      providerUserId = info.id;
      name = info.name;
      avatar = info.avatar;
    } catch (error) {
      app.log.warn({ err: error }, "aggregate callback exchange failed");
      return reply.code(400).send({ message: error instanceof Error ? error.message : "聚合登录授权失败，请重试" });
    }

    const provider = `aggregate:${state.p}`;
    const identity = await prisma.oAuthIdentity.findUnique({
      where: { provider_providerUserId: { provider, providerUserId } },
    });

    const session = await getSessionContext(request);

    // 未登录：仅当该身份已绑定某账号时完成登录；否则提示先绑定，不做注册。
    if (!session) {
      if (!identity) {
        // 未绑定的第三方身份绝不自动建号：回登录页提示先登录已有账号完成绑定。
        return reply.redirect(`/login?aggregate_unbound=1&provider=${encodeURIComponent(state.p)}`);
      }
      const targetUser = await prisma.user.findUnique({
        where: { id: identity.userId },
        include: { memberships: { include: { tenant: true } } },
      });
      if (!targetUser) {
        return reply.code(409).send({ message: "绑定的账号已不存在，请联系管理员" });
      }
      // 第三方身份已绑定：建立会话，落地由前端 /api/auth/context 决定（自动选墙）。
      const effectiveMembership = resolveEffectiveTenantMembership({
        userId: targetUser.id,
        systemRole: targetUser.systemRole,
        tenantId: tenant.id,
        memberships: targetUser.memberships,
      });
      if (!effectiveMembership) {
        return reply.redirect(`/login?aggregate_no_access=1`);
      }
      const token = await createSession(targetUser.id, tenant.id);
      setSessionCookie(reply, token);
      const to = state.r && state.r.startsWith("/") ? state.r : "/";
      return reply.redirect(to);
    }

    // 已登录：把第三方身份绑定到当前用户（不自动建号）。
    if (identity && identity.userId !== session.user.id) {
      return reply.code(409).send({ message: "该第三方身份已绑定其他账号" });
    }
    if (!identity) {
      // createMany + skipDuplicates：吞掉并发下两次 findUnique==null 但先后 create 命中唯一键的竞态。
      const created = await prisma.oAuthIdentity.createMany({
        data: buildIdentityCreate(session.user.id, provider, providerUserId, name, avatar),
        skipDuplicates: true,
      });
      if (created.count === 0) {
        // 并发竞态：另一请求已创建该身份。复核归属：仍归当前用户则按幂等成功处理，否则明确报错。
        const raced = await prisma.oAuthIdentity.findUnique({
          where: { provider_providerUserId: { provider, providerUserId } },
        });
        if (!raced || raced.userId !== session.user.id) {
          return reply.code(409).send({ message: "该第三方身份已被其他账号绑定" });
        }
      } else {
        app.log.info(`[aggregate] bound ${provider} ${providerUserId} -> user ${session.user.id} (created=${created.count})`);
      }
      // 竞态/成功绑定后按「绑定到当前用户」做幂等，仍回跳。
      if (state.r) {
        const returnPath = normalizeReturnPath(state.r);
        const to = returnPath ?? "/";
        return reply.redirect(to);
      }
      // 无回跳目标（设置页发起）时，返回 JSON 便于前端刷新绑定列表。
      return {
        ok: true,
        bound: true,
        provider,
        identities: await loadIdentities(session.user.id),
      };
    }
    // 已绑定到当前用户 → 幂等成功。
    return {
      ok: true,
      bound: true,
      provider,
      identities: await loadIdentities(session.user.id),
    };
  });

  // ─── 我的绑定列表（设置页）──────────────────────────────────────────────
  app.get("/api/auth/aggregate-login/identities", async (request, reply) => {
    const session = await requireSession(request, reply);
    return { identities: await loadIdentities(session.user.id) };
  });

  // ─── 解绑 ───────────────────────────────────────────────────────────────
  app.post("/api/auth/aggregate-login/unbind", async (request, reply) => {
    const session = await requireSession(request, reply);
    const body = unbindBodySchema.parse(request.body);
    if (!isAggregateLoginType(body.type)) {
      return reply.code(400).send({ message: "不支持的登录方式" });
    }
    const provider = `aggregate:${body.type}`;
    await prisma.oAuthIdentity.deleteMany({
      where: { userId: session.user.id, provider },
    });
    return { ok: true, identities: await loadIdentities(session.user.id) };
  });
}

async function loadIdentities(userId: string) {
  const rows = await prisma.oAuthIdentity.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((row) => ({
    provider: row.provider.replace(/^aggregate:/, ""),
    name: row.name,
    createdAt: row.createdAt.toISOString(),
  }));
}

function buildIdentityCreate(
  userId: string,
  provider: string,
  providerUserId: string,
  name: string | undefined,
  avatar: string | undefined,
): { userId: string; provider: string; providerUserId: string; name?: string; avatar?: string } {
  const data: { userId: string; provider: string; providerUserId: string; name?: string; avatar?: string } = {
    userId,
    provider,
    providerUserId,
  };
  if (name) {
    data.name = name;
  }
  if (avatar) {
    data.avatar = avatar;
  }
  return data;
}
