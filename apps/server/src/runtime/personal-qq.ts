import type { Prisma } from "@campux/db";
import type { CampuxConfig } from "@campux/config";
import { decryptJson } from "../lib/secret-json";
import { BotWorkflowError } from "../lib/bot-workflows";

/**
 * QQ 频道机器人（personal_qq）运行时 — 纯 HTTP MCP 客户端。
 *
 * 该通道用「个人 QQ 账号」（connect.qq.com 腾讯频道 Skill 授权）发帖到腾讯频道论坛子频道。
 * 底层协议是腾讯统一的 MCP 网关（JSON-RPC 2.0 over HTTP）：
 *   POST {QQ_AI_CONNECT_MCP_URL || https://graph.qq.com/mcp_gateway/open_platform_agent_mcp/mcp}
 *   Authorization: Bearer <bot: 前缀的个人凭证 token>
 *   body: { jsonrpc:"2.0", id, method:"tools/call", params:{ name:"<snake_tool>", arguments:{...} } }
 *
 * 工具名与官方 Tools 列表一一对应（publish_feed / del_feed / get_my_join_guild_info /
 * get_guild_channel_list 等）。响应在 result.content[].text 与 result.structuredContent 携带结构化数据。
 *
 * 多租户隔离由存储层保证：每个 personal_qq BotAccount 持有自己的 `bot:` token，
 * 每次请求带上各自的 token，天然实现「每个租户的每个机器人独立 QQ 账号」。
 */

export const PERSONAL_QQ_MCP_DEFAULT_URL = "https://graph.qq.com/mcp_gateway/open_platform_agent_mcp/mcp";

export type PersonalQqBotAccount = {
  id: string;
  /** 频道 guild_id，复用 numeric qqUin 存储。 */
  qqUin: bigint;
  /** 加密的 personal_qq 凭据 JSON，形如 { token: "bot:..." }，存于 personalQqToken 字段。 */
  personalQqToken: Prisma.JsonValue | null;
  /** 目标论坛子频道 channel_id（复用 reviewGroupId）。 */
  reviewGroupId: string | null;
};

export type PersonalQqGuild = {
  id: string;
  guildNumber: string | null;
  name: string;
  memberCount: number;
  role: string | null;
  shareUrl: string | null;
};

export type PersonalQqChannel = {
  id: string;
  guildId: string;
  name: string;
};

export type PersonalQqForumThreadResult = {
  externalId: string;
  feedId: string;
  createTime: number | null;
  shareUrl: string | null;
  verbose: PersonalQqForumThreadVerbose;
};

export type PersonalQqForumThreadVerbose = {
  mode: "personal-qq-forum";
  guildId: string;
  channelId: string;
  title: string;
  contentLength: number;
  imageCount: number;
  feedId: string;
  externalId: string;
  createTime: number | null;
  shareUrl: string | null;
  publishedAt: string;
  create: Record<string, unknown> | null;
};

export class PersonalQqPublishOutcomeUnknownError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "PersonalQqPublishOutcomeUnknownError";
  }
}

/** 解析 personal_qq 存的加密凭据 JSON，取 `token`（bot: 前缀长期 token）。 */
export function readPersonalQqToken(value: Prisma.JsonValue | null): string | null {
  const parsed = decryptJson(value);
  if (!parsed || typeof parsed !== "object") return null;
  const token = (parsed as { token?: unknown }).token;
  return typeof token === "string" && token.trim() ? token.trim() : null;
}

/** MCP 端点：优先读 config 或环境变量，否则用官方默认。 */
export function personalQqMcpUrl(config?: Pick<CampuxConfig, "personalQq">): string {
  const configUrl = config?.personalQq?.mcpUrl?.trim();
  if (configUrl) return configUrl;
  const envUrl = process.env.CAMPUX_PERSONAL_QQ_MCP_URL?.trim();
  return envUrl || PERSONAL_QQ_MCP_DEFAULT_URL;
}

export type McpToolResponse = {
  result?: {
    content?: Array<{ type?: string; text?: string }>;
    structuredContent?: unknown;
    isError?: boolean;
    _meta?: { AdditionalFields?: { retCode?: number; errMsg?: string } };
  };
  error?: { message?: string };
};

