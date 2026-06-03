const defaultMinDelayMs = 30_000;
const defaultMaxDelayMs = 90_000;

export type OneBotRequestEvent = {
  post_type?: string;
  request_type?: string;
  self_id?: number | string;
  user_id?: number | string;
  flag?: string;
  comment?: string;
};

export type FriendRequestAutoApproveBot = {
  enabled: boolean;
  autoFriendRequestApprovalEnabled: boolean;
};

export type FriendRequestAutoApprovePlan = {
  flag: string;
  userQqUin: string;
  comment: string | null;
  delayMs: number;
};

export function buildFriendRequestAutoApprovePlan(
  event: OneBotRequestEvent,
  bot: FriendRequestAutoApproveBot,
  options: {
    minDelayMs?: number;
    maxDelayMs?: number;
    random?: () => number;
  } = {},
): FriendRequestAutoApprovePlan | null {
  if (event.post_type !== "request" || event.request_type !== "friend") {
    return null;
  }
  if (!bot.enabled || !bot.autoFriendRequestApprovalEnabled) {
    return null;
  }

  const flag = typeof event.flag === "string" ? event.flag : "";
  const userQqUin = normalizeId(event.user_id);
  if (!flag || !userQqUin) {
    return null;
  }

  const minDelayMs = Math.max(0, Math.floor(options.minDelayMs ?? defaultMinDelayMs));
  const maxDelayMs = Math.max(minDelayMs, Math.floor(options.maxDelayMs ?? defaultMaxDelayMs));
  const random = options.random ?? Math.random;
  const ratio = Math.min(1, Math.max(0, random()));
  const delayMs = minDelayMs + Math.floor((maxDelayMs - minDelayMs) * ratio);

  return {
    flag,
    userQqUin,
    comment: typeof event.comment === "string" && event.comment.trim() ? event.comment.trim() : null,
    delayMs,
  };
}

export function buildSetFriendAddRequestParams(flag: string) {
  return {
    flag,
    approve: true,
  };
}

function normalizeId(value: string | number | undefined) {
  if (typeof value === "number") return String(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return value;
  return null;
}
