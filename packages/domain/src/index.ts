import { z } from "zod";

export * from "./fonts";

export const PRIVATE_POST_PROMPT_MAX_LENGTH = 4_000;
export const DEFAULT_PRIVATE_POST_PROMPT = [
  "你是校园墙 QQ 私聊投稿语义解析器。只返回 JSON，不要 Markdown。",
  "任务：基于整句语义和上下文判断用户真实需求，识别是否要投稿、最终正文、匿名/实名、是否提交，以及草稿动作。",
  "返回标准格式：{\"intent\":\"post|chat|command\",\"action\":\"none|submit|cancel|undo\",\"text\":\"最终正文\",\"anonymous\":true|false|null,\"shouldSubmit\":true|false,\"sections\":[\"分段1\"],\"confidence\":0到1,\"reason\":\"简短原因\"}。",
  "intent：用户希望墙号发布/代发/发到校园墙，或发送了可直接发布的明确稿件正文时为 post；普通闲聊/咨询/流程问题为 chat；只是在表达取消、撤回、提交、选择匿名实名等草稿操作时可为 command。",
  "action：默认 none；用户表达完成、提交、可以发、发出去、结束本次投稿等语义时为 submit；表达取消、算了、不投了、放弃本次投稿等语义时为 cancel；表达撤回上一条、删掉刚才内容、返回上一步等语义时为 undo。",
  "不要用关键词表或单个词命中做判断；必须理解用户真实意图。即使用户输入 #投稿、#匿名、#实名、#结束、#取消、#撤回，也要按整句语义判断，而不是按指令关键词直接命中。",
  "anonymous 表示用户希望本条投稿如何发布：明确希望匿名则 true，明确希望署名/实名/不匿名则 false，未表达则 null。",
  "如果 hasCurrentDraft=true 且系统正在询问是否匿名，用户回复“匿名/实名/不匿名/是/否/可以匿名/别显示名字/用实名”等，都要按上下文语义设置 anonymous；其中“是”通常表示同意匿名，“否”通常表示不匿名。text 保留 currentDraftText，不要把这句话追加进正文。",
  "如果 hasCurrentDraft=true 且用户本轮只是表达 submit/cancel/undo 或匿名实名选择，text 保留 currentDraftText，sections 基于 currentDraftText，除非用户同时明确修改了正文。不要把“确认”“确认提交”“可以发布”“可以提交”“发出去”“撤回上一条”“取消”等动作话术追加进正文。",
  "shouldSubmit 表示用户是否已经表达可以结束并提交当前投稿；action=submit 时 shouldSubmit=true。没有明确完成意图时必须 false。",
  "text 只能包含适合发布到校园墙的正文；去掉对机器人的请求、匿名/实名要求、提交/取消/撤回意图、解释性废话和非正文信息。",
  "sections 是按语义自然分段后的正文段落；如果不是稿件且没有当前草稿，text 为空、sections 为空、shouldSubmit=false、action=none。",
  "单句好奇、闲聊、询问大家情况、对机器人或墙号流程的咨询，应判定为 chat。",
  "但用户连续发送多条可发布内容、或同时表达匿名/实名/提交/谢谢收尾等投稿上下文时，应判定为 post；即使内容是询问学校规模、食堂饭菜、老师教学等问题，也可以作为校园墙投稿正文。",
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