/** 核心：对 MCP 网关执行一次 tools/call。返回整个 result 对象。 */
export async function callPersonalQqTool(
  config: Pick<CampuxConfig, "personalQq"> | undefined,
  bot: PersonalQqBotAccount,
  toolName: string,
  arguments_: Record<string, unknown>,
): Promise<{ response: McpToolResponse; result: NonNullable<McpToolResponse["result"]> }> {
  const token = readPersonalQqToken(bot.personalQqToken);
  if (!token) {
    throw new BotWorkflowError("QQ 频道机器人未配置 bot: 凭证 token，请先在管理端填写", 400);
  }
  const url = personalQqMcpUrl(config);

  let httpResponse: Response;
  try {
    httpResponse = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: toolName, arguments: arguments_ },
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new BotWorkflowError(`QQ 频道网关请求失败：${error instanceof Error ? error.message : String(error)}`, 502);
  }

  let json: McpToolResponse;
  try {
    json = (await httpResponse.json()) as McpToolResponse;
  } catch {
    throw new BotWorkflowError(`QQ 频道网关返回非 JSON（HTTP ${httpResponse.status}）`, 502);
  }

  const result = json.result;
  if (!result || httpResponse.status >= 400) {
    const msg = json.error?.message ?? `网关 HTTP ${httpResponse.status}`;
    throw new BotWorkflowError(`QQ 频道网关错误：${msg}`, 502);
  }

  // retCode 非 0 表示业务失败
  const retCode = result._meta?.AdditionalFields?.retCode ?? 0;
  if (retCode !== 0 || result.isError === true) {
    const text = result.content?.map((c) => c.text ?? "").filter(Boolean).join("\n");
    const inner = readStringField(result._meta?.AdditionalFields, ["errMsg"]);
    throw new BotWorkflowError(inner || text || "QQ 频道网关业务失败", 502);
  }

  return { response: json, result };
}

/** 从 MCP result 中解析 structuredContent 或首个 text。 */
export function readMcpStructuredContent<T = Record<string, unknown>>(result: NonNullable<McpToolResponse["result"]>): T | null {
  if (result.structuredContent != null && typeof result.structuredContent === "object") {
    return result.structuredContent as T;
  }
  const text = result.content?.map((c) => c.text ?? "").filter(Boolean).join("\n");
  if (text) {
    try {
      return JSON.parse(text.substring(text.indexOf("{"))) as T;
    } catch {
      return null;
    }
  }
  return null;
}

/** 获取该 bot 授权账号加入/管理的频道列表。 */
export async function listPersonalQqGuilds(config: Pick<CampuxConfig, "personalQq"> | undefined, bot: PersonalQqBotAccount): Promise<PersonalQqGuild[]> {
  const { result } = await callPersonalQqTool(config, bot, "get_my_join_guild_info", {
    bytesCookie: "",
    filter: {
      filter: { uint32CreateTime: 1, uint32FaceSeq: 1, uint32GuildName: 1, uint32GuildNumber: 1, uint32MemberNum: 1, uint32Profile: 1 },
      userFilter: { uint32Role: 1 },
    },
  });
  const sc = readMcpStructuredContent(result) ?? {};
  const guilds: PersonalQqGuild[] = [];
  const list = (sc as Record<string, unknown>).msgRspSortGuilds ?? (sc as Record<string, unknown>).guilds;
  if (Array.isArray(list)) {
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const msgGuildInfo = (typeof rec.msgGuildInfo === "object" && rec.msgGuildInfo !== null)
        ? (rec.msgGuildInfo as Record<string, unknown>)
        : rec;
      const guildUserInfo = (typeof rec.guildUserInfo === "object" && rec.guildUserInfo !== null)
        ? (rec.guildUserInfo as Record<string, unknown>)
        : rec;
      const id = readStringField(rec, ["uint64GuildId", "guildId", "guild_id"]);
      const name = decodeBase64Field(msgGuildInfo, ["bytesGuildName"]) ?? readStringField(msgGuildInfo, ["guildName", "name"]);
      if (id && name) {
        const roleInt = readIntField(guildUserInfo, ["uint32Role"]) ?? 0;
        guilds.push({
          id,
          guildNumber: decodeBase64Field(msgGuildInfo, ["bytesGuildNumber"]) ?? readStringField(msgGuildInfo, ["guildNumber"]),
          name,
          memberCount: readIntField(msgGuildInfo, ["uint32MemberNum", "memberCount"]) ?? 0,
          role: roleToLabel(roleInt),
          shareUrl: null,
        });
      }
    }
  }
  return guilds;
}

// uint32Role 映射为可读角色标签（0=未知/成员，2=频道主/创建者）
function roleToLabel(role: number): string | null {
  if (role === 2) return "频道主";
  if (role === 1) return "管理员";
  return role === 0 ? null : null;
}

