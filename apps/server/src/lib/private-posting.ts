export type OneBotMessageSegment = {
  type?: string;
  data?: Record<string, unknown>;
};

import { stripZeroWidthChars } from "./sanitize";

/**
 * 检查 input 是否以指定的关键词开头（支持半角 # 和全角 ＃ 前缀）。
 * 关键词本身不应包含 # 前缀。
 */
function matchKeyword(input: string, keyword: string): string | null {
  const half = `#${keyword}`;
  const full = `＃${keyword}`;
  const prefix = input.startsWith(half) ? half : input.startsWith(full) ? full : null;
  if (!prefix) return null;
  return input.slice(prefix.length).trimStart();
}

const CQ_CODE_GLOBAL_RE = /\[CQ:([a-zA-Z0-9_-]+)((?:,[^,\]]*)*)\]/g;

/** 去掉 CQ 码，只留可读文本（snowluma 字符串形态 / raw_message）。 */
export function stripCqCodes(input: string): string {
  // 只去掉 CQ 码，不压缩正文空白（有意空格/制表符应原样保留；指令解析层会再 trim）
  return input.replace(CQ_CODE_GLOBAL_RE, "");
}

/** 从 CQ 字符串解析出 image 段（snowluma 字符串形态）。 */
export function parseCqImageSegments(input: string): OneBotMessageSegment[] {
  const segments: OneBotMessageSegment[] = [];
  for (const match of input.matchAll(/\[CQ:image((?:,[^,\]]*)*)\]/gi)) {
    const data: Record<string, unknown> = {};
    const body = match[1] ?? "";
    for (const part of body.split(",")) {
      if (!part) continue;
      const eq = part.indexOf("=");
      if (eq <= 0) continue;
      const key = part.slice(0, eq).trim();
      const value = part.slice(eq + 1);
      if (key) data[key] = value;
    }
    segments.push({ type: "image", data });
  }
  return segments;
}

/**
 * 把 snowluma 字符串段拆成规范消息段：
 * `[CQ:image,...]文字` → image + text，避免转发时丢图或正文里残留裸 CQ。
 */
export function splitCqStringSegment(input: string): OneBotMessageSegment[] {
  const out: OneBotMessageSegment[] = [];
  const re = /\[CQ:([a-zA-Z0-9_-]+)((?:,[^,\]]*)*)\]/g;
  let last = 0;
  for (const match of input.matchAll(re)) {
    const index = match.index ?? 0;
    const text = input.slice(last, index);
    if (text) {
      out.push({ type: "text", data: { text } });
    }
    const type = match[1] ?? "";
    const body = match[2] ?? "";
    const data: Record<string, unknown> = {};
    for (const part of body.split(",")) {
      if (!part) continue;
      const eq = part.indexOf("=");
      if (eq <= 0) continue;
      const key = part.slice(0, eq).trim();
      if (key) data[key] = part.slice(eq + 1);
    }
    if (type === "image") {
      out.push({ type: "image", data });
    } else if (type === "text") {
      const textValue = String(data.text ?? data.content ?? "");
      if (textValue) out.push({ type: "text", data: { text: textValue } });
    } else {
      out.push({ type, data });
    }
    last = index + match[0].length;
  }
  const tail = input.slice(last);
  if (tail) {
    out.push({ type: "text", data: { text: tail } });
  }
  return out.filter((seg) => {
    if (seg.type === "text") {
      // 与对象 text 段一致：零宽字符也算空白，避免只含 \u200b 的段被转发
      return stripZeroWidthChars(String(seg.data?.text ?? "")).trim().length > 0;
    }
    return true;
  });
}

export type PrivatePostStartParseOptions = {
  extraKeywords?: string[] | undefined;
  aiIntakeEnabled?: boolean | undefined;
};

export function parsePrivatePostStartText(input: string, options?: PrivatePostStartParseOptions | string[] | undefined) {
  const trimmed = input.trim();
  const extraKeywords = Array.isArray(options) ? options : options?.extraKeywords;
  const aiIntakeEnabled = Array.isArray(options) ? false : options?.aiIntakeEnabled === true;

  if (aiIntakeEnabled) {
    return null;
  }

  // 默认支持 #投稿（也可不带 # 前缀走下面兜底）
  const defaultMatch = matchKeyword(trimmed, "投稿");
  if (defaultMatch !== null) return defaultMatch;

  // 额外的触发关键词（支持 # 前缀）
  if (extraKeywords && extraKeywords.length > 0) {
    for (const kw of extraKeywords) {
      const match = matchKeyword(trimmed, kw);
      if (match !== null) return match;
    }
  }

  // 也支持内置关键词不带 # 前缀：直接输入关键词即可触发投稿流程
  const plainKeywords = ["投稿", "墙墙投稿", "墙墙"];
  for (const kw of plainKeywords) {
    if (trimmed === kw) return "";
  }

  return null;
}

