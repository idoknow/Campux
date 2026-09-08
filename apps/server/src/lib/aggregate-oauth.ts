/**
 * 聚合登录协议客户端。
 *
 * 对接第三方聚合登录的 OAuth 协议（以 https://a.idcfx.net 为例，act=login / act=callback）：
 *   act=login    换取第三方授权跳转 URL（QQ/微信/微信/支付宝/抖音/google/twitter/飞书等）
 *   act=callback 用 code 换取用户信息（social_uid / nickname / faceimg 等）
 *
 * 设计对齐 VoiceHub 的 aggregateOAuthStrategy：回调返回的完整用户信息以
 * base64url 包装，后续 getUserInfo 再解开，避免二次请求。
 */

import { z } from "zod";

// ─── 支持的第三方登录方式 ──────────────────────────────────
// 对齐 VoiceHub 的 AGGREGATE_OAUTH_LOGIN_TYPES。
export const AGGREGATE_OAUTH_LOGIN_TYPES = [
  "qq",
  "wx",
  "alipay",
  "douyin",
  "sina",
  "baidu",
  "huawei",
  "xiaomi",
  "gitee",
  "gitea",
  "bilibili",
  "kuaishou",
] as const;

export type AggregateOauthLoginType = (typeof AGGREGATE_OAUTH_LOGIN_TYPES)[number];

const isAggregateLoginType = (value: string): value is AggregateOauthLoginType =>
  (AGGREGATE_OAUTH_LOGIN_TYPES as readonly string[]).includes(value);

/** 归一化登录方式数组：容忍 JSON 数组、逗号分隔、大小写，去重并过滤未知值。 */
export function normalizeAggregateOauthLoginTypes(value: unknown): AggregateOauthLoginType[] {
  let values: unknown[] = [];
  if (Array.isArray(value)) {
    values = value;
  } else if (typeof value === "string" && value.trim()) {
    const trimmed = value.trim();
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      values = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      values = trimmed.split(",");
    }
  }
  return [
    ...new Set(
      values
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim().toLowerCase())
        .filter(isAggregateLoginType),
    ),
  ];
}

/** 登录页/设置页实际展示的登录方式：显式配置时用配置，未配置则返回空数组（不默认放任何平台）。 */
export function getAggregateOauthLoginTypesOrDefault(value: unknown): AggregateOauthLoginType[] {
  return normalizeAggregateOauthLoginTypes(value);
}

// ─── 请求并发/安全 ────────────────────────────────────────
const AGGREGATE_REQUEST_TIMEOUT_MS = 15_000;

const AGGREGATE_REQUEST_HEADERS: Record<string, string> = {
  Accept: "application/json",
  // 部分聚合站点 CDN 会拦截无 UA 的服务端请求。
  "User-Agent": "Mozilla/5.0 (compatible; Campux AggregateOAuth/1.0)",
  "Cache-Control": "no-cache",
};

const aggregateEndpointSchema = z.string().transform((value, ctx) => {
  const trimmed = value.trim();
  if (!trimmed) {
    ctx.addIssue({ code: "custom", message: "聚合登录接口地址不能为空" });
    return z.NEVER;
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    ctx.addIssue({ code: "custom", message: "聚合登录接口地址不是合法 URL" });
    return z.NEVER;
  }
  if (url.protocol !== "https:") {
    ctx.addIssue({ code: "custom", message: "聚合登录接口地址必须为 https 协议" });
    return z.NEVER;
  }
  url.search = "";
  url.hash = "";
  const normalized = url.toString().replace(/\/$/, "");
  return normalized;
});

/** 归一化端点：仅允许 https、去 query/hash、去尾斜杠。 */
export function normalizeAggregateEndpoint(endpoint: string): string {
  const result = aggregateEndpointSchema.safeParse(endpoint);
  if (!result.success) {
    throw new Error(result.error.issues[0]?.message ?? "聚合登录接口地址配置错误");
  }
  return result.data;
}

export interface AggregateOauthConfig {
  appId: string;
  appKey: string;
  loginType: AggregateOauthLoginType;
  endpoint: string;
}

export interface AggregateOauthLoginUrlResult {
  url: string;
  qrcode?: string;
}

