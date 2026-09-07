import type { Prisma } from "@campux/db";
import { createHash } from "node:crypto";
import { decryptJson } from "../lib/secret-json";
import { BotWorkflowError } from "../lib/bot-workflows";

const qqBotTokenEndpoint = "https://bots.qq.com/app/getAppAccessToken";
const qqBotOpenApiBaseUrl = "https://api.sgroup.qq.com";

const qqForumRichTextFormat = 4;
const qqForumChannelType = 10007;

// 发帖后轮询论坛列表确认新帖子真正出现并拿到 thread_id 的次数与间隔（毫秒）。
// PUT /channels/{channel_id}/threads 只返回 task_id，帖子创建是异步任务；
// 若连续多次都查不到刚发的帖子，说明帖子可能未公开落地（如机器人非私域/未移除重加），
// 应如实标记为“结果未知”而非误报成功。
const qqForumThreadConfirmAttempts = 3;
const qqForumThreadConfirmIntervalMs = 1500;

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
  verbose: OfficialQqForumThreadVerbose;
};

export type OfficialQqForumThreadVerbose = {
  mode: "official-qq-forum";
  appId: string | null;
  channelId: string;
  title: string;
  contentLength: number;
  imageCount: number;
  threadId: string | null;
  taskId: string | null;
  externalId: string;
  publishedAt: string;
  create: Record<string, unknown> | null;
};

export class OfficialQqPublishOutcomeUnknownError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "OfficialQqPublishOutcomeUnknownError";
  }
}


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
    if (!id || !name || item.type !== qqForumChannelType) return [];
    return [{
      id,
      guildId: readStringField(item, ["guild_id", "guildId"]) ?? normalizedGuildId,
      name,
      type: typeof item.type === "number" ? item.type : null,
      parentId: readStringField(item, ["parent_id", "parentId"]),
    }];
  });
}