export function isPrivatePostFinishText(input: string) {
  return /^(?:#|＃)(?:结束|结束投稿)\s*$/.test(input.trim());
}

export function isPrivatePostCancelText(input: string) {
  return /^(?:#|＃)(?:取消|取消本次投稿)\s*$/.test(input.trim());
}

export function isPrivatePostUndoText(input: string) {
  return /^(?:#|＃)(?:撤回|撤回上一条|撤回上一步)\s*$/.test(input.trim());
}

/**
 * 解析「按编号取消/撤回已提交稿件」指令（议题 #162）。
 * - `#取消 123`：取消待审核稿件
 * - `#撤回 123` / `#撤回 理由 123`：对已发布稿件发起撤回
 * 编号必须出现在末尾，避免与草稿流的 `#取消` / `#撤回`（无编号）冲突。
 */
export function parsePostRecallOrCancelCommand(input: string): { action: "cancel" | "recall"; displayId: number; reason: string } | null {
  const trimmed = input.trim();
  const match = trimmed.match(/^(?:#|＃)(取消|撤回|取消投稿|撤回投稿|撤销)\s+(.+?)\s*$/);
  if (!match) {
    return null;
  }
  const actionWord = match[1]!;
  const rest = match[2]!.trim();
  // 支持「理由 123」「#123」「123」
  const tail = rest.match(/(?:^|#|\s)(\d{1,9})\s*$/);
  if (!tail) {
    return null;
  }
  const displayId = Number(tail[1]);
  if (!Number.isFinite(displayId) || displayId <= 0) {
    return null;
  }
  let reason = rest.slice(0, tail.index).trim();
  reason = reason.replace(/^#\s*/, "").trim();
  const action = actionWord.startsWith("撤") || actionWord === "撤销" ? "recall" : "cancel";
  return { action, displayId, reason };
}

export function parsePrivatePostModeText(input: string) {
  const match = input.trim().match(/^(?:#|＃)(匿名|实名)(?:投稿)?\s*$/);
  if (!match) {
    return null;
  }

  return {
    anonymous: match[1] === "匿名",
  };
}

// ── 可配置的对话投稿关键词 ──────────────────────────────
//
// 关键词模式（未开启 AI 语义收稿，或 AI 判断不出意图时）靠这些词触发操作，
// 默认值允许用户不带 `#` 直接发「投稿 / 匿名 / 结束 / 确认」等。管理员可以在
// 设置里改每一组关键词；某组设为空数组即关闭该组（`#` 前缀命令仍然生效）。

export type PrivatePostKeywordName = "start" | "anonymous" | "realname" | "cancel" | "finish" | "undo" | "confirm";

export type PrivatePostKeywordMatch =
  | { name: "start"; body: string }
  | { name: Exclude<PrivatePostKeywordName, "start"> };

export type PrivatePostKeywords = {
  /** 开始投稿：允许关键词语后直接跟正文，如「投稿 今天下雨了」。 */
  start: string[];
  /** 选择匿名投稿。 */
  anonymous: string[];
  /** 选择实名投稿。 */
  realname: string[];
  /** 取消本次投稿。 */
  cancel: string[];
  /** 结束编辑、进入二次确认。 */
  finish: string[];
  /** 撤回上一条正文/图片。 */
  undo: string[];
  /** 在二次确认阶段提交。 */
  confirm: string[];
};

export const DEFAULT_PRIVATE_POST_KEYWORDS: PrivatePostKeywords = {
  start: ["墙墙投稿", "投稿", "墙墙", "墙", "吐槽", "表白"],
  anonymous: ["匿名", "匿", "腻"],
  realname: ["不匿名", "不匿", "不腻", "实名", "实"],
  cancel: ["取消", "算了"],
  finish: ["结束", "完成"],
  undo: ["撤回"],
  confirm: ["确认", "可以", "发", "发布", "没问题", "发吧"],
};

const PRIVATE_POST_KEYWORD_MAX_LENGTH = 12;
const PRIVATE_POST_KEYWORDS_MAX_COUNT = 20;

/** 关键词统一成「不带 # 前缀、无零宽字符、已 trim」的形态，便于逐字比对。 */
function canonicalizeKeyword(input: string) {
  return stripZeroWidthChars(input).replace(/^[#＃\s]+/, "").trim().slice(0, PRIVATE_POST_KEYWORD_MAX_LENGTH);
}

function normalizeKeywordList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    return [...fallback];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const keyword = canonicalizeKeyword(item);
    if (!keyword || seen.has(keyword)) continue;
    seen.add(keyword);
    out.push(keyword);
    if (out.length >= PRIVATE_POST_KEYWORDS_MAX_COUNT) break;
  }
  return out;
}

/** 未配置时回落默认值；显式给空数组表示关闭该组关键词（不是回落默认）。 */
export function normalizePrivatePostKeywords(value: unknown): PrivatePostKeywords {
  const candidate = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  return {
    start: normalizeKeywordList(candidate.start, DEFAULT_PRIVATE_POST_KEYWORDS.start),
    anonymous: normalizeKeywordList(candidate.anonymous, DEFAULT_PRIVATE_POST_KEYWORDS.anonymous),
    realname: normalizeKeywordList(candidate.realname, DEFAULT_PRIVATE_POST_KEYWORDS.realname),
    cancel: normalizeKeywordList(candidate.cancel, DEFAULT_PRIVATE_POST_KEYWORDS.cancel),
    finish: normalizeKeywordList(candidate.finish, DEFAULT_PRIVATE_POST_KEYWORDS.finish),
    undo: normalizeKeywordList(candidate.undo, DEFAULT_PRIVATE_POST_KEYWORDS.undo),
    confirm: normalizeKeywordList(candidate.confirm, DEFAULT_PRIVATE_POST_KEYWORDS.confirm),
  };
}

// 整句比对时忽略首尾/句中的标点与空白：「算了。」等同于「算了」。
const MESSAGE_NOISE_RE = /[\s。．.!！?？~～、,，;；:：…—\-·"'“”‘’（）()【】\[\]]/g;

function canonicalizeMessage(input: string) {
  return stripZeroWidthChars(input).replace(/^[#＃／/]+/, "").replace(MESSAGE_NOISE_RE, "").toLowerCase();
}

/** 关键词后面必须紧跟空白或标点，避免「投稿箱在哪」被当成「投稿 + 正文」。 */
const START_KEYWORD_BOUNDARY_RE = /^[\s。．.!！?？~～、,，;；:：…—\-·]/;

function matchStartKeyword(text: string, keywords: string[]): { body: string } | null {
  const stripped = stripZeroWidthChars(text).replace(/^[#＃\s]+/, "").trim();
  if (!stripped) return null;
  // 长关键词优先：「墙墙投稿」不能被「墙」抢走
  const sorted = [...keywords].sort((a, b) => b.length - a.length);
  for (const keyword of sorted) {
    if (!keyword) continue;
    if (stripped === keyword) return { body: "" };
    if (!stripped.startsWith(keyword)) continue;
    const rest = stripped.slice(keyword.length);
    if (!START_KEYWORD_BOUNDARY_RE.test(rest)) continue;
    return { body: rest.trim() };
  }
  return null;
}

function matchesAnyKeyword(canonicalMessage: string, keywords: string[]) {
  return keywords.some((keyword) => {
    const canonical = canonicalizeMessage(keyword);
    return canonical.length > 0 && canonical === canonicalMessage;
  });
}

/**
 * 解析一条私聊消息命中了哪些关键词操作。
 * 返回全部命中项（而不是单个），由调用方按当前投稿状态决定优先级：
 * 同一句话可能既是「结束」又是「确认」——只有处于二次确认时才该按确认处理。
 */
export function matchPrivatePostKeywords(
  input: string,
  keywords: PrivatePostKeywords = DEFAULT_PRIVATE_POST_KEYWORDS,
): PrivatePostKeywordMatch[] {
  const matches: PrivatePostKeywordMatch[] = [];
  const trimmed = stripZeroWidthChars(input).trim();
  if (!trimmed) return matches;

  const start = matchStartKeyword(trimmed, keywords.start);
  if (start) matches.push({ name: "start", body: start.body });

  const canonical = canonicalizeMessage(trimmed);
  if (!canonical) return matches;

  if (matchesAnyKeyword(canonical, keywords.finish)) matches.push({ name: "finish" });
  if (matchesAnyKeyword(canonical, keywords.cancel)) matches.push({ name: "cancel" });
  if (matchesAnyKeyword(canonical, keywords.undo)) matches.push({ name: "undo" });
  if (matchesAnyKeyword(canonical, keywords.confirm)) matches.push({ name: "confirm" });
  if (matchesAnyKeyword(canonical, keywords.anonymous)) matches.push({ name: "anonymous" });
  if (matchesAnyKeyword(canonical, keywords.realname)) matches.push({ name: "realname" });
  return matches;
}

export function findPrivatePostKeywordMatch(
  matches: PrivatePostKeywordMatch[],
  ...names: PrivatePostKeywordName[]
): PrivatePostKeywordMatch | undefined {
  return matches.find((match) => names.includes(match.name));
}

export function parsePrivatePostConfirmText(input: string) {
  const trimmed = input.trim();
  if (/^(?:#|＃)确认\s*$/.test(trimmed)) {
    return { confirmed: true };
  }
  if (/^(?:#|＃)(?:取消|取消提交|取消本次投稿)\s*$/.test(trimmed)) {
    return { confirmed: false };
  }
  return null;
}

export function extractOneBotImageSegments(message: unknown) {
  if (typeof message === "string") {
    // snowluma 字符串形态：从 CQ:image 解析
    return parseCqImageSegments(message);
  }
  if (!Array.isArray(message)) {
    return [];
  }

  // 保持消息内原始顺序（字符串段里的 CQ:image 与对象 image 段交错时不能打乱）
  return message.flatMap((segment) => {
    if (typeof segment === "string") {
      return parseCqImageSegments(segment);
    }
    if (!segment || typeof segment !== "object") {
      return [] as OneBotMessageSegment[];
    }
    return (segment as OneBotMessageSegment).type === "image"
      ? [segment as OneBotMessageSegment]
      : [] as OneBotMessageSegment[];
  });
}

/**
 * 提取所有消息段，过滤掉空白的纯 text 段。
 * 用于转发场景，保留 face、image 等非文本段，以便合并转发时正确渲染表情和图片。
 */
export function extractOneBotMessageSegments(message: unknown): OneBotMessageSegment[] {
  if (typeof message === "string") {
    // snowluma 单字符串 message 与数组内字符串段同样拆分，避免转发丢失内嵌 image/at
    return splitCqStringSegment(message);
  }
  if (!Array.isArray(message)) {
    return [];
  }

  // 字符串段拆成规范段（text/image/at…），避免下游拿到裸 string 或丢失内嵌图片
  return message.flatMap((segment): OneBotMessageSegment[] => {
    if (typeof segment === "string") {
      return splitCqStringSegment(segment);
    }
    if (!segment || typeof segment !== "object") {
      return [];
    }
    const seg = segment as OneBotMessageSegment;
    // 过滤掉空白纯文本段（只有空格/换行/零宽字符），保留有实际内容的 text 和所有非 text 段
    if (seg.type === "text") {
      const data = seg.data ?? {};
      const textValue = String(data.text ?? data.content ?? "");
      const t = stripZeroWidthChars(textValue).trim();
      if (t.length === 0) {
        return [];
      }
      // 规范化出 data.text，避免只给 data.content 的 snowluma 段在下游转发时丢正文
      return [{ ...seg, data: { ...data, text: textValue } }];
    }
    return [seg];
  });
}

export function extractOneBotPlainText(message: unknown, rawMessage?: string) {
  if (Array.isArray(message)) {
    // snowluma 等实现可能把 text 放 data.text / data.content，或把整段写成字符串
    const texts = message.map((segment) => {
      if (typeof segment === "string") {
        // 裸字符串段也可能带 [CQ:...]，需剥离后再作文本
        return stripCqCodes(segment);
      }
      const item = segment as OneBotMessageSegment;
      if (item?.type === "text") {
        const data = item.data ?? {};
        return stripCqCodes(String(data.text ?? data.content ?? ""));
      }
      return "";
    }).filter(Boolean);
    if (texts.length > 0) {
      return texts.join("\n");
    }
  }

  if (typeof message === "string") {
    // snowluma CQ 字符串：去掉 [CQ:...] 后得到可读文本 / 可解析指令
    return stripCqCodes(message);
  }

  if (message && typeof message === "object" && !Array.isArray(message)) {
    const item = message as OneBotMessageSegment;
    if (item.type === "text") {
      const data = item.data ?? {};
      return stripCqCodes(String(data.text ?? data.content ?? ""));
    }
  }

  return typeof rawMessage === "string" ? stripCqCodes(rawMessage) : (rawMessage ?? "");
}