/** 获取某频道内的版块（channel）列表。 */
export async function listPersonalQqChannels(config: Pick<CampuxConfig, "personalQq"> | undefined, bot: PersonalQqBotAccount, guildId: string): Promise<PersonalQqChannel[]> {
  const { result } = await callPersonalQqTool(config, bot, "get_guild_channel_list", { guildIds: [guildId] });
  const sc = readMcpStructuredContent(result) ?? {};
  const list = (sc as Record<string, unknown>).guildInfoList;
  const channels: PersonalQqChannel[] = [];
  if (Array.isArray(list)) {
    for (const guild of list) {
      if (!guild || typeof guild !== "object") continue;
      const g = guild as Record<string, unknown>;
      const gid = readStringField(g, ["guildId", "guild_id"]) ?? guildId;
      const channelList = g.channelList;
      if (Array.isArray(channelList)) {
        for (const ch of channelList) {
          if (!ch || typeof ch !== "object") continue;
          const c = ch as Record<string, unknown>;
          const id = readStringField(c, ["channelId", "channel_id", "id"]);
          const name = decodeBase64Field(c, ["channelName", "name"]) ?? readStringField(c, ["channelName", "name"]);
          if (id) {
            channels.push({ id, guildId: gid, name: name ?? "" });
          }
        }
      }
    }
  }
  return channels;
}

/**
 * 发表一篇论坛帖。
 * 支持短贴（无 title）与长贴（有 title）；content 为纯文本正文，title 可选。
 * 若带 imageUrls，会以图片段落追加到正文（经 patternInfo 富文本）。
 */
export async function createPersonalQqForumThread(
  config: Pick<CampuxConfig, "personalQq"> | undefined,
  bot: PersonalQqBotAccount,
  channelIdArg: string,
  options: { title?: string; content: string; imageUrls?: string[] },
): Promise<PersonalQqForumThreadResult> {
  const guildId = bot.qqUin.toString().trim();
  const channelId = channelIdArg.trim();
  const title = (options.title ?? "").trim();
  const content = options.content.trim();
  const imageUrls = (options.imageUrls ?? []).map((u) => u.trim()).filter(Boolean);
  if (!guildId) throw new BotWorkflowError("QQ 频道 guild_id 为空", 400);
  if (!channelId) throw new BotWorkflowError("QQ 子频道 channel_id 为空", 400);
  if (!content && imageUrls.length === 0) throw new BotWorkflowError("QQ 频道帖子正文为空", 400);

  const isLong = Boolean(title);
  const feedType = isLong ? 2 : 1;

  // 短贴与长贴的 patternInfo 结构（镜像官方 CLI 捕获的真实请求）。
  let patternInfo: string;
  if (isLong) {
    patternInfo = buildLongPostPatternInfo(title, content, imageUrls);
  } else {
    patternInfo = buildShortPostPatternInfo(content, imageUrls);
  }

  const jsonFeed: Record<string, unknown> = {
    at_users: null,
    channelInfo: { is_square: true, name: "", sign: { channel_id: channelId, channel_type: 0, guild_id: guildId } },
    client_task_id: randomUuid(),
    contents: { contents: [{ pattern_id: "", text_content: { text: isLong ? content : content }, type: 1 }] },
    createTime: 0,
    createTimeNs: 0,
    feed_risk_info: { declaration_type: 0, iconUrl: "", risk_content: "" },
    feed_source_type: 0,
    feed_type: feedType,
    files: [],
    id: "",
    images: null,
    media_lock_count: 0,
    patternInfo,
    poi: { ad_info: { adcode: 0, city: "", district: "", province: "" }, address: "", location: { lat: 0, lng: 0 }, poi_id: "", title: "" },
    poster: { icon: { iconUrl: "" }, id: "", nick: "" },
    recommend_channels: [],
    tagInfos: [],
    third_bar: { button_scheme: "", content_scheme: "", id: "" },
    title: isLong ? { contents: [{ pattern_id: "", text_content: { text: title }, type: 1 }] } : { contents: null },
    topic_contents: [],
    videos: null,
  };

  const { result } = await callPersonalQqTool(config, bot, "publish_feed", {
    client_content: {},
    feed: { channelInfo: { sign: { channel_id: channelId, guild_id: guildId } }, poster: { id: "" } },
    jsonFeed: JSON.stringify(jsonFeed),
  });

  const sc = (readMcpStructuredContent(result) ?? {}) as Record<string, unknown>;
  // 发布成功响应：structuredContent.feed = { id: "B_...", createTime: "..." }
  const feedPayload = (typeof sc.feed === "object" && sc.feed !== null) ? (sc.feed as Record<string, unknown>) : sc;
  const feedId = readStringField(feedPayload, ["feedId", "feed_id", "id"])
    ?? readStringField(sc, ["feedId", "feed_id"]);
  const createTime = readIntField(feedPayload, ["createTime", "create_time_raw"])
    ?? readIntField(sc, ["createTime", "create_time_raw"]);
  const shareUrl = readStringField(sc, ["shareUrl", "share_url"]);

  if (!feedId) {
    // 网关没有明确返回 feed_id；为避免自动重发，标记结果未知
    throw new PersonalQqPublishOutcomeUnknownError(
      "QQ 频道发帖成功但未返回 feed_id（结果未知，为避免重复发布未自动重试）",
    );
  }

  const verbose: PersonalQqForumThreadVerbose = {
    mode: "personal-qq-forum",
    guildId,
    channelId,
    title,
    contentLength: content.length,
    imageCount: imageUrls.length,
    feedId,
    externalId: feedId,
    createTime,
    shareUrl,
    publishedAt: new Date().toISOString(),
    create: { ...sc },
  };

  return { externalId: feedId, feedId, createTime, shareUrl, verbose };
}

