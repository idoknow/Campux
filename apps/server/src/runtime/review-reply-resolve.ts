/** 从审核通知正文提取稿件编号。优先「编号：#123」，否则取第一个 #123。 */
export function extractDisplayIdFromReviewText(text: string): number | null {
  const m = text.match(/编号[：:]\s*#\s*(\d+)/) ?? text.match(/#(\d+)\b/);
  if (!m?.[1]) return null;
  const id = Number(m[1]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * 判断 get_msg 返回的发送者是否允许用于引用解析。
 * - sender 缺失（部分 OneBot 实现不返回）→ 允许继续解析
 * - sender 明确且不是本 bot → 拒绝
 */
export function isAllowedReplySender(senderId: string | null, botQqUin: string): boolean {
  if (!senderId) return true;
  return senderId === botQqUin;
}
