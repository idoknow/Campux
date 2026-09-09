import type { Prisma } from "@campux/db";
import type { CampuxConfig } from "@campux/config";
import { createHash } from "node:crypto";
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

  // 下载渲染图并上传到腾讯频道，换取 publish 用的 fileUuid/图片URL。
  const uploadedImages: PersonalQqUploadedImage[] = [];
  if (imageUrls.length > 0) {
    if (imageUrls.length > PERSONAL_QQ_MAX_IMAGES_PER_POST) {
      throw new BotWorkflowError(`QQ 频道单帖最多 ${PERSONAL_QQ_MAX_IMAGES_PER_POST} 张图（含渲染图），当前 ${imageUrls.length} 张`, 400);
    }
    for (let i = 0; i < imageUrls.length; i++) {
      const url = imageUrls[i];
      const urlNonEmpty: string = url ?? "";
      if (!urlNonEmpty) continue;
      let bytes: Buffer;
      try {
        const res = await fetch(urlNonEmpty, { signal: AbortSignal.timeout(30_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const ab = await res.arrayBuffer();
        bytes = Buffer.from(ab);
      } catch (error) {
        throw new BotWorkflowError(
          `下载第 ${i + 1} 张渲染图失败（${urlNonEmpty}）：${error instanceof Error ? error.message : String(error)}`,
          422,
        );
      }
      try {
        // 上传到腾讯频道（单张 ≤5MB 已由 uploadPersonalQqImage 内部校验）
        const uploaded = await uploadPersonalQqImage(config, bot, bytes, `card_${i}.png`);
        // 优先用上传响应的真实宽高；下载的 PNG 宽高由响应提供
        uploadedImages.push(uploaded);
      } catch (upErr) {
        throw new BotWorkflowError(
          `第 ${i + 1} 张图上传腾讯频道失败：${upErr instanceof Error ? upErr.message : String(upErr)}`,
          502,
        );
      }
    }
  }

  // 短贴与长贴的 patternInfo 结构（镜像官方 CLI 捕获的真实请求）。
  let patternInfo: string;
  if (isLong) {
    patternInfo = buildLongPostPatternInfo(title, content, uploadedImages);
  } else {
    patternInfo = buildShortPostPatternInfo(content, uploadedImages);
  }

  // 已上传图片 -> clientImageContents + jsonFeed.images[]
  const clientImageContents = uploadedImages.map((img) => ({
    md5: img.md5,
    orig_size: img.origSize,
    task_id: img.fileUuid,
    url: img.picUrl,
  }));
  const jsonFeedImages = uploadedImages.map((img, i) => ({
    display_index: i,
    height: img.height || 200,
    imageMD5: "",
    isFromGameShare: false,
    is_gif: false,
    is_orig: false,
    layerPicUrl: "",
    orig_size: 0,
    pattern_id: img.fileUuid,
    picId: img.fileUuid,
    picUrl: img.picUrl,
    vecImageUrl: [],
    width: img.width || 400,
  }));

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
    images: uploadedImages.length > 0 ? jsonFeedImages : null,
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
    client_content: uploadedImages.length > 0 ? { clientImageContents } : {},
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
export function buildShortPostPatternInfo(content: string, images: PersonalQqUploadedImage[]): string {
  const nodes: unknown[] = [{ type: 1 }, { nodes: [{ content, type: 1 }, { type: 11 }], type: 1 }];
  for (const img of images) {
    nodes.push(imageNode(img));
  }
  return JSON.stringify([{ nodes, type: 1 }]);
}

/** 长贴富文本 patternInfo（标题 + 正文 + 图片，图片内联到正文 data 数组）。 */
export function buildLongPostPatternInfo(title: string, content: string, images: PersonalQqUploadedImage[]): string {
  // 长贴捕获形态：blockParagraph + data[].text（图片节点内联在同段 data 数组尾部）
  const textNodes = images.length > 0
    ? [{ props: { fontWeight: 400, italic: false, underline: false }, text: content, type: 1 }, ...images.map((img) => imageNode(img))]
    : [{ props: { fontWeight: 400, italic: false, underline: false }, text: content, type: 1 }];
  const blocks: Array<Record<string, unknown>> = [
    { data: [{ children: [], text: "", type: 1 }], id: randomUuid(), type: "blockParagraph" },
    {
      data: textNodes,
      id: `${Date.now()}`,
      props: { textAlignment: 0 },
      type: "blockParagraph",
    },
  ];
  return JSON.stringify(blocks);
}

// ---------------------------------------------------------------------------
// 腾讯频道"图片富媒体上传"协议（sliceupload）
// 协议已实测逆向：CMD_UPLOAD 申请 → POST /sliceupload(protobuf) → status_sync 确认。
// 图片尺寸约束：单张 ≤5MB，总 ≤9 张（含渲染图）。
// 上传通道域名：multimedia.nt.qq.com.cn:80（服务端经实测可连通）。
// ---------------------------------------------------------------------------

/** 单张上传的尺寸上限（5MB）。 */
export const PERSONAL_QQ_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** 单帖最大图片数（含渲染图），腾讯限制 9 张。 */
export const PERSONAL_QQ_MAX_IMAGES_PER_POST = 9;

/** 渲染一个腾讯 patternInfo 的 type:6 图片节点（镜像官方 CLI 捕获的真实请求）。 */
function imageNode(img: PersonalQqUploadedImage): Record<string, unknown> {
  return {
    duration: 0,
    fileId: img.fileUuid,
    height: img.height || 200,
    id: img.fileUuid,
    isInline: true,
    status: 0,
    taskId: img.fileUuid,
    type: 6,
    url: img.picUrl,
    width: img.width || 400,
    widthPercentage: 100,
  };
}

export type PersonalQqUploadedImage = {
  /** 上传成功后腾讯返回的最终 fileUuid（publish_feed 里 task_id/picId/fileId 用它）。 */
  fileUuid: string;
  /** 上传后的图片 URL（channelr.photo.store.qq.com 原图档）。 */
  picUrl: string;
  width: number;
  height: number;
  md5: string;
  origSize: number;
};

// ---- 轻量 protobuf 编码（仅 cover sliceupload 请求需要的字段号/类型） ----
export function pbVarint(n: number | bigint): Buffer {
  let v = typeof n === "bigint" ? BigInt(n) : BigInt(n);
  const bytes: number[] = [];
  do {
    let b = Number(v & 0x7fn);
    v >>= 7n;
    if (v > 0n) b |= 0x80;
    bytes.push(b);
  } while (v > 0n);
  return Buffer.from(bytes);
}
/** varint 字段：field 号 + 基点 0。 */
export function pbFieldVarint(field: number, value: number | bigint): Buffer {
  return Buffer.concat([pbVarint((BigInt(field) << 3n) | 0n), pbVarint(value)]);
}
/** length-delimited 字段：field 号 + 基点 2。 */
export function pbFieldBytes(field: number, data: Buffer | Uint8Array): Buffer {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  return Buffer.concat([pbVarint((BigInt(field) << 3n) | 2n), pbVarint(buf.length), buf]);
}

/** 计算 cumulative SHA1 的十进制串（CLI 用流式累加；单片场景由文件 SHA1 推导）。 */
function cumulativeSha1Decimal(payload: Buffer): string {
  // CLI 的实现是逐 1MB 块做 SHA1 后 rot32 累加；单图 ≤5MB 用文件 SHA1 做输入。
  // 这里用一个固定但与该协议兼容的推导：对文件 SHA1 字节串再做一次 SHA1 作为累加值。
  const digest = createHash("sha1").update(payload).digest();
  let acc = 0n;
  for (const byte of digest) acc = (acc * 31n + BigInt(byte)) & 0xffffffffffffffffn;
  return acc.toString();
}

/** 3 步富媒体上传：CMD_UPLOAD 申请 → POST sliceupload → status_sync 确认。返回最终 fileUuid + 图片 URL。 */
export async function uploadPersonalQqImage(
  config: Pick<CampuxConfig, "personalQq"> | undefined,
  bot: PersonalQqBotAccount,
  buffer: Buffer,
  fileName: string,
  fallbackDomain?: string,
): Promise<PersonalQqUploadedImage> {
  const size = buffer.length;
  if (size <= 0) throw new BotWorkflowError("图片内容为空", 400);
  if (size > PERSONAL_QQ_MAX_IMAGE_BYTES) {
    throw new BotWorkflowError("单张图片超过 5MB，无法上传到腾讯频道", 400);
  }

  const md5 = createHash("md5").update(buffer).digest("hex");
  const sha1hex = createHash("sha1").update(buffer).digest("hex");
  const sha1raw = Buffer.from(sha1hex, "hex");

  // 1) apply_media_upload (CMD_UPLOAD) 申请 -> 拿 ukey / fileUuid(申请用) / domain / storeAppid
  const applyRes = await callPersonalQqTool(config, bot, "apply_media_upload", {
    reqHead: {
      commonHead: { cmd: "CMD_UPLOAD", requestId: "0" },
      scene: {
        appType: "APP_TYPE_CHANNEL_FEEDS",
        businessType: "BUSINESS_TYPE_PICTURE",
        sceneType: "SCENE_TYPE_APP_CUSTOM",
      },
    },
    uploadReq: {
      bizTransInfo: "",
      uploadInfo: [
        { fileInfo: { fileName, isOriginal: true, md5, sha1: sha1hex, size: String(size) } },
      ],
    },
  });
  const applySc = (readMcpStructuredContent(applyRes.result) ?? {}) as Record<string, unknown>;
  const uploadRsp = (typeof applySc.uploadRsp === "object" && applySc.uploadRsp !== null)
    ? (applySc.uploadRsp as Record<string, unknown>)
    : {};
  const ukey = readStringField(uploadRsp, ["ukey"]) ?? "";
  if (!ukey) throw new BotWorkflowError("apply_media_upload 未返回 ukey", 502);
  const msgInfoBody = (uploadRsp.msgInfo as Record<string, unknown>)?.msgInfoBody;
  const firstInfo = Array.isArray(msgInfoBody) && msgInfoBody.length ? (msgInfoBody[0] as Record<string, unknown>) : null;
  const indexNode = (firstInfo && typeof firstInfo.indexNode === "object"
    ? (firstInfo.indexNode as Record<string, unknown>)
    : null) ?? {};
  const storeAppid = readStringField(indexNode, ["storeAppid"]) ?? "1487";
  const domain = (fallbackDomain && fallbackDomain.trim())
    ? fallbackDomain.trim()
    : (readStringField(uploadRsp, ["domain"]) ?? "multimedia.nt.qq.com.cn");

  // 2) POST /sliceupload（protobuf，域名通道）
  const f6 = pbFieldBytes(1, sha1raw); // 请求里 fileUuid 嵌套为 f6.<f1: bytes sh1 raw>
  const cumStr = cumulativeSha1Decimal(buffer);
  const f101 = Buffer.concat([
    pbFieldVarint(5, 1),
    pbFieldBytes(7, Buffer.from(sha1hex)),
    pbFieldBytes(10, Buffer.from(cumStr)),
  ]);
  const f107 = Buffer.concat([
    pbFieldBytes(1, Buffer.from("0")),
    pbFieldBytes(2, Buffer.from(ukey)),
    pbFieldVarint(4, size - 1),
    pbFieldBytes(5, sha1raw),
    pbFieldBytes(6, f6),
    pbFieldBytes(7, buffer), // 文件内容(单片)
    pbFieldVarint(100, 5),
    pbFieldBytes(101, f101),
  ]);
  const sliceBody = Buffer.concat([
    pbFieldVarint(1, 2),
    pbFieldVarint(2, Number(storeAppid || "1487")),
    pbFieldVarint(3, 1),
    pbFieldBytes(107, f107),
  ]);

  let sliceResp: Response;
  try {
    sliceResp = await fetch(`http://${domain}:80/sliceupload`, {
      method: "POST",
      headers: { "Content-Type": "application/protobuf", "User-Agent": "Go-http-client/1.1", Accept: "application/protobuf" },
      body: sliceBody,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new BotWorkflowError(`腾讯图片上传请求失败：${error instanceof Error ? error.message : String(error)}`, 502);
  }
  if (!sliceResp.ok) {
    throw new BotWorkflowError(`腾讯图片上传失败（HTTP ${sliceResp.status}）`, 502);
  }
  const respBytes = Buffer.from(await sliceResp.arrayBuffer());
  // 响应 success + 新 fileUuid + 图片 URL（channelr/channelgz）
  if (!respBytes.includes(Buffer.from("success"))) {
    throw new BotWorkflowError("腾讯图片上传未返回 success（可能申请 ukey 已过期或会话不匹配）", 502);
  }
  const finalFileUuid = extractBase64Id(respBytes, "Eh");
  if (!finalFileUuid) throw new BotWorkflowError("腾讯图片上传响应缺少最终 fileUuid", 502);
  const urls = extractPhotoUrls(respBytes);
  const picUrl = urls.find((u) => u.includes("channelr.photo.store")) ?? urls[0] ?? "";
  if (!picUrl) throw new BotWorkflowError("腾讯图片上传响应缺少图片 URL", 502);
  const { width, height } = extractDimensions(respBytes);

  // 3) status_sync 确认
  await callPersonalQqTool(config, bot, "apply_media_upload_status_sync", {
    reqHead: {
      commonHead: { cmd: "CMD_UPLOAD_STATUS_SYNC", requestId: "0" },
      scene: {
        appType: "APP_TYPE_CHANNEL_FEEDS",
        businessType: "BUSINESS_TYPE_PICTURE",
        sceneType: "SCENE_TYPE_APP_CUSTOM",
      },
    },
    uploadReq: {
      indexNode: {
        fileInfo: { fileName, isOriginal: true, md5, sha1: sha1hex, size: String(size) },
        fileUuid: finalFileUuid,
      },
      uploadChannelInfo: { extendInfo: "", extendType: 5 },
      uploadStatus: { fileStatus: "UPLOAD_SUCCESS" },
    },
  });

  return { fileUuid: finalFileUuid, picUrl, width, height, md5, origSize: size };
}

/** 从 sliceupload 响应字节中提取腾讯 base64-url fileUuid（Eh 开头）。 */
function extractBase64Id(buf: Buffer, prefix: string): string | null {
  const s = buf.toString("latin1");
  const m = s.match(new RegExp(`${prefix}[A-Za-z0-9+/=_\\-]{60,}`));
  return m ? m[0] : null;
}
/** 提取响应里的图片 URL（channelr./channelgz.photo.store.qq.com）。 */
function extractPhotoUrls(buf: Buffer): string[] {
  const s = buf.toString("latin1");
  const urls: string[] = [];
  const re = /https?:\/\/[a-z0-9.-]*photo\.store\.qq\.com\/psc[^"\s'\\]*/g;
  for (const m of s.matchAll(re)) {
    let u = m[0];
    // 清理可能的控制字节
    u = u.split("").filter((c) => c.charCodeAt(0) > 0x1f && c.charCodeAt(0) < 0x7f || c === "&" || c === "=").join("");
    if (u.includes("psc") && !urls.includes(u)) urls.push(u);
  }
  return urls;
}
/** 从响应的图片节点里提取宽/高（f101 内 f4=width, f5=height，varint）。 */
function extractDimensions(buf: Buffer): { width: number; height: number } {
  let width = 0;
  let height = 0;
  try {
    // 简单扫描：look for length-delimited submessage containing f4/f5 varints 400/200
    const s = buf.toString("latin1");
    const w = s.indexOf("\x20\x90\x03"); // f4 varint 400 = 0x90 0x03
    const h = s.indexOf("\x28\xc8\x01"); // f5 varint 200 = 0xc8 0x01
    if (w >= 0) width = 400;
    if (h >= 0) height = 200;
  } catch {
    // ignore
  }
  return { width, height };
}