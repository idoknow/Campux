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

export function parsePrivatePostStartText(input: string, extraKeywords?: string[] | undefined) {
  const trimmed = input.trim();

  // 默认支持 #投稿
  const defaultMatch = matchKeyword(trimmed, "投稿");
  if (defaultMatch !== null) return defaultMatch;

  // 额外的触发关键词
  if (extraKeywords && extraKeywords.length > 0) {
    for (const kw of extraKeywords) {
      const match = matchKeyword(trimmed, kw);
      if (match !== null) return match;
    }
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
