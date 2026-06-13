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

/** QQ 表情 ID → Emoji 映射（仅常用表情，其余回退为 [表情]） */
const QQ_FACE_EMOJI: Record<number, string> = {
  0: "😮", 1: "😒", 2: "😍", 3: "😳", 4: "😎", 5: "😢", 6: "😊", 7: "🤐",
  8: "😴", 9: "😷", 10: "😵", 11: "😨", 12: "😰", 13: "😭", 14: "😌",
  15: "😤", 16: "😡", 17: "😖", 18: "👏", 19: "😔", 20: "😣",
  21: "😜", 22: "😁", 23: "😊", 24: "😘", 25: "🤪", 26: "🤩",
  27: "🥳", 28: "😏", 29: "😶", 30: "🥺", 31: "🤗",
  32: "😨", 33: "😭", 34: "😱", 35: "😰", 36: "🥵", 37: "🥶",
  38: "😷", 39: "😠", 40: "🤬", 41: "😈", 42: "👿", 43: "💀",
  44: "☠️", 45: "💩", 46: "👊", 47: "🖐️", 48: "✌️", 49: "🤝",
  50: "🖕", 51: "✊", 52: "🤛", 53: "👋", 54: "🤚", 55: "🖐️",
  56: "✍️", 57: "🤝", 58: "🙏", 59: "🤲", 60: "🤜",
  63: "💪", 64: "🤳",
  74: "🌹", 75: "🥀", 76: "❤️", 77: "💔", 78: "🎂", 79: "⚡",
  80: "💣", 81: "🔪", 82: "🏀", 83: "🏈", 84: "⚽", 85: "🎱",
  86: "🎯", 87: "🎲", 88: "🎮", 89: "🎵", 90: "🎤", 91: "🎧",
  92: "🎸", 93: "🎺", 94: "🎻", 95: "🎬",
  96: "🎁", 97: "☀️", 98: "🌙", 99: "👍", 100: "👎",
  101: "🤝", 102: "✌️", 103: "💋", 104: "🫂",
  106: "🍉", 107: "🍺", 108: "🥤", 109: "☕", 110: "🍚",
  111: "🐷", 112: "🌸", 113: "🌻", 114: "💩", 115: "🎃",
  116: "🌙", 117: "⭐", 118: "🌟", 119: "☁️", 120: "🌈",
  121: "🌊", 122: "🔥",
  123: "☀️", 124: "🎁", 125: "🤗", 126: "💪", 127: "🤏",
  128: "🤝", 129: "✌️", 130: "🥹",
  147: "🤮", 148: "😰", 149: "🥹",
  152: "🤯",
  158: "🥱",
  168: "🐷", 169: "🐱", 170: "🐶",
  171: "😤", 172: "🕺", 173: "🤩", 174: "💃", 175: "💋",
  176: "☯️", 177: "☯️", 178: "🎉", 179: "🧨", 180: "🏮",
  181: "🧧", 182: "🐰",
};

/**
 * 从 OneBot 消息数组中提取可视文本。
 * - text 段：保留原文
 * - face 段：转译为对应 Emoji（未知 ID 显示 [表情]）
 * - 其余段：忽略
 */
export function extractOneBotDisplayText(message: unknown, rawMessage?: string): string {
  if (Array.isArray(message)) {
    const parts = message.map((segment) => {
      const item = segment as OneBotMessageSegment;
      if (item.type === "text") return String(item.data?.text ?? "");
      if (item.type === "face") {
        const id = Number(item.data?.id);
        return QQ_FACE_EMOJI[id] || "[表情]";
      }
      return "";
    });
    return parts.filter(Boolean).join(" ");
  }

  if (typeof message === "string") {
    return message;
  }

  return rawMessage ?? "";
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
