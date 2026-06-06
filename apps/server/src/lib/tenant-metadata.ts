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
