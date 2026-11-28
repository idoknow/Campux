import type { Prisma } from "@campux/db";
import { prisma } from "./prisma";

/**
 * 网页注册的邮箱验证策略（租户级）。
 *
 * 由墙主/管理员在「管理 · 墙面设置 · 注册与邮箱验证」里配置：
 * - `enabled=false`：注册只填 QQ 号 + 用户名 + 密码（原有行为）；
 * - `enabled=true`：注册必须填邮箱并收验证码，且邮箱后缀必须在允许列表内。
 *
 * `allowedSuffixes` 为空数组时表示**不限制后缀**（等价于接受任意邮箱）。
 * 这一点必须在 UI 上明确告诉运营者，否则容易误以为「空 = 全禁」。
 */
export type RegistrationEmailPolicy = {
  required: boolean;
  /** 允许的邮箱后缀，形如 ["qq.com", "163.com"]；空数组 = 不限制。 */
  allowedSuffixes: string[];
};

export const registrationEmailPolicyKey = "registration_email_policy";

export const registrationEmailPolicyDefaults: RegistrationEmailPolicy = {
  required: false,
  allowedSuffixes: [],
};

/** 常用邮箱域名，供管理端一键勾选。 */
export const COMMON_EMAIL_SUFFIXES = [
  "qq.com",
  "foxmail.com",
  "163.com",
  "126.com",
  "yeah.net",
  "sina.com",
  "sohu.com",
  "139.com",
  "aliyun.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "gmail.com",
  "icloud.com",
] as const;

/**
 * 教育网这类「域树」预置项：勾选即放开其下所有子域。
 * 单独列出并标明 `*.` 前缀，让运营者一眼看出「这放开的是一整棵树」。
 */
export const COMMON_WILDCARD_DOMAINS = [
  "edu.cn",
  "ac.cn",
  "edu.hk",
] as const;

/** 允许列表的上限：防止被写进几千条后缀拖慢每次注册校验。 */
export const MAX_ALLOWED_SUFFIXES = 50;

/**
 * 邮箱域名条目：`allowsSubdomains` 决定是否把整个子域树都放开。
 *
 * 为什么要区分：把 `edu.cn` 当成「后缀」会让 `*.edu.cn` **全部**通过，
 * 而 `edu.cn` 之下并不只有学校（还有大量培训机构与企业域）。
 * 运营者勾 `edu.cn` 的本意几乎必然是「只收本校」，静默放开整棵树是安全默认值错误。
 *
 * 所以：
 * - 默认**精确匹配**（`qq.com` 只接受 `@qq.com`）；
 * - 需要子域时显式开启（如 `mail.tsinghua.edu.cn` 允许其下级）。
 */
export type EmailDomainRule = {
  domain: string;
  allowsSubdomains: boolean;
};

/**
 * 条目解析规则：
 * - `qq.com`      → 精确匹配
 * - `*.edu.cn`    → 该域及其所有子域
 * - `mail.x.edu.cn` → 精确匹配（可再加 `*` 前缀放开其子域）
 */
export function parseEmailDomainRule(input: unknown): EmailDomainRule | null {
  if (typeof input !== "string") return null;
  let raw = input.trim().toLowerCase().replace(/^[@.]/, "").replace(/\.+$/, "");
  let allowsSubdomains = false;
  if (raw.startsWith("*.")) {
    allowsSubdomains = true;
    raw = raw.slice(2);
  }
  const domain = normalizeEmailSuffix(raw);
  if (!domain) return null;
  return { domain, allowsSubdomains };
}

export function serializeEmailDomainRule(rule: EmailDomainRule): string {
  return rule.allowsSubdomains ? `*.${rule.domain}` : rule.domain;
}

/**
 * 规范化后缀：去空格、去前导 @、转小写、去空、去重。
 * 接受 `@qq.com`、`.qq.com`、`QQ.com` 等写法，统一成 `qq.com`。
 */
export function normalizeEmailSuffix(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim().toLowerCase().replace(/^[@.]+/, "").replace(/\.+$/, "");
  if (!trimmed) return null;
  // 后缀至少要有一段点，避免误把 "com" 当成合法后缀放开所有 .com 域。
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(trimmed)) return null;
  return trimmed;
}

