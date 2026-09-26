import { z } from "zod";
import type { Prisma } from "@campux/db";
import { prisma } from "./prisma";

type MetadataClient = typeof prisma | Prisma.TransactionClient;

export const tenantPluginConfigKey = "plugin_config";

export const BOT_MESSAGE_TYPE_MAX_LENGTH = 10;
export const ANONYMOUS_AVATAR_MAX_COUNT = 20;
export const COLOR_PRESET_MAX_COUNT = 10;
export const BROADCAST_PRESET_MAX_COUNT = 5;

const colorPresetSchema = z.object({
  value: z.string().min(1).max(40),
  label: z.string().min(1).max(40),
  hex: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

export const tenantPluginConfigSchema = z.object({
  markdownRender: z
    .object({ enabled: z.boolean() })
    .default({ enabled: false }),
  colorSelection: z
    .object({
      enabled: z.boolean(),
      backgroundColors: z.array(colorPresetSchema).max(COLOR_PRESET_MAX_COUNT).default([]),
      textColors: z.array(colorPresetSchema).max(COLOR_PRESET_MAX_COUNT).default([]),
    })
    .default({ enabled: false, backgroundColors: [], textColors: [] }),
  fontSelection: z
    .object({
      enabled: z.boolean(),
      fonts: z
        .array(
          z.object({
            value: z.string().min(1),
            enabled: z.boolean(),
          }),
        )
        .default([]),
    })
    .default({ enabled: false, fonts: [] }),
  anonymousAvatar: z
    .object({
      enabled: z.boolean(),
      items: z
        .array(
          z.object({
            // 标识符：内置头像用文件名（如 "开心.svg"）；自定义头像用短 hash 作为稳定标识
            id: z.string().min(1).max(120),
            // 自定义 SVG 内容：形如 data:image/svg+xml;base64,.... 为空表示使用内置文件
            svg: z.string().max(65536).optional(),
          }),
        )
        .max(ANONYMOUS_AVATAR_MAX_COUNT)
        .default([]),
    })
    .default({ enabled: false, items: [] }),
  botStylishMessages: z
    .object({
      enabled: z.boolean(),
      messageTypes: z
        .array(
          z.object({
            type: z.string().min(1).max(60),
            label: z.string().min(1).max(60),
            enabled: z.boolean(),
            messages: z.array(z.string().min(1).max(240)).max(BOT_MESSAGE_TYPE_MAX_LENGTH),
          }),
        )
        .default([]),
    })
    .default({ enabled: false, messageTypes: [] }),
  // 投票竞选：开启后投稿页出现「投票」胶囊与服务页入口；
  // allowAnonymousCreate 关闭时不展示匿名发起开关，maxActivePerUser 统计「待审核 + 进行中」。
  campaigns: z
    .object({
      enabled: z.boolean(),
      allowAnonymousCreate: z.boolean(),
      maxActivePerUser: z.number().int().min(1).max(50),
    })
    .default({ enabled: false, allowAnonymousCreate: false, maxActivePerUser: 1 }),
  // 广播通知：开启后投稿页顶部出现「广播通知」胶囊与服务页入口。
  // quickPresets 是管理员配置的「快选生效时长」，发帖人点一下即可按当前时间推算结束时间；
  // 通知本身落 TenantBroadcast 表，不在本配置里持久化。
  broadcast: z
    .object({
      enabled: z.boolean(),
      quickPresets: z
        .array(
          z.object({
            label: z.string().min(1).max(24),
            // 自当前时刻起算的分钟数，必须为正且不超过 7 天
            minutes: z.number().int().min(1).max(10080),
          }),
        )
        .max(BROADCAST_PRESET_MAX_COUNT)
        .default([]),
    })
    .default({ enabled: false, quickPresets: [] }),
  // 毕业去向：开启后投稿页顶部出现「毕业」胶囊与服务页入口；
  // 入学年份（级）与毕业年份（届）均由用户在投稿页自行填写，审核通过后计入服务页统计。
  graduation: z
    .object({
      enabled: z.boolean(),
    })
    .default({ enabled: false }),
  // 聚合登录：把第三方平台（QQ/微信/支付宝等）身份绑定到已有账号后，用该身份直接登录。
  // 凭证（appid/appkey/endpoint）放在本配置里（租户级）；未绑定的第三方身份不自动建号，
  // 而是引导先登录已有账号完成绑定（严格「只做第三方登录、不涉及注册」）。
  aggregateLogin: z
    .object({
      enabled: z.boolean(),
      // 公开给登录页的第三方登录方式（仅在该集合内的方式才会出现在登录按钮上）。
      loginTypes: z.array(z.string()).default([]),
      // 聚合登录开放平台的凭证与接口地址。
      appId: z.string().max(128).default(""),
      appKey: z.string().max(256).default(""),
      endpoint: z.string().max(512).default(""),
    })
    .default({
      enabled: false,
      loginTypes: [],
      appId: "",
      appKey: "",
      endpoint: "",
    }),
  // 意见反馈：开启后投稿页顶部出现入口；提交后发到审核群。
  feedback: z
    .object({
      enabled: z.boolean(),
    })
    .default({ enabled: false }),
  // Bot 异常通知：登录态失效且自动刷新失败时，向配置的邮箱发送通知。
  botAlert: z
    .object({
      enabled: z.boolean(),
      smtpHost: z.string().max(255).default(""),
      smtpPort: z.number().int().min(1).max(65535).default(465),
      smtpUser: z.string().max(255).default(""),
      smtpPass: z.string().max(255).default(""),
      fromEmail: z.string().max(255).default(""),
      toEmails: z.array(z.string().max(255)).max(20).default([]),
    })
    .default({ enabled: false, smtpHost: "", smtpPort: 465, smtpUser: "", smtpPass: "", fromEmail: "", toEmails: [] }),
  // 那年今日：开启后投稿页顶部出现「那年今日」胶囊，展示历史上同一月同一日的已发布稿件。
  todayInHistory: z
    .object({
      enabled: z.boolean(),
    })
    .default({ enabled: false }),
});

export type TenantPluginConfig = z.infer<typeof tenantPluginConfigSchema>;
export type BotMessageTypeConfig = TenantPluginConfig["botStylishMessages"]["messageTypes"][number];
export type ColorPresetConfig = TenantPluginConfig["colorSelection"]["backgroundColors"][number];
export type SvgAvatarConfigItem = TenantPluginConfig["anonymousAvatar"]["items"][number];

export const defaultTenantPluginConfig: TenantPluginConfig = {
  markdownRender: { enabled: false },
  colorSelection: { enabled: false, backgroundColors: [], textColors: [] },
  fontSelection: { enabled: false, fonts: [] },
  anonymousAvatar: { enabled: false, items: [] },
  botStylishMessages: { enabled: false, messageTypes: [] },
  campaigns: { enabled: false, allowAnonymousCreate: false, maxActivePerUser: 1 },
  broadcast: { enabled: false, quickPresets: [] },
  graduation: { enabled: false },
  aggregateLogin: {
    enabled: false,
    loginTypes: [],
    appId: "",
    appKey: "",
    endpoint: "",
  },
  feedback: { enabled: false },
  botAlert: { enabled: false, smtpHost: "", smtpPort: 465, smtpUser: "", smtpPass: "", fromEmail: "", toEmails: [] },
  todayInHistory: { enabled: false },
};

export function parseTenantPluginConfig(value: unknown): TenantPluginConfig {
  if (value === null || value === undefined || typeof value !== "object" || Array.isArray(value)) {
    return structuredClone(defaultTenantPluginConfig);
  }
  // 兼容旧版持久化的 { filename } 结构：迁移为 { id }，无 svg 字段。
  const maybeLegacy = value as Record<string, unknown>;
  const normalized: Record<string, unknown> = { ...maybeLegacy };
  const anonymousAvatar = maybeLegacy.anonymousAvatar as Record<string, unknown> | undefined;
  if (anonymousAvatar && Array.isArray(anonymousAvatar.items)) {
    normalized.anonymousAvatar = {
      ...anonymousAvatar,
      items: (anonymousAvatar.items as Array<Record<string, unknown>>).map((item) => {
        const id = typeof item.id === "string" ? item.id : typeof item.filename === "string" ? item.filename : "";
        const svg = typeof item.svg === "string" ? item.svg : undefined;
        return svg ? { id, svg } : { id };
      }).filter((item) => Boolean((item as { id: string }).id)),
    };
  }
  const result = tenantPluginConfigSchema.safeParse(normalized);
  return result.success ? result.data : structuredClone(defaultTenantPluginConfig);
}

export async function readTenantPluginConfig(
  client: MetadataClient,
  tenantId: string,
): Promise<TenantPluginConfig> {
  const entry = await client.tenantMetadata.findUnique({
    where: { tenantId_key: { tenantId, key: tenantPluginConfigKey } },
    select: { value: true },
  });
  return parseTenantPluginConfig(entry?.value);
}

export async function writeTenantPluginConfig(
  client: MetadataClient,
  tenantId: string,
  config: TenantPluginConfig,
): Promise<TenantPluginConfig> {
  const normalized = tenantPluginConfigSchema.parse(config);
  await client.tenantMetadata.upsert({
    where: { tenantId_key: { tenantId, key: tenantPluginConfigKey } },
    update: { value: normalized },
    create: { tenantId, key: tenantPluginConfigKey, value: normalized },
  });
  return normalized;
}

/** AppKey 返回给管理端前端时的掩码占位符。 */
export const AGGREGATE_APPKEY_MASK = "••••••••";

/**
 * 把聚合登录的 AppKey 脱敏后再返回给前端（只读方向），避免明文凭证出现在
 * 前端响应/审计。保存方向由路由层负责：若提交值等于掩码则保留库中原值。
 */
export function maskAggregateAppKey(config: TenantPluginConfig): TenantPluginConfig {
  const appKey = config.aggregateLogin.appKey;
  if (!appKey) {
    return config;
  }
  return {
    ...config,
    aggregateLogin: {
      ...config.aggregateLogin,
      appKey: AGGREGATE_APPKEY_MASK,
    },
  };
}

/** 段级别脱敏：对 aggregateLogin 配置段本身（非完整配置）脱敏 AppKey，供审计日志等使用。 */
export function maskAggregateLoginSection<T extends { appKey?: string }>(section: T): T {
  if (section && typeof section === "object" && section.appKey) {
    return { ...section, appKey: AGGREGATE_APPKEY_MASK };
  }
  return section;
}

/** 保存方向：若组件提交的 AppKey 仍是掩码占位符，说明未改动，用库中原值替换，避免把掩码写回。 */
export function restoreAggregateAppKey(submitted: TenantPluginConfig, existing: TenantPluginConfig): TenantPluginConfig {
  const appKey = submitted.aggregateLogin.appKey;
  if (appKey === AGGREGATE_APPKEY_MASK) {
    return {
      ...submitted,
      aggregateLogin: { ...submitted.aggregateLogin, appKey: existing.aggregateLogin.appKey },
    };
  }
  return submitted;
}

export const BOT_ALERT_PASS_MASK = "••••••••";

export function maskBotAlertPass(config: TenantPluginConfig): TenantPluginConfig {
  if (!config.botAlert.smtpPass) return config;
  return { ...config, botAlert: { ...config.botAlert, smtpPass: BOT_ALERT_PASS_MASK } };
}

export function maskBotAlertSection<T extends { smtpPass?: string }>(section: T): T {
  if (section && typeof section === "object" && section.smtpPass) {
    return { ...section, smtpPass: BOT_ALERT_PASS_MASK };
  }
  return section;
}

export function restoreBotAlertPass(submitted: TenantPluginConfig, existing: TenantPluginConfig): TenantPluginConfig {
  if (submitted.botAlert.smtpPass === BOT_ALERT_PASS_MASK) {
    return { ...submitted, botAlert: { ...submitted.botAlert, smtpPass: existing.botAlert.smtpPass } };
  }
  return submitted;
}

// 审计读取兜底：历史明细行可能在脱敏修复前写入了明文凭证，读取端点返回 detail 前
// 对 before/after 段做再脱敏，保证 aggregateLogin.appKey / botAlert.smtpPass 不回显。
export function maskAuditDetailSections<T>(detail: T): T {
  if (!detail || typeof detail !== "object") return detail;
  const source = detail as Record<string, unknown>;
  const result: Record<string, unknown> = { ...source };
  for (const key of ["before", "after"]) {
    const section = result[key];
    if (section && typeof section === "object") {
      result[key] = maskBotAlertSection(maskAggregateLoginSection(section as Record<string, unknown>));
    }
  }
  return result as T;
}