export async function createOfficialQqForumThread(bot: OfficialQqBotAccount, channelId: string, options: { title: string; content: string; imageUrls?: string[]; matchDisplayIds?: number[] }): Promise<OfficialQqForumThreadResult> {
  const title = options.title.trim();
  const content = options.content.trim();
  if (!title || !content) {
    throw new BotWorkflowError("QQ 频道帖子标题或正文为空", 400);
  }

  const normalizedChannelId = channelId.trim();
  if (!normalizedChannelId) {
    throw new BotWorkflowError("QQ 频道 ID 为空", 400);
  }

  const officialAppId = bot.officialAppId;
  const officialAppSecret = bot.officialAppSecret;
  if (!officialAppId || !officialAppSecret) {
    throw new BotWorkflowError("QQ 官方机器人 AppID 或 AppSecret 未配置", 400);
  }
  const accessToken = await getOfficialQqAccessToken(officialAppId, officialAppSecret);
  const findExistingThread = (matchMode: "exact-title" | "any-display-id") => findRecentlyCreatedThreadId(bot, normalizedChannelId, {
    title,
    content,
    ...(options.matchDisplayIds ? { displayIds: options.matchDisplayIds } : {}),
    matchMode,
  }, accessToken);
  // 发帖后轮询确认新帖子真正出现在论坛列表中，返回其 thread_id；多次都查不到返回 null。
  // 帖子创建是异步的，给小延迟重试，避免刚发布尚未进列表就误判为失败。
  const confirmThreadVisible = async (matchMode: "exact-title" | "any-display-id") => {
    for (let attempt = 0; attempt < qqForumThreadConfirmAttempts; attempt += 1) {
      const existingThreadId = await findExistingThread(matchMode);
      if (existingThreadId) {
        return existingThreadId;
      }
      if (attempt < qqForumThreadConfirmAttempts - 1) {
        await sleep(qqForumThreadConfirmIntervalMs);
      }
    }
    return null;
  };
  if (options.matchDisplayIds?.length) {
    const existingThreadId = await findExistingThread("exact-title");
    if (existingThreadId) {
      return buildOfficialQqForumThreadResult(
        bot,
        normalizedChannelId,
        title,
        content,
        options.imageUrls,
        null,
        existingThreadId,
        null,
      );
    }
  }

  let payload: Record<string, unknown> | null;
  try {
    payload = await callOfficialQqOpenApi(bot, `/channels/${encodeURIComponent(normalizedChannelId)}/threads`, {
      method: "PUT",
      body: {
        title,
        content: serializeOfficialQqForumRichText(content, options.imageUrls),
        format: qqForumRichTextFormat,
      },
      errorPrefix: "QQ 频道帖子发表失败",
      accessToken,
    }) as Record<string, unknown> | null;
  } catch (error) {
    if (error instanceof BotWorkflowError) {
      throw error;
    }
    // 创建请求传输结果不明（网络失败等）：帖子可能已经发出，也可能没有。
    // 轮询确认是否真的出现在论坛列表，收敛到确定结果，避免自动重发导致重复帖子。
    const discoveredThreadId = await confirmThreadVisible("exact-title");
    if (discoveredThreadId) {
      return buildOfficialQqForumThreadResult(
        bot,
        normalizedChannelId,
        title,
        content,
        options.imageUrls,
        null,
        discoveredThreadId,
        null,
      );
    }
    throw new OfficialQqPublishOutcomeUnknownError("QQ 频道帖子创建请求结果不确定；为避免重复发布未自动重试", error);
  }

  const taskId = readStringField(payload, ["task_id", "taskId"]);
  const directThreadId = readOfficialQqForumThreadId(payload);
  // 优先用返回里带出的 thread_id；否则轮询列表确认刚发的帖子真正公开可见。
  // 如果确认不到 thread_id（只有 task_id），说明帖子可能未真正落地（如机器人非私域、
  // 私域权限未在“移除并重新添加”后生效、应用未上线等），应如实标记为结果未知而非误报成功，
  // 这样才能在管理端暴露“频道上发的内容看不到”的问题。
  const discoveredThreadId = directThreadId ?? await confirmThreadVisible(
    options.matchDisplayIds?.length === 1 ? "any-display-id" : "exact-title",
  );
  if (!discoveredThreadId) {
    throw new OfficialQqPublishOutcomeUnknownError(
      taskId
        ? "QQ 频道帖子发表后未能在论坛列表确认到对应帖子；帖子可能未公开可见（请确认机器人是私域机器人、已在频道“移除后重新添加”、且应用已上线）。为规避重复发布未自动重试。"
        : "QQ 频道帖子发表后未能确认帖子 ID；为避免重复发布未自动重试",
    );
  }

  return buildOfficialQqForumThreadResult(
    bot,
    normalizedChannelId,
    title,
    content,
    options.imageUrls,
    payload,
    discoveredThreadId,
    taskId,
  );
}

function buildOfficialQqForumThreadResult(
  bot: OfficialQqBotAccount,
  channelId: string,
  title: string,
  content: string,
  imageUrls: string[] | undefined,
  payload: Record<string, unknown> | null,
  threadId: string | null,
  taskId: string | null,
): OfficialQqForumThreadResult {
  const externalId = threadId ?? taskId;
  if (!externalId) {
    throw new OfficialQqPublishOutcomeUnknownError("QQ 频道帖子发表后未能确认帖子 ID；为避免重复发布未自动重试");
  }
  return {
    externalId,
    threadId,
    taskId,
    verbose: {
      mode: "official-qq-forum",
      appId: bot.officialAppId,
      channelId,
      title,
      contentLength: content.length,
      imageCount: imageUrls?.length ?? 0,
      externalId,
      create: payload,
      threadId,
      taskId,
      publishedAt: new Date().toISOString(),
    },
  };
}

export function serializeOfficialQqForumRichText(content: string, imageUrls: string[] = []) {
  return JSON.stringify({
    paragraphs: [
      ...content.replace(/\r\n?/g, "\n").split("\n").map((line) => ({
        elems: line ? [{ type: 1, text: { text: line } }] : [],
        props: {},
      })),
      ...imageUrls.map((url) => ({
        elems: [{ type: 2, image: { third_url: url, width_percent: 1 } }],
        props: {},
      })),
    ],
  });
}