export function normalizeAllowedSuffixes(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  for (const item of input) {
    // 必须用 parseEmailDomainRule：它认得 `*.` 通配前缀，
    // 直接用 normalizeEmailSuffix 会把 `*.edu.cn` 当成非法条目丢掉。
    const rule = parseEmailDomainRule(item);
    if (rule) seen.add(serializeEmailDomainRule(rule));
    if (seen.size >= MAX_ALLOWED_SUFFIXES) break;
  }
  return [...seen];
}

export function normalizeRegistrationEmailPolicy(value: unknown): RegistrationEmailPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...registrationEmailPolicyDefaults, allowedSuffixes: [] };
  }
  const record = value as Record<string, unknown>;
  return {
    required: record.required === true,
    allowedSuffixes: normalizeAllowedSuffixes(record.allowedSuffixes),
  };
}

export async function readRegistrationEmailPolicy(
  client: typeof prisma | Prisma.TransactionClient,
  tenantId: string,
): Promise<RegistrationEmailPolicy> {
  const entry = await client.tenantMetadata.findUnique({
    where: { tenantId_key: { tenantId, key: registrationEmailPolicyKey } },
    select: { value: true },
  });
  return normalizeRegistrationEmailPolicy(entry?.value);
}

/** 取邮箱的域部分（小写）；格式不合法时返回 null。 */
export function emailDomain(email: string): string | null {
  const match = /^[^\s@]+@([^\s@]+)$/.exec(email.trim().toLowerCase());
  return match?.[1] ?? null;
}

/**
 * 邮箱是否满足本墙策略。
 * `allowedSuffixes` 为空表示不限制，此时任意合法邮箱都通过。
 *
 * 匹配口径（见 `EmailDomainRule`）：
 * - 不带 `*` 的条目**精确匹配**该域名；
 * - 带 `*.` 前缀的条目放开该域及其所有子域。
 *
 * 历史数据里可能存在按「后缀」语义写下的宽条目（如 `edu.cn` 想放开全校）。
 * 现在统一按精确匹配处理，是刻意收紧：宁可运营者发现「学生注册不了」而补一条
 * `*.edu.cn`，也不要静默放开整棵树。
 */
export function isEmailAllowedByPolicy(email: string, policy: RegistrationEmailPolicy): { ok: boolean; reason?: string } {
  const domain = emailDomain(email);
  if (!domain) {
    return { ok: false, reason: "邮箱格式不正确" };
  }
  if (policy.allowedSuffixes.length === 0) {
    return { ok: true };
  }
  const matched = policy.allowedSuffixes.some((entry) => {
    const rule = parseEmailDomainRule(entry);
    if (!rule) return false;
    return rule.allowsSubdomains
      ? domain === rule.domain || domain.endsWith(`.${rule.domain}`)
      : domain === rule.domain;
  });
  if (!matched) {
    return {
      ok: false,
      reason: `本墙只接受这些邮箱：${policy.allowedSuffixes.map((s) => `@${s}`).join("、")}`,
    };
  }
  return { ok: true };
}

/**
 * QQ 邮箱的 QQ 号前缀（如 `123456@qq.com` → `123456`）。
 * 仅识别 qq.com，`foxmail.com` 虽然同属腾讯但不保证前缀是 QQ 号，故排除。
 */
export function qqUinFromQqEmail(email: string): string | null {
  const normalized = email.trim().toLowerCase();
  const match = /^([1-9]\d{4,11})@qq\.com$/.exec(normalized);
  return match?.[1] ?? null;
}

/**
 * 注册时的 QQ 号 / 邮箱一致性校验。
 *
 * 填的是 <QQ号>@qq.com 时必须让登记的 QQ 号与邮箱前缀一致，
 * 避免有人拿别人的 QQ 邮箱注册成自己的号，日后再也说不清归属。
 */
export function checkQqEmailMatchesQqUin(email: string, qqUin: string): { ok: boolean; reason?: string } {
  const prefix = qqUinFromQqEmail(email);
  if (!prefix) {
    return { ok: true };
  }
  if (prefix !== qqUin.trim()) {
    return {
      ok: false,
      reason: `邮箱 ${email} 是 QQ 邮箱，登记的用户 QQ 号必须与邮箱前缀一致（应为 ${prefix}）`,
    };
  }
  return { ok: true };
}
