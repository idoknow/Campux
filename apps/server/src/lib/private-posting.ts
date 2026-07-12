export type OneBotMessageSegment = {
  type?: string;
  data?: Record<string, unknown>;
};

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
  if (!Array.isArray(message)) {
    return [];
  }

  return message.filter((segment): segment is OneBotMessageSegment => {
    if (!segment || typeof segment !== "object") {
      return false;
    }
    return (segment as OneBotMessageSegment).type === "image";
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

  return message.filter((segment): segment is OneBotMessageSegment => {
    if (!segment || typeof segment !== "object") {
      return false;
    }
    const seg = segment as OneBotMessageSegment;
    // 过滤掉空白纯文本段（只有空格/换行/零宽字符），保留有实际内容的 text 和所有非 text 段
    if (seg.type === "text") {
      const t = String(seg.data?.text ?? "").trim();
      return t.length > 0;
    }
    return true;
  });
}

export function extractOneBotPlainText(message: unknown, rawMessage?: string) {
  if (Array.isArray(message)) {
    return message
      .map((segment) => {
        const item = segment as OneBotMessageSegment;
        return item.type === "text" ? String(item.data?.text ?? "") : "";
      })
      .filter(Boolean)
      .join("\n");
  }

  if (typeof message === "string") {
    return message;
  }

  return rawMessage ?? "";
}