export interface AggregateOauthUserInfo {
  /** 第三方平台 UID（social_uid） */
  id: string;
  /** 昵称 */
  name: string;
  /** 头像 */
  avatar?: string;
}

const FAILURE_MARKERS = /<html|just a moment|cloudflare|cf-chl-|enable javascript/i;

function extractProviderMessage(value: unknown): string | null {
  let message: unknown = value;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    message = record.msg ?? record.message ?? record.error_description ?? record;
  }
  if (typeof message === "string" && message.trim()) {
    // CDN/WAF 挑战页不是协议错误，避免把整段 HTML 当消息。
    if (FAILURE_MARKERS.test(message)) {
      return null;
    }
    return message
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 200);
  }
  return null;
}

const isSuccessCode = (value: unknown): boolean =>
  value === 0 || value === "0";

async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AGGREGATE_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: AGGREGATE_REQUEST_HEADERS,
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`聚合登录接口返回 HTTP ${response.status}${text ? `：${extractProviderMessage(text) ?? text.slice(0, 120)}` : ""}`);
    }
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  } finally {
    clearTimeout(timer);
  }
}

/** 获取第三方授权跳转 URL（act=login）。 */
export async function fetchAggregateLoginUrl(config: AggregateOauthConfig, redirectUri: string): Promise<AggregateOauthLoginUrlResult> {
  const endpoint = normalizeAggregateEndpoint(config.endpoint);
  const params = new URLSearchParams({
    act: "login",
    appid: config.appId,
    appkey: config.appKey,
    type: config.loginType,
    redirect_uri: redirectUri,
  });
  const payload = (await fetchJson(`${endpoint}?${params.toString()}`)) as Record<string, unknown> | null;
  if (!isSuccessCode(payload?.code)) {
    const providerMessage = extractProviderMessage(payload);
    throw new Error(providerMessage ? `聚合登录授权地址获取失败：${providerMessage}` : "聚合登录授权地址获取失败");
  }
  if (typeof payload?.url !== "string" || !payload.url) {
    throw new Error("聚合登录返回了无效的授权地址");
  }
  const result: AggregateOauthLoginUrlResult = { url: payload.url };
  if (typeof payload?.qrcode === "string" && payload.qrcode) {
    result.qrcode = payload.qrcode;
  }
  return result;
}

/** 用 code 换取用户信息（act=callback）。返回 base64url 包装的完整用户信息。 */
export async function exchangeAggregateOauthCode(config: AggregateOauthConfig, code: string): Promise<string> {
  const endpoint = normalizeAggregateEndpoint(config.endpoint);
  const params = new URLSearchParams({
    act: "callback",
    appid: config.appId,
    appkey: config.appKey,
    type: config.loginType,
    code,
  });
  const payload = (await fetchJson(`${endpoint}?${params.toString()}`)) as Record<string, unknown> | null;
  if (!isSuccessCode(payload?.code)) {
    const providerMessage = extractProviderMessage(payload);
    throw new Error(providerMessage ? `聚合登录授权失败：${providerMessage}` : "聚合登录授权失败，请重试");
  }
  if (typeof payload?.social_uid !== "string" || !payload.social_uid) {
    throw new Error("聚合登录响应缺少用户唯一标识");
  }
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

/** 从 base64url 包装解析用户信息。 */
export function parseAggregateOauthUserInfo(accessToken: string): AggregateOauthUserInfo {
  const parsed = JSON.parse(Buffer.from(accessToken, "base64url").toString("utf8")) as Record<string, unknown>;
  const id = typeof parsed.social_uid === "string" && parsed.social_uid ? parsed.social_uid : null;
  if (!id) {
    throw new Error("聚合登录用户信息中缺少 social_uid");
  }
  const nickname = typeof parsed.nickname === "string" && parsed.nickname.trim() ? parsed.nickname.trim() : null;
  const faceimg = typeof parsed.faceimg === "string" && parsed.faceimg.trim() ? parsed.faceimg.trim() : null;
  const info: AggregateOauthUserInfo = {
    id,
    name: nickname ?? id,
  };
  if (faceimg) {
    info.avatar = faceimg;
  }
  return info;
}