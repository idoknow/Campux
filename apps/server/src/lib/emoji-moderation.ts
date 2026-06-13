/**
 * 超级表情包审核规则。
 *
 * QQ 超级表情通常以 `[表情/名称]` 或 `[表情[名称]]` 的形式出现在 OneBot
 * raw_message 中。NapCat 无法区分普通表情，但超级表情会携带名称文本。
 *
 * 当投稿文本中包含积极表情 → 自动通过（approved）。
 * 当投稿文本中包含消极表情 → 自动拒绝（rejected）。
 * 消极判定优先于积极判定。
 */

const APPROVED_EMOJI_NAMES = new Set([
  "打call",
  "崇拜",
  "比心",
  "庆祝",
  "吃糖",
]);

const REJECTED_EMOJI_NAMES = new Set([
  "硬撑",
  "无语",
  "变形",
  "惊吓",
  "大怨种",
]);

/**
 * 匹配 `[表情/打call]` 和 `[表情[大怨种]]` 两种格式。
 * 捕获组 1 = 表情名称。
 */
const EMOJI_PATTERN = /\[表情[\/\[]([^\]]+)[\]\]]/g;

export type EmojiModerationResult = "approve" | "reject" | null;

/**
 * 检查文本中是否包含超级表情，并返回审核建议。
 *
 * - 包含任意积极表情 → "approve"
 * - 包含任意消极表情 → "reject"（优先于积极）
 * - 无匹配 → null（不做自动处理）
 */
export function evaluateEmojiModeration(text: string): EmojiModerationResult {
  let hasApproved = false;
  let hasRejected = false;

  EMOJI_PATTERN.lastIndex = 0;
  for (const match of text.matchAll(EMOJI_PATTERN)) {
    const name = match[1]?.trim();
    if (!name) continue;
    if (REJECTED_EMOJI_NAMES.has(name)) {
      hasRejected = true;
    }
    if (APPROVED_EMOJI_NAMES.has(name)) {
      hasApproved = true;
    }
  }

  // 消极优先（审核从严）
  if (hasRejected) return "reject";
  if (hasApproved) return "approve";
  return null;
}