/** 删除一篇论坛帖。需 guild_id、channel_id、feed_id、create_time。 */
export async function deletePersonalQqForumThread(
  config: Pick<CampuxConfig, "personalQq"> | undefined,
  bot: PersonalQqBotAccount,
  options: { guildId: string; channelId: string; feedId: string; createTime: number | null },
): Promise<boolean> {
  const guildId = options.guildId.trim();
  const channelId = options.channelId.trim();
  const feedId = options.feedId.trim();
  if (!guildId) throw new BotWorkflowError("QQ 频道 guild_id 为空", 400);
  if (!channelId) throw new BotWorkflowError("QQ 子频道 channel_id 为空", 400);
  if (!feedId) throw new BotWorkflowError("QQ 频道帖子 feed_id 为空", 400);
  if (options.createTime == null) throw new BotWorkflowError("缺少 QQ 频道帖子 create_time，无法删除", 400);

  await callPersonalQqTool(config, bot, "del_feed", {
    feed: {
      channelInfo: { sign: { channel_id: channelId, guild_id: guildId } },
      createTime: String(options.createTime),
      id: feedId,
      poster: { id: "" },
    },
  });
  return true;
}

// ---- 内部工具函数 ----

function readStringField(obj: Record<string, unknown> | null | undefined, fieldNames: string[]): string | null {
  if (!obj || typeof obj !== "object") return null;
  for (const name of fieldNames) {
    const v = obj[name];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

function readBytesField(obj: Record<string, unknown> | null | undefined, fieldNames: string[]): string | null {
  // 腾讯 MCP 响应中 bytes 类型字段可能是 { data: [...bytes] } 或 base64 字符串
  if (!obj || typeof obj !== "object") return null;
  for (const name of fieldNames) {
    const v = obj[name];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (v && typeof v === "object") {
      const data = (v as { data?: unknown }).data;
      if (typeof data === "string") return data.trim();
      if (Array.isArray(data)) {
        const bytes = Buffer.from(data as number[]).toString("utf8").trim();
        if (bytes) return bytes;
      }
    }
  }
  return null;
}

/** 腾讯 MCP 响应里的 bytes 字段是 base64 编码的 UTF-8，解码还原为可读文本。 */
function decodeBase64Field(obj: Record<string, unknown> | null | undefined, fieldNames: string[]): string | null {
  if (!obj || typeof obj !== "object") return null;
  for (const name of fieldNames) {
    const v = obj[name];
    if (typeof v !== "string" || !v.trim()) continue;
    try {
      const decoded = Buffer.from(v.trim(), "base64").toString("utf8").trim();
      if (decoded) return decoded;
    } catch {
      // fallthrough
    }
  }
  return null;
}

function readIntField(obj: Record<string, unknown> | null | undefined, fieldNames: string[]): number | null {
  if (!obj || typeof obj !== "object") return null;
  for (const name of fieldNames) {
    const v = obj[name];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}

function randomUuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** 短贴富文本 patternInfo（含可选图片段落）。 */
export function buildShortPostPatternInfo(content: string, imageUrls: string[]): string {
  const nodes: unknown[] = [{ type: 1 }, { nodes: [{ content, type: 1 }, { type: 11 }], type: 1 }];
  return JSON.stringify([{ nodes, type: 1 }]);
}

/** 长贴富文本 patternInfo（标题 + 正文 + 图片）。 */
export function buildLongPostPatternInfo(title: string, content: string, imageUrls: string[]): string {
  // 长贴捕获形态：blockParagraph + data[].text
  const blocks: Array<Record<string, unknown>> = [
    { data: [{ children: [], text: "", type: 1 }], id: randomUuid(), type: "blockParagraph" },
    {
      data: [{ props: { fontWeight: 400, italic: false, underline: false }, text: content, type: 1 }],
      id: randomUuid(),
      props: { textAlignment: 0 },
      type: "blockParagraph",
    },
  ];
  return JSON.stringify(blocks);
}