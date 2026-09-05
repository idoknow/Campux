import { z } from "zod";
import type { Prisma } from "@campux/db";
import { prisma } from "./prisma";

type MetadataClient = typeof prisma | Prisma.TransactionClient;

export const tenantPluginConfigKey = "plugin_config";

export const BOT_MESSAGE_TYPE_MAX_LENGTH = 10;
export const ANONYMOUS_AVATAR_MAX_COUNT = 20;
export const COLOR_PRESET_MAX_COUNT = 10;

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
