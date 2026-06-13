/**
 * 表情包 & emoji 审核规则。
 *
 * 支持三种匹配方式：
 * 1. QQ 超级表情文本标记：`[表情/名称]` / `[表情[名称]]`
 * 2. Unicode emoji 字符：直接匹配表情符号
 * 3. OneBot face 段名称：通过 `data.text` 匹配
 *
 * 当投稿文本中包含积极表情 → 自动通过（approved）。
 * 当投稿文本中包含消极表情 → 自动拒绝（rejected）。
 * 消极判定优先于积极判定。
 */

// ── 超级表情名称 ──────────────────────────────────────

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

// ── Unicode emoji 映射 ────────────────────────────────

/**
 * 积极 emoji：对应 打call/崇拜/比心/庆祝/吃糖 等正向含义。
 */
const APPROVED_EMOJI_CHARS = new Set([
  // 打call / 庆祝
  "🙌", "👏", "🙆", "🎉", "🎊", "🥳", "🎈",
  // 崇拜
  "🤩", "😍", "🥰", "😻",
  // 比心
  "❤", "💕", "💗", "🫶", "🫰", "💖", "💝", "😘", "💋",
  // 吃糖 / 甜品
  "🍬", "🍭", "🍫", "🧁", "🎂", "🍰",
  // 通用积极
  "👍", "🌟", "✨", "💪", "🔥", "✅",
]);

/**
 * 消极 emoji：对应 硬撑/无语/变形/惊吓/大怨种 等负向含义。
 */
const REJECTED_EMOJI_CHARS = new Set([
  // 硬撑 / 无语
  "😤", "😣", "😖", "😑", "🙄", "😐", "😒", "😞",
  // 变形 / 惊吓
  "🤪", "😵", "🥴", "😱", "😨", "😰", "😧", "😦",
  // 大怨种 / 愤怒
  "😡", "😠", "💢", "🤬", "👿", "💩",
  // 鄙视 / 负面
  "👎", "💔", "😭", "😢", "😿",
]);

// ── 文本模式 ──────────────────────────────────────────

/**
 * 匹配 `[表情/打call]` 和 `[表情[大怨种]]` 两种格式。
 * 捕获组 1 = 表情名称。
 */
const EMOJI_PATTERN = /\[表情[\/\[]([^\]]+)[\]\]]/g;

export type EmojiModerationResult = "approve" | "reject" | null;

/**
 * 检查文本中是否包含 QQ 超级表情标记或 Unicode emoji，并返回审核建议。
 *
 * - 包含任意积极表情 → "approve"
 * - 包含任意消极表情 → "reject"（优先于积极）
 * - 无匹配 → null（不做自动处理）
 */
export function evaluateEmojiModeration(text: string): EmojiModerationResult {
  let hasApproved = false;
  let hasRejected = false;

  // 1. 匹配 QQ 超级表情文本标记 [表情/xxx] / [表情[xxx]]
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

  // 2. 匹配 Unicode emoji 字符
  for (const char of text) {
    if (REJECTED_EMOJI_CHARS.has(char)) {
      hasRejected = true;
    }
    if (APPROVED_EMOJI_CHARS.has(char)) {
      hasApproved = true;
    }
  }

  // 消极优先（审核从严）
  if (hasRejected) return "reject";
  if (hasApproved) return "approve";
  return null;
}

/**
 * 从 OneBot 消息段数组中提取所有 face 类型的表情名称，
 * 用于在消息处理早期补充到文本中一并审核。
 */
export function extractFaceNamesFromSegments(message: unknown): string[] {
  if (!Array.isArray(message)) {
    return [];
  }

  const names: string[] = [];
  for (const segment of message) {
    if (!segment || typeof segment !== "object") continue;
    const item = segment as { type?: string; data?: Record<string, unknown> };
    if (item.type === "face") {
      const text = item.data?.text;
      if (typeof text === "string" && text.length > 0) {
        names.push(text);
      }
    }
  }
  return names;
}
