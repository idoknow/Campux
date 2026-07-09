import { URL } from "node:url";
import { FONT_OPTIONS, isDefaultFont } from "@campux/domain";
import { prisma } from "./prisma";

// ── 允许的背景色名称 ──────────────────────────────────
const ALLOWED_BG_COLORS = new Set([
  "white",
  "pink",
  "blue",
  "green",
  "yellow",
  "orange",
  "purple",
]);

// ── 允许的字体名称 ────────────────────────────────────
const ALLOWED_FONTS = new Set<string>([
  ...FONT_OPTIONS.filter((font) => !isDefaultFont(font.value)).map((font) => font.value),
]);

// ── 允许的文字颜色名称 ────────────────────────────────
const ALLOWED_TEXT_COLORS = new Set([
  "black",
  "dark_red",
  "dark_blue",
  "dark_green",
  "dark_pink",
  "dark_purple",
  "dark_orange",
]);

// ── 注入检测正则 ──────────────────────────────────────

/** HTML 标签检测 */
const HTML_TAG_RE = /<[a-z][\s\S]*?>/i;

/** 内联 CSS 注入检测：url(), @import, expression(), javascript: */
const CSS_INJECTION_RE = /url\s*\(|@import|expression\s*\(|javascript\s*:/i;

/** QQ/OneBot CQ 码检测：如 [CQ:at,qq=123]、[CQ:image,file=...] */
const CQ_CODE_RE = /\[CQ:[a-z]+,/i;

/** Markdown 代码块 */
const CODE_BLOCK_RE = /```[\s\S]*?```/;

/** Markdown 内联代码 */
const INLINE_CODE_RE = /`[^`]+`/;

/** javascript: 伪协议链接 */
const JAVASCRIPT_PROTOCOL_RE = /javascript\s*:/i;

/** data: URI 检测 */
const DATA_URI_RE = /^data:/i;

// ── SSRF 黑名单 ───────────────────────────────────────

/** 私有 / 内网 IP 前缀（IPv4） */
const PRIVATE_IP_PREFIXES = [
  "127.",
  "10.",
  "172.16.",
  "172.17.",
  "172.18.",
  "172.19.",
  "172.20.",
  "172.21.",
  "172.22.",
  "172.23.",
  "172.24.",
  "172.25.",
  "172.26.",
  "172.27.",
  "172.28.",
  "172.29.",
  "172.30.",
  "172.31.",
  "192.168.",
  "0.",
  "169.254.",
  "100.64.",
  "100.65.",
  "100.66.",
  "100.67.",
  "100.68.",
  "100.69.",
  "100.70.",
  "100.71.",
  "100.72.",
  "100.73.",
  "100.74.",
  "100.75.",
  "100.76.",
  "100.77.",
  "100.78.",
  "100.79.",
  "100.80.",
  "100.81.",
  "100.82.",
  "100.83.",
  "100.84.",
  "100.85.",
  "100.86.",
  "100.87.",
  "100.88.",
  "100.89.",
  "100.90.",
  "100.91.",
  "100.92.",
  "100.93.",
  "100.94.",
  "100.95.",
  "100.96.",
  "100.97.",
  "100.98.",
  "100.99.",
  "100.100.",
  "100.101.",
  "100.102.",
  "100.103.",
  "100.104.",
  "100.105.",
  "100.106.",
  "100.107.",
  "100.108.",
  "100.109.",
  "100.110.",
  "100.111.",
  "100.112.",
  "100.113.",
  "100.114.",
  "100.115.",
  "100.116.",
  "100.117.",
  "100.118.",
  "100.119.",
  "100.120.",
  "100.121.",
  "100.122.",
  "100.123.",
  "100.124.",
  "100.125.",
  "100.126.",
  "100.127.",
  "198.18.",
  "198.19.",
];

const PRIVATE_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "0.0.0.0",
  "[::1]",
]);

const PRIVATE_HOSTNAME_SUFFIXES = [
  ".local",
  ".internal",
  ".lan",
  ".localhost",
];

// ── 注入检测类型 ──────────────────────────────────────

export type InjectionType =
  | "html_tag"
  | "css_injection"
  | "cq_code"
  | "code_block"
  | "inline_code"
  | "javascript_protocol";

export type InjectionResult = {
  detected: true;
  type: InjectionType;
  reason: string;
} | { detected: false };

/**
 * 检测投稿文本中的各类注入。
 * 任一匹配即返回对应的 InjectionType 与原因描述。
 */
export function detectTextInjection(text: string): InjectionResult {
  if (HTML_TAG_RE.test(text)) {
    return { detected: true, type: "html_tag", reason: "投稿内容包含 HTML 标签" };
  }
  if (CSS_INJECTION_RE.test(text)) {
    return { detected: true, type: "css_injection", reason: "投稿内容包含 CSS 注入" };
  }
  if (CQ_CODE_RE.test(text)) {
    return { detected: true, type: "cq_code", reason: "投稿内容包含 CQ 码" };
  }
  if (CODE_BLOCK_RE.test(text)) {
    return { detected: true, type: "code_block", reason: "投稿内容包含代码块" };
  }
  if (INLINE_CODE_RE.test(text)) {
    return { detected: true, type: "inline_code", reason: "投稿内容包含内联代码" };
  }
  if (JAVASCRIPT_PROTOCOL_RE.test(text)) {
    return { detected: true, type: "javascript_protocol", reason: "投稿内容包含 JavaScript 伪协议" };
  }
  return { detected: false };
}

/**
 * 检测颜色值是否安全（只允许预定义的语义名称）。
 */
export function validateBgColor(value: string | null | undefined): boolean {
  if (!value) return true;
  return ALLOWED_BG_COLORS.has(value);
}

export function validateTextColor(value: string | null | undefined): boolean {
  if (!value) return true;
  return ALLOWED_TEXT_COLORS.has(value);
}

export function validateFont(value: string | null | undefined): boolean {
  if (isDefaultFont(value)) return true;
  return typeof value === "string" && ALLOWED_FONTS.has(value);
}

/**
 * 检测单条 URL 是否存在 SSRF 风险。
 * 仅允许 http/https，禁止内网地址。
 */
export function validateUrlForFetch(url: string): { valid: true } | { valid: false; reason: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, reason: "URL 格式无效" };
  }

  // 仅允许 http / https
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { valid: false, reason: "仅允许 http/https 协议" };
  }

  // 检查主机名黑名单
  const hostname = parsed.hostname.toLowerCase();

  if (PRIVATE_HOSTNAMES.has(hostname)) {
    return { valid: false, reason: "不允许访问内网地址" };
  }

  for (const suffix of PRIVATE_HOSTNAME_SUFFIXES) {
    if (hostname.endsWith(suffix)) {
      return { valid: false, reason: "不允许访问内网地址" };
    }
  }

  // 检查 IP 黑名单
  if (PRIVATE_IP_PREFIXES.some((prefix) => hostname.startsWith(prefix))) {
    return { valid: false, reason: "不允许访问内网地址" };
  }

  return { valid: true };
}

/**
 * 对 SSRF 检测的完整 URL 列表进行检查。
 * 返回所有非法 URL 的列表。
 */
export function validateRemoteGifUrls(urls: string[]): { valid: true } | { valid: false; invalidUrls: string[]; reason: string } {
  const invalidUrls: string[] = [];

  for (const url of urls) {
    const result = validateUrlForFetch(url);
    if (!result.valid) {
      invalidUrls.push(url);
    }
  }

  if (invalidUrls.length > 0) {
    return {
      valid: false,
      invalidUrls,
      reason: `以下 URL 不允许访问：${invalidUrls.join(", ")}`,
    };
  }

  return { valid: true };
}

/**
 * 检测投稿的所有字段是否存在注入风险。
 * 返回第一个检测到的注入结果。
 */
export function detectPostInjection(fields: {
  text: string;
  bgColor?: string | null;
  textColor?: string | null;
  font?: string | null;
}): InjectionResult {
  // 检查文本注入
  const textResult = detectTextInjection(fields.text);
  if (textResult.detected) return textResult;

  // 检查背景色注入
  if (fields.bgColor && !validateBgColor(fields.bgColor)) {
    return {
      detected: true,
      type: "css_injection",
      reason: `不允许的背景色：${fields.bgColor}`,
    };
  }

  // 检查文字颜色注入
  if (fields.textColor && !validateTextColor(fields.textColor)) {
    return {
      detected: true,
      type: "css_injection",
      reason: `不允许的文字颜色：${fields.textColor}`,
    };
  }

  // 检查字体注入
  if (fields.font && !validateFont(fields.font)) {
    return {
      detected: true,
      type: "css_injection",
      reason: `不允许的字体：${fields.font}`,
    };
  }

  return { detected: false };
}

/**
 * 对文本进行安全清理（用于显示时去除不安全内容）。
 * - 移除 HTML 标签
 * - 转义 CQ 码（QQ 消息注入防护）
 */
export function sanitizeTextForDisplay(text: string): string {
  return text
    // 移除 HTML 标签
    .replace(/<[a-z][\s\S]*?>/gi, "")
    // 转义 CQ 码：将 [ 和 ] 替换为全角字符，防止 OneBot 解析
    .replace(/\[CQ:/gi, "［CQ:")
    .replace(/\](?!\s|$|\.|,|!|\?|;|:)/g, "］"); // 保守处理
}

/**
 * 对文本进行安全清理，用于存储（去除注入内容但保留正文）。
 * - 移除 HTML 标签
 * - 移除代码块
 * - 移除内联代码（保留代码文字）
 * - 转义 CQ 码
 * - 移除 javascript: 伪协议
 */
export function sanitizeTextForStorage(text: string): string {
  return text
    // 移除 HTML 标签
    .replace(/<[a-z][\s\S]*?>/gi, "")
    // 移除代码块
    .replace(/```[\s\S]*?```/g, "")
    // 移除内联代码标记（保留文字内容）
    .replace(/`([^`]+)`/g, "$1")
    // 转义 CQ 码
    .replace(/\[CQ:/gi, "&#91;CQ:")
    // 移除 javascript: 伪协议
    .replace(/javascript\s*:/gi, "");
}

// ── 自动封禁 ──────────────────────────────────────────

const BAN_DURATION_MS = 24 * 60 * 60 * 1000; // 1 天

/**
 * 封禁账号：为该用户所有已加入的校园墙创建封禁记录。
 * 这确保用户在所有校园墙内都无法操作（全局封禁账号）。
 */
export async function createAutoBan({
  tenantId,
  userId,
  operatorId,
  reason,
  onBan,
}: {
  tenantId: string;
  userId: string;
  operatorId?: string;
  reason: string;
  onBan?: (userId: string, allTenantIds: string[], endsAt: Date) => Promise<void>;
}): Promise<void> {
  const endsAt = new Date(Date.now() + BAN_DURATION_MS);

  // 查出该用户所有已加入的校园墙
  const memberships = await prisma.tenantMembership.findMany({
    where: { userId },
    select: { tenantId: true },
  });

  const allTenantIds = [
    ...new Set([tenantId, ...memberships.map((m) => m.tenantId)]),
  ];

  // 为每个校园墙创建封禁记录
  await prisma.banRecord.createMany({
    data: allTenantIds.map((tid) => ({
      tenantId: tid,
      userId,
      operatorId: operatorId ?? null,
      comment: `自动封禁（24小时）：${reason}`,
      endsAt,
    })),
  });

  // 封禁后回调（用于发送通知等）
  if (onBan) {
    await onBan(userId, allTenantIds, endsAt).catch(() => undefined);
  }
}
