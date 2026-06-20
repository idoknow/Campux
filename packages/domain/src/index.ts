import { z } from "zod";

export * from "./fonts";

export const PRIVATE_POST_PROMPT_MAX_LENGTH = 4_000;

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
