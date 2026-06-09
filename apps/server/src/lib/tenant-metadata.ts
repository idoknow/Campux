import { Prisma } from "@campux/db";
import { prisma } from "./prisma";

type MetadataClient = typeof prisma | Prisma.TransactionClient;

export const defaultPendingPostLimit = 1;
export const maxPendingPostLimit = 50;
export const pendingPostLimitMetadataKey = "pending_post_limit";

export const imageCompressionEnabledKey = "image_compression_enabled";
export const imageCompressionQualityKey = "image_compression_quality";
export const imageCompressionMaxDimensionKey = "image_compression_max_dimension";

export const imageCompressionDefaults = {
  enabled: true,
  quality: 80,
  maxDimension: 2048,
};

export function normalizePendingPostLimit(value: unknown) {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : defaultPendingPostLimit;
  if (!Number.isFinite(numeric)) {
    return defaultPendingPostLimit;
  }
  return Math.max(0, Math.min(maxPendingPostLimit, Math.floor(numeric)));
}

export function normalizeImageCompressionEnabled(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value === "true" || value === "1";
  return imageCompressionDefaults.enabled;
}

export function normalizeImageCompressionQuality(value: unknown) {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : imageCompressionDefaults.quality;
  if (!Number.isFinite(numeric)) {
    return imageCompressionDefaults.quality;
  }
  return Math.max(40, Math.min(95, Math.floor(numeric)));
}

export function normalizeImageCompressionMaxDimension(value: unknown) {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : imageCompressionDefaults.maxDimension;
  if (!Number.isFinite(numeric)) {
    return imageCompressionDefaults.maxDimension;
  }
  return Math.max(512, Math.min(4096, Math.floor(numeric)));
}

export async function readTenantPendingPostLimit(client: MetadataClient, tenantId: string) {
  const entry = await client.tenantMetadata.findUnique({
    where: {
      tenantId_key: {
        tenantId,
        key: pendingPostLimitMetadataKey,
      },
    },
    select: {
      value: true,
    },
  });

  return normalizePendingPostLimit(entry?.value);
}

export const botStylishMessagesEnabledKey = "bot_stylish_messages_enabled";
export const botStylishMessagesEnabledDefault = false;

export function normalizeBotStylishMessagesEnabled(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value === "true" || value === "1";
  return botStylishMessagesEnabledDefault;
}

export async function readTenantBotStylishMessagesEnabled(client: MetadataClient, tenantId: string): Promise<boolean> {
  const entry = await client.tenantMetadata.findUnique({
    where: {
      tenantId_key: {
        tenantId,
        key: botStylishMessagesEnabledKey,
      },
    },
    select: {
      value: true,
    },
  });

  return normalizeBotStylishMessagesEnabled(entry?.value);
}

export const botPrivatePostStylishEnabledKey = "bot_private_post_stylish_enabled";
export const botPrivatePostStylishEnabledDefault = false;

export function normalizeBotPrivatePostStylishEnabled(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value === "true" || value === "1";
  return botPrivatePostStylishEnabledDefault;
}

export async function readTenantBotPrivatePostStylishEnabled(client: MetadataClient, tenantId: string): Promise<boolean> {
  const entry = await client.tenantMetadata.findUnique({
    where: {
      tenantId_key: {
        tenantId,
        key: botPrivatePostStylishEnabledKey,
      },
    },
    select: {
      value: true,
    },
  });

  return normalizeBotPrivatePostStylishEnabled(entry?.value);
}

export async function readTenantImageCompression(client: MetadataClient, tenantId: string) {
  const entries = await client.tenantMetadata.findMany({
    where: {
      tenantId,
      key: {
        in: [imageCompressionEnabledKey, imageCompressionQualityKey, imageCompressionMaxDimensionKey],
      },
    },
    select: {
      key: true,
      value: true,
    },
  });

  const record = Object.fromEntries(entries.map((e) => [e.key, e.value]));

  return {
    enabled: normalizeImageCompressionEnabled(record[imageCompressionEnabledKey]),
    quality: normalizeImageCompressionQuality(record[imageCompressionQualityKey]),
    maxDimension: normalizeImageCompressionMaxDimension(record[imageCompressionMaxDimensionKey]),
  };
}

export type PublishMode = "single" | "accumulate";

export const publishModeKey = "publish_mode";
export const publishAccumulateMinImagesKey = "publish_accumulate_min_images";
export const publishAccumulateMaxImagesKey = "publish_accumulate_max_images";
export const publishAccumulateStaleMinutesKey = "publish_accumulate_stale_minutes";

export const publishModeDefaults = {
  mode: "single" as PublishMode,
  minImages: 6,
  maxImages: 9,
  staleMinutes: 30,
};

// QQ 空间单条说说图片上限约 9 张，min/max 都钳制在 1..9。
export const publishAccumulateImageHardMax = 9;

export function normalizePublishMode(value: unknown): PublishMode {
  if (value === "accumulate") return "accumulate";
  if (typeof value === "string" && value.toLowerCase() === "accumulate") return "accumulate";
  return "single";
}

function toFiniteInt(value: unknown, fallback: number): number {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : fallback;
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.floor(numeric);
}

export function normalizeAccumulateImages(min: unknown, max: unknown): { minImages: number; maxImages: number } {
  let minImages = toFiniteInt(min, publishModeDefaults.minImages);
  let maxImages = toFiniteInt(max, publishModeDefaults.maxImages);
  minImages = Math.max(1, Math.min(publishAccumulateImageHardMax, minImages));
  maxImages = Math.max(1, Math.min(publishAccumulateImageHardMax, maxImages));
  if (maxImages < minImages) {
    maxImages = minImages;
  }
  return { minImages, maxImages };
}

export function normalizeAccumulateStaleMinutes(value: unknown): number {
  const minutes = toFiniteInt(value, publishModeDefaults.staleMinutes);
  // 至少 1 分钟，最多 24 小时。
  return Math.max(1, Math.min(1440, minutes));
}

export async function readTenantPublishMode(client: MetadataClient, tenantId: string) {
  const entries = await client.tenantMetadata.findMany({
    where: {
      tenantId,
      key: {
        in: [publishModeKey, publishAccumulateMinImagesKey, publishAccumulateMaxImagesKey, publishAccumulateStaleMinutesKey],
      },
    },
    select: {
      key: true,
      value: true,
    },
  });

  const record = Object.fromEntries(entries.map((e) => [e.key, e.value]));
  const { minImages, maxImages } = normalizeAccumulateImages(record[publishAccumulateMinImagesKey], record[publishAccumulateMaxImagesKey]);

  return {
    mode: normalizePublishMode(record[publishModeKey]),
    minImages,
    maxImages,
    staleMinutes: normalizeAccumulateStaleMinutes(record[publishAccumulateStaleMinutesKey]),
  };
}

// 发布说说文字里追加一段极短 LLM 总结（≤16 字）的开关。需同时配置了 LLM 才会生效。
export const publishLlmSummaryEnabledKey = "publish_llm_summary_enabled";
export const publishLlmSummaryEnabledDefault = false;

export function normalizePublishLlmSummaryEnabled(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value === "true" || value === "1";
  return publishLlmSummaryEnabledDefault;
}

export async function readTenantPublishLlmSummaryEnabled(client: MetadataClient, tenantId: string): Promise<boolean> {
  const entry = await client.tenantMetadata.findUnique({
    where: {
      tenantId_key: {
        tenantId,
        key: publishLlmSummaryEnabledKey,
      },
    },
    select: {
      value: true,
    },
  });

  return normalizePublishLlmSummaryEnabled(entry?.value);
}
