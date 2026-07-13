import type { Prisma } from "@campux/db";
import { createHash } from "node:crypto";
import { decryptJson } from "../lib/secret-json";
import { BotWorkflowError } from "../lib/bot-workflows";

const qqBotTokenEndpoint = "https://bots.qq.com/app/getAppAccessToken";
const qqBotOpenApiBaseUrl = "https://api.sgroup.qq.com";

const qqForumTextFormat = 1;

type TokenCacheEntry = {
  accessToken: string;
  expiresAt: number;
};

const tokenCache = new Map<string, TokenCacheEntry>();

export type OfficialQqBotAccount = {
  id: string;
  officialAppId: string | null;
  officialAppSecret: Prisma.JsonValue | null;
};

export type OfficialQqForumThreadResult = {
  externalId: string;
  threadId: string | null;
  taskId: string | null;
  verbose: unknown;
};

export type OfficialQqGuild = {
  id: string;
  name: string;
  icon: string | null;
};

export type OfficialQqChannel = {
  id: string;
  guildId: string;
  name: string;
  type: number | null;
  parentId: string | null;
};

export async function listOfficialQqGuilds(bot: OfficialQqBotAccount): Promise<OfficialQqGuild[]> {
  const payload = await callOfficialQqOpenApi(bot, "/users/@me/guilds?limit=100", {
    method: "GET",
    errorPrefix: "QQ 频道列表获取失败",
  });
  return readObjectArray(payload).flatMap((item) => {
    const id = readStringField(item, ["id"]);
    const name = readStringField(item, ["name"]);
    return id && name ? [{ id, name, icon: readStringField(item, ["icon"]) }] : [];
  });
}

export async function listOfficialQqChannels(bot: OfficialQqBotAccount, guildId: string): Promise<OfficialQqChannel[]> {
  const normalizedGuildId = guildId.trim();
  if (!normalizedGuildId) throw new BotWorkflowError("QQ 频道 guild_id 为空", 400);
  const payload = await callOfficialQqOpenApi(bot, `/guilds/${encodeURIComponent(normalizedGuildId)}/channels`, {
    method: "GET",
    errorPrefix: "QQ 子频道列表获取失败",
  });
  return readObjectArray(payload).flatMap((item) => {
    const id = readStringField(item, ["id"]);
    const name = readStringField(item, ["name"]);
    if (!id || !name) return [];
    return [{
      id,
      guildId: readStringField(item, ["guild_id", "guildId"]) ?? normalizedGuildId,
      name,
      type: typeof item.type === "number" ? item.type : null,
      parentId: readStringField(item, ["parent_id", "parentId"]),
    }];
  });
}

export async function createOfficialQqForumThread(bot: OfficialQqBotAccount, channelId: string, options: { title: string; content: string }): Promise<OfficialQqForumThreadResult> {
  const title = options.title.trim();
  const content = options.content.trim();
  if (!title || !content) {
    throw new BotWorkflowError("QQ 频道帖子标题或正文为空", 400);
  }

  const normalizedChannelId = channelId.trim();
  if (!normalizedChannelId) {
    throw new BotWorkflowError("QQ 频道 ID 为空", 400);
  }

  const payload = await callOfficialQqOpenApi(bot, `/channels/${encodeURIComponent(normalizedChannelId)}/threads`, {
    method: "PUT",
    body: {
      title,
      content,
      format: qqForumTextFormat,
    },
    errorPrefix: "QQ 频道帖子发表失败",
  }) as Record<string, unknown> | null;

  const taskId = readStringField(payload, ["task_id", "taskId"]);
  const directThreadId = readStringField(payload, ["thread_id", "threadId", "id"]);
  const discoveredThreadId = directThreadId ?? await findRecentlyCreatedThreadId(bot, normalizedChannelId, { title, content });
  const externalId = discoveredThreadId ?? taskId;
  if (!externalId) {
    throw new BotWorkflowError("QQ 频道帖子发表成功但未返回帖子 ID 或任务 ID", 502);
  }

  return {
    externalId,
    threadId: discoveredThreadId,
    taskId,
    verbose: {
      create: payload,
      threadId: discoveredThreadId,
    },
  };
}

export async function deleteOfficialQqForumThread(bot: OfficialQqBotAccount, channelId: string, threadId: string) {
  const normalizedThreadId = threadId.trim();
  if (!normalizedThreadId) {
    throw new BotWorkflowError("QQ 频道帖子 ID 为空", 400);
  }
  return callOfficialQqOpenApi(bot, `/channels/${encodeURIComponent(channelId)}/threads/${encodeURIComponent(normalizedThreadId)}`, {
    method: "DELETE",
    errorPrefix: "QQ 频道帖子删除失败",
  });
}

