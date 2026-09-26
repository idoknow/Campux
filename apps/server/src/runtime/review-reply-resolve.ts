/** 从审核通知正文提取稿件编号。优先「编号：#123」，否则取第一个 #123。 */
export function extractDisplayIdFromReviewText(text: string): number | null {
  const m = text.match(/编号[：:]\s*#\s*(\d+)/) ?? text.match(/#(\d+)\b/);
  if (!m?.[1]) return null;
  const id = Number(m[1]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export type QuotedReplyPayload = {
  /** 被引用消息的发送者 QQ（无法识别时为 null） */
  senderId: string | null;
  /** 被引用消息的纯文本内容 */
  text: string;
};

/**
 * 从 get_msg 返回的数据中提取被引用消息的发送者与纯文本。
 * 兼容 message 为段数组 / 字符串、raw_message 兜底；reply/at 段不计入文本。
 */
export function readQuotedReplyPayload(data: unknown): QuotedReplyPayload | null {
  if (!data || typeof data !== "object") return null;
  const payload = data as Record<string, unknown>;

  const sender = (payload.sender ?? payload.user ?? null) as Record<string, unknown> | null;
  const senderId = sender
    ? normalizeQuotedSenderId(sender.user_id ?? sender.userId ?? sender.uin ?? sender.qq ?? sender.id)
    : null;

  let text = "";
  if (Array.isArray(payload.message)) {
    text = (payload.message as Array<Record<string, unknown>>)
      .map((seg) => {
        if (!seg || typeof seg !== "object") return "";
        if (seg.type === "reply" || seg.type === "at") return "";
        const segData = seg.data as Record<string, unknown> | undefined;
        return typeof segData?.text === "string" ? segData.text : "";
      })
      .join("");
  } else if (typeof payload.message === "string") {
    text = payload.message;
  }
  if (!text && typeof payload.raw_message === "string") {
    text = payload.raw_message;
  }

  return { senderId, text };
}

function normalizeQuotedSenderId(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  return null;
}
