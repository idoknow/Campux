export type OneBotMessageSegment = {
  type?: string;
  data?: Record<string, unknown>;
};

export function parsePrivatePostStartText(input: string) {
  const trimmed = input.trim();
  const prefix = trimmed.startsWith("#投稿") ? "#投稿" : trimmed.startsWith("＃投稿") ? "＃投稿" : null;
  if (!prefix) {
    return null;
  }
  return trimmed.slice(prefix.length).trimStart();
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