async function callOfficialQqOpenApi(bot: OfficialQqBotAccount, path: string, options: { method: "GET" | "PUT" | "DELETE" | "POST"; body?: unknown; errorPrefix: string }) {
  if (!bot.officialAppId || !bot.officialAppSecret) {
    throw new BotWorkflowError("QQ 官方机器人 AppID 或 AppSecret 未配置", 400);
  }

  const accessToken = await getOfficialQqAccessToken(bot.officialAppId, bot.officialAppSecret);
  const response = await fetch(`${qqBotOpenApiBaseUrl}${path}`, {
    method: options.method,
    headers: {
      Authorization: `QQBot ${accessToken}`,
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const responseText = await response.text();
  if (!response.ok) {
    throw new BotWorkflowError(`${options.errorPrefix}：${response.status} ${responseText}`, 502);
  }
  if (!responseText.trim()) {
    return null;
  }
  return JSON.parse(responseText);
}

async function getOfficialQqAccessToken(appId: string, secretValue: Prisma.JsonValue) {
  const now = Date.now();
  const clientSecret = readOfficialQqAppSecret(secretValue);
  const cacheKey = `${appId}:${createHash("sha256").update(clientSecret).digest("hex")}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt - now > 60_000) {
    return cached.accessToken;
  }

  const response = await fetch(qqBotTokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ appId, clientSecret }),
  });
  const payload = await response.json().catch(() => null) as { access_token?: string; expires_in?: string | number; message?: string } | null;
  if (!response.ok || !payload?.access_token) {
    throw new BotWorkflowError(`QQ 官方机器人 AccessToken 获取失败：${response.status} ${payload?.message ?? "未知错误"}`, 502);
  }

  const expiresInSeconds = Number(payload.expires_in ?? 7200);
  tokenCache.set(cacheKey, {
    accessToken: payload.access_token,
    expiresAt: now + Math.max(60, expiresInSeconds) * 1000,
  });
  return payload.access_token;
}

function readOfficialQqAppSecret(value: Prisma.JsonValue) {
  const decrypted = decryptJson(value);
  if (typeof decrypted === "string" && decrypted.trim()) {
    return decrypted.trim();
  }
  if (decrypted && typeof decrypted === "object" && !Array.isArray(decrypted)) {
    const secret = (decrypted as Record<string, unknown>).appSecret;
    if (typeof secret === "string" && secret.trim()) {
      return secret.trim();
    }
  }
  throw new BotWorkflowError("QQ 官方机器人 AppSecret 无法解析", 500);
}

async function findRecentlyCreatedThreadId(bot: OfficialQqBotAccount, channelId: string, expected: { title: string; content: string }) {
  const payload = await callOfficialQqOpenApi(bot, `/channels/${encodeURIComponent(channelId)}/threads`, {
    method: "GET",
    errorPrefix: "QQ 频道帖子列表获取失败",
  }).catch(() => null);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const threads = (payload as Record<string, unknown>).threads;
  if (!Array.isArray(threads)) {
    return null;
  }
  for (const thread of threads) {
    const info = readThreadInfo(thread);
    if (!info) continue;
    if (info.title === expected.title && threadContentIncludes(info.content, expected.content)) {
      return info.threadId;
    }
  }
  return null;
}

function readThreadInfo(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const threadInfo = record.thread_info ?? record.threadInfo;
  if (!threadInfo || typeof threadInfo !== "object" || Array.isArray(threadInfo)) {
    return null;
  }
  const info = threadInfo as Record<string, unknown>;
  const threadId = readStringField(info, ["thread_id", "threadId", "id"]);
  const title = readStringField(info, ["title"]);
  const content = readStringField(info, ["content"]);
  if (!threadId || !title || !content) {
    return null;
  }
  return { threadId, title, content };
}

function threadContentIncludes(rawContent: string, expectedContent: string) {
  if (rawContent.includes(expectedContent)) {
    return true;
  }
  try {
    const parsed = JSON.parse(rawContent) as unknown;
    return extractForumText(parsed).includes(expectedContent);
  } catch {
    return false;
  }
}

function extractForumText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(extractForumText).join("");
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.values(record).map(extractForumText).join("");
  }
  return "";
}

function readStringField(value: unknown, fieldNames: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  for (const fieldName of fieldNames) {
    const fieldValue = record[fieldName];
    if (typeof fieldValue === "string" && fieldValue.trim()) {
      return fieldValue.trim();
    }
  }
  return null;
}

function readObjectArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
}
