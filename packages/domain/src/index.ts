import { z } from "zod";

export const tenantStatusSchema = z.enum(["active", "paused", "archived"]);
export type TenantStatus = z.infer<typeof tenantStatusSchema>;

export const systemRoleSchema = z.enum(["system_operator"]);
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
  "succeeded",
  "failed",
  "skipped",
]);
export type PublishAttemptStatus = z.infer<typeof publishAttemptStatusSchema>;

export const tenantSummarySchema = z.object({
  id: z.string(),
  slug: z.string(),
  host: z.string().nullable(),
  name: z.string(),
  status: tenantStatusSchema,
  themeColor: z.string(),
  botAccountCount: z.number().int().nonnegative(),
  pendingPostCount: z.number().int().nonnegative(),
});
export type TenantSummary = z.infer<typeof tenantSummarySchema>;