export async function deleteOfficialQqForumThread(bot: OfficialQqBotAccount, channelId: string, threadId: string) {
  const normalizedChannelId = channelId.trim();
  if (!normalizedChannelId) {
    throw new BotWorkflowError("QQ 频道 ID 为空", 400);
  }
  const normalizedThreadId = threadId.trim();
  if (!normalizedThreadId) {
    throw new BotWorkflowError("QQ 频道帖子 ID 为空", 400);
  }
  return callOfficialQqOpenApi(bot, `/channels/${encodeURIComponent(normalizedChannelId)}/threads/${encodeURIComponent(normalizedThreadId)}`, {
    method: "DELETE",
    errorPrefix: "QQ 频道帖子删除失败",
  });
}

export async function findOfficialQqForumThreadIdByDisplayIds(bot: OfficialQqBotAccount, channelId: string, displayIds: number[]) {
  const normalizedChannelId = channelId.trim();
  if (!normalizedChannelId) {
    throw new BotWorkflowError("QQ 频道 ID 为空", 400);
  }
  return findRecentlyCreatedThreadId(bot, normalizedChannelId, {
    title: "",
    content: "",
    displayIds,
  });
}

export function readOfficialQqForumThreadId(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const direct = readStringField(value, ["thread_id", "threadId"]);
  if (direct) {
    return direct;
  }
  const record = value as Record<string, unknown>;
  for (const fieldName of ["thread_info", "threadInfo", "thread", "data", "result", "create"]) {
    const nested = record[fieldName];
    const nestedThreadId = readOfficialQqForumThreadId(nested);
    if (nestedThreadId) {
      return nestedThreadId;
    }
  }
  return null;
}

async function callOfficialQqOpenApi(bot: OfficialQqBotAccount, path: string, options: { method: "GET" | "PUT" | "DELETE" | "POST"; body?: unknown; errorPrefix: string; accessToken?: string }) {
  let accessToken = options.accessToken;
  if (!accessToken) {
    const officialAppId = bot.officialAppId;
    const officialAppSecret = bot.officialAppSecret;
    if (!officialAppId || !officialAppSecret) {
      throw new BotWorkflowError("QQ 官方机器人 AppID 或 AppSecret 未配置", 400);
    }
    accessToken = await getOfficialQqAccessToken(officialAppId, officialAppSecret);
  }

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

async function findRecentlyCreatedThreadId(
  bot: OfficialQqBotAccount,
  channelId: string,
  expected: {
    title: string;
    content: string;
    displayIds?: number[];
    matchMode?: "exact-title" | "any-display-id";
  },
  accessToken?: string,
) {
  const payload = await callOfficialQqOpenApi(bot, `/channels/${encodeURIComponent(channelId)}/threads`, {
    method: "GET",
    errorPrefix: "QQ 频道帖子列表获取失败",
    ...(accessToken ? { accessToken } : {}),
  }).catch(() => null);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const threads = (payload as Record<string, unknown>).threads;
  if (!Array.isArray(threads)) {
    return null;
  }
  const expectedDisplayIds = new Set((expected.displayIds ?? []).map((displayId) => `#${displayId}`));
  for (const thread of threads) {
    const info = readThreadInfo(thread);
    if (!info) continue;
    if (expected.title && info.title === expected.title) {
      return info.threadId;
    }
    if (expected.matchMode === "exact-title") {
      continue;
    }
    for (const displayId of expectedDisplayIds) {
      if (threadMatchesDisplayId(info, displayId)) {
        return info.threadId;
      }
    }
    if (expected.content && threadContentIncludes(info.content, expected.content)) {
      return info.threadId;
    }
  }
  return null;
}

function threadMatchesDisplayId(info: { title: string; content: string }, displayId: string) {
  return info.title.includes(displayId) || threadContentIncludes(info.content, displayId);
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
    if (Array.isArray(record.paragraphs)) {
      return record.paragraphs.map(extractForumText).join("\n");
    }
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

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
