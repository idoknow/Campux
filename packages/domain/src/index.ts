import { z } from "zod";

export * from "./fonts";

export const PRIVATE_POST_PROMPT_MAX_LENGTH = 4_000;
export const DEFAULT_PRIVATE_POST_PROMPT = [
  "你是校园墙 QQ 私聊投稿语义解析器。只返回 JSON，不要 Markdown。",
  "任务：基于整句语义和上下文判断是否是稿件、提取最终投稿正文、自动分段、判断匿名/实名、判断是否已经表达提交。",
  "返回标准格式：{\"intent\":\"post|chat|command\",\"text\":\"最终正文\",\"anonymous\":true|false|null,\"shouldSubmit\":true|false,\"sections\":[\"分段1\"],\"confidence\":0到1,\"reason\":\"简短原因\"}。",
  "请判断以下内容是否为校园墙稿件；如果是稿件，intent=post，并把适合发布的正文放入 text 和 sections；如果不是稿件，intent=chat；如果明显是机器人命令，intent=command。",
  "不要用关键词表或单个词命中做判断；必须理解用户真实意图，例如咨询如何匿名、注册、重置密码、闲聊、机器人命令都不是稿件。",
  "只有用户表达的是希望墙号发布/代发/匿名发布/发到校园墙，或发送了可直接发布的明确稿件正文时，才判定为 post。",
  "单纯好奇、闲聊、询问大家情况、聊天式问题、对机器人或墙号流程的咨询，即使提到学校/高考/食堂/老师，也不要判定为稿件，除非语境明确是在让墙号发布。",
  "anonymous 表示用户希望本条投稿如何发布：明确希望匿名则 true，明确希望署名/实名则 false，未表达则 null。",
  "如果 hasCurrentDraft=true 且用户本轮只是在表达匿名/实名选择（例如：匿名、别显示名字、用实名、可以署名），也要基于语义设置 anonymous；text 保留 currentDraftText，不要把这句话追加进正文。",
  "shouldSubmit 表示用户是否已经表达可以结束并提交当前投稿；没有明确完成意图时必须 false。",
  "text 只能包含适合发布到校园墙的正文；去掉对机器人的请求、匿名/实名要求、提交指令、解释性废话和非正文信息。",
  "sections 是按语义自然分段后的正文段落；如果不是稿件，text 为空、sections 为空、shouldSubmit=false。",
].join("\n");

export const tenantStatusSchema = z.enum(["active", "paused", "archived"]);
export type TenantStatus = z.infer<typeof tenantStatusSchema>;

export const systemRoleSchema = z.enum(["operations_admin", "system_operator"]);
export type SystemRole = z.infer<typeof systemRoleSchema>;

export const tenantRoleSchema = z.enum(["submitter", "reviewer", "admin"]);
export type TenantRole = z.infer<typeof tenantRoleSchema>;

export const postStatusSchema = z.enum([
  "pending_approval",
  "approved",
  "rejected",
  "cancelled",
  "publishing",
  "partially_failed",
  "failed",
  "published",
  "pending_recall",
  "recalled",
]);
export type PostStatus = z.infer<typeof postStatusSchema>;

export const publishAttemptStatusSchema = z.enum([
  "queued",
  "running",
  "waiting_cookies",
  "succeeded",
  "failed",
  "skipped",
]);
export type PublishAttemptStatus = z.infer<typeof publishAttemptStatusSchema>;

export const postBgColorSchema = z.enum(["white", "pink", "blue", "green", "yellow", "orange", "purple"]);
export type PostBgColor = z.infer<typeof postBgColorSchema>;
export const postBgColorMap: Record<PostBgColor, string> = {
  white: "#FFFFFF",
  pink: "#FFE4E1",
  blue: "#E0F0FF",
  green: "#E0FFE0",
  yellow: "#FFFDE0",
  orange: "#FFE8D0",
  purple: "#F0E0FF",
};

export const postTextColorSchema = z.enum(["black", "dark_red", "dark_blue", "dark_green", "dark_pink", "dark_purple", "dark_orange"]);
export type PostTextColor = z.infer<typeof postTextColorSchema>;
export const postTextColorMap: Record<PostTextColor, string> = {
  black: "#1a1a1a",
  dark_red: "#8B0000",
  dark_blue: "#00008B",
  dark_green: "#006400",
  dark_pink: "#C71585",
  dark_purple: "#4B0082",
  dark_orange: "#CC5500",
};

export const tenantSummarySchema = z.object({
  id: z.string(),
  slug: z.string(),
  host: z.string().nullable(),
  name: z.string(),
  status: tenantStatusSchema,
  themeColor: z.string(),
  logoUrl: z.string(),
  aiEnabled: z.boolean(),
  ready: z.boolean(),
  readyAt: z.string().nullable(),
  botAccountCount: z.number().int().nonnegative(),
  pendingPostCount: z.number().int().nonnegative(),
});
export type TenantSummary = z.infer<typeof tenantSummarySchema>;
