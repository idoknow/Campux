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

/** 字符串段是否「只有 CQ 码」或空白，不应作为转发正文。 */
function isCqOnlyStringSegment(value: string): boolean {
  return stripCqCodes(value).trim().length === 0;
}

export type PrivatePostStartParseOptions = {
  extraKeywords?: string[] | undefined;
  aiIntakeEnabled?: boolean | undefined;
};

export function parsePrivatePostStartText(input: string, options?: PrivatePostStartParseOptions | string[] | undefined) {
  const trimmed = input.trim();
  const extraKeywords = Array.isArray(options) ? options : options?.extraKeywords;
  // AI 语义收稿只负责自由文本；显式 #投稿 / #关键词 指令始终生效（议题 #163）。
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
  if (!Array.isArray(message)) {
    return [];
  }

  // 字符串段规范化成 text 段，避免下游按 seg.type 分支时拿到裸字符串
  return message.flatMap((segment): OneBotMessageSegment[] => {
    if (typeof segment === "string") {
      const s = stripZeroWidthChars(segment);
      if (s.trim().length === 0 || isCqOnlyStringSegment(s)) {
        return [];
      }
      return [{ type: "text", data: { text: s } }];
    }
    if (!segment || typeof segment !== "object") {
      return [];
    }
    const seg = segment as OneBotMessageSegment;
    // 过滤掉空白纯文本段（只有空格/换行/零宽字符），保留有实际内容的 text 和所有非 text 段
    if (seg.type === "text") {
      const data = seg.data ?? {};
      const t = stripZeroWidthChars(String(data.text ?? data.content ?? "")).trim();
      return t.length > 0 ? [seg] : [];
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
