/**
 * 私聊转发 → 群 的「被引用消息 → 用户」反查工具。
 *
 * 背景：转发映射（`privateForwardMsgIdMap`）只存在进程内存里，部署/重启后清空，
 * 之后群里引用历史转发卡片发 `#回复` 会一律失败。协议端能取回那条被引用的消息，
 * 因此可以按内容还原「这张卡片是哪个用户发的」，无需依赖内存映射，也不用落库。
 *
 * 这里只做纯解析，网络调用在 OneBotRuntime 里。
 */

export type ForwardIdentity = {
  /** 用户 QQ 号（字符串，便于与 bigint 比较） */
  qqUin: string;
  /** 用户昵称；协议端缺字段时回退成 QQ 号 */
  nickname: string;
};

function normalizeQq(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return /^\d{5,15}$/.test(trimmed) ? trimmed : null;
  }
  return null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

/**
 * 从合并转发的一个节点里取发送者身份。
 * 兼容三种形态：node.data 内平铺（我们发送时的写法）、node.sender 对象、
 * 以及 node 本身平铺；NapCat / go-cqhttp / Lagrange 字段名各不相同。
 */
export function readForwardNodeIdentity(node: unknown): ForwardIdentity | null {
  const record = asRecord(node);
  if (!record) {
    return null;
  }
  const data = asRecord(record.data) ?? record;
  const sender = asRecord(record.sender) ?? asRecord(data.sender);

  const qqUin = normalizeQq(
    data.user_id ?? data.qq ?? data.uin
    ?? sender?.user_id ?? sender?.qq ?? sender?.uin,
  );
  if (!qqUin) {
    return null;
  }
  const nickname = readString(data.nickname) ?? readString(data.name)
    ?? readString(sender?.nickname) ?? readString(sender?.card)
    ?? qqUin;
  return { qqUin, nickname };
}

/** 取 get_forward_msg / get_msg 返回里的节点数组，兼容 messages / message / content 三种字段。 */
export function readForwardNodes(payload: unknown): unknown[] {
  const record = asRecord(payload);
  if (!record) {
    return [];
  }
  for (const key of ["messages", "message", "content"] as const) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value;
    }
  }
  return [];
}

/** CQ 字符串形态的聊天记录段：`[CQ:forward,id=748352241819]`。 */
const CQ_FORWARD_STRING = /\[CQ:(?:forward|node),[^\]]*?\bid=([^,\]]+)/i;

/**
 * 找「聊天记录」段并返回它的 forward id（没有则 null）。
 * 兼容段数组与 OneBot 的 CQ 字符串两种消息形态——部分实现 get_msg 返回的是字符串。
 */
export function findForwardMessageId(segments: unknown): string | null {
  if (typeof segments === "string") {
    const match = CQ_FORWARD_STRING.exec(segments);
    const id = match?.[1]?.trim();
    return id ? id : null;
  }
  if (!Array.isArray(segments)) {
    return null;
  }
  for (const segment of segments) {
    const record = asRecord(segment);
    if (!record) continue;
    const type = record.type;
    if (type !== "forward" && type !== "node" && type !== "json") continue;
    const data = asRecord(record.data);
    const id = data?.id ?? data?.res_id ?? data?.message_id;
    if (typeof id === "string" && id.trim()) return id.trim();
    if (typeof id === "number" && Number.isFinite(id)) return String(Math.trunc(id));
  }
  return null;
}

/** 取一条消息段的纯文本（忽略 reply / at / 其它非文本段）。 */
export function readSegmentText(segments: unknown): string {
  if (typeof segments === "string") {
    return segments;
  }
  if (!Array.isArray(segments)) {
    return "";
  }
  return segments
    .map((segment) => {
      const data = asRecord(segment) ? asRecord(asRecord(segment)!.data) : null;
      return typeof data?.text === "string" ? data.text : "";
    })
    .join("");
}

/** 新格式：QQ 紧跟在固定前缀后面，昵称放在其后，昵称内容无法影响解析结果。 */
const PRIVATE_FORWARD_HEADER_V2 = /^📩\s*\[QQ (\d{5,15})\]\s*(.*?)\s*发来私聊消息/u;

/**
 * 旧格式：`📩 昵称（QQ）发来私聊消息：`。
 * 昵称里可能自带 `（数字）发来私聊消息：`，所以贪婪匹配取**最后一个**身份令牌——
 * 真实 QQ 由程序追加在最末尾，昵称再怎么伪造也只会落在前面。
 */
const PRIVATE_FORWARD_HEADER_LEGACY = /^📩\s*(.*)（(\d{5,15})）发来私聊消息/u;

/**
 * 解析「合并转发失败、降级成普通群消息」时的头部，用于重启后从被引用消息还原用户。
 * 先按新格式（不可伪造），再兼容历史消息的旧格式。
 */
export function parsePrivateForwardHeader(text: string): ForwardIdentity | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  const modern = PRIVATE_FORWARD_HEADER_V2.exec(trimmed);
  if (modern?.[1]) {
    const nickname = (modern[2] ?? "").trim();
    return { qqUin: modern[1], nickname: nickname || modern[1] };
  }
  const legacy = PRIVATE_FORWARD_HEADER_LEGACY.exec(trimmed);
  if (!legacy?.[1] || !legacy[2]) {
    return null;
  }
  const nickname = legacy[1].trim();
  return { qqUin: legacy[2], nickname: nickname || legacy[2] };
}

/** get_msg 返回里的发送者 QQ（用于确认被引用消息确实是本墙号发的）。 */
export function readMessageSenderQq(payload: unknown): string | null {
  const record = asRecord(payload);
  if (!record) {
    return null;
  }
  const sender = asRecord(record.sender) ?? asRecord(record.user);
  return normalizeQq(
    sender?.user_id ?? sender?.userId ?? sender?.uin ?? sender?.qq ?? sender?.id,
  );
}
