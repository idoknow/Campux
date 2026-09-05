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
            filename: z.string().min(1).max(120),
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
  const result = tenantPluginConfigSchema.safeParse(value);
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
