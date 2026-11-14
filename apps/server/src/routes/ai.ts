import type { FastifyInstance } from "fastify";
import { PRIVATE_POST_PROMPT_MAX_LENGTH } from "@campux/domain";
import { z } from "zod";
import { requireTenantRole } from "../lib/auth";
import { writeAuditLog } from "../lib/audit";
import { readTenantAiSettings, testTenantAiSettings, updateTenantAiSettings, type AiRules } from "../runtime/ai-settings";
import { normalizePrivatePostKeywords } from "../lib/private-posting";

const privatePostKeywordList = z.array(z.string().trim().min(1).max(12)).max(20);

export const aiSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  mode: z.enum(["local", "llm"]).optional(),
  provider: z.string().trim().min(1).max(80).optional(),
  baseUrl: z.string().trim().url().optional(),
  model: z.string().trim().min(1).max(120).optional(),
  apiKey: z.string().optional(),
  clearApiKey: z.boolean().optional(),
  temperature: z.number().min(0).max(1).optional(),
  timeoutSeconds: z.number().int().min(5).max(120).optional(),
  rules: z.object({
    aiReviewMode: z.enum(["off", "shadow", "assist", "auto"]).optional(),
    aiReviewConcurrency: z.number().int().min(1).max(5).optional(),
    autoModeration: z.object({ enabled: z.boolean().optional(), globalKillSwitch: z.boolean().optional(), autoApproveEnabled: z.boolean().optional(), autoRejectEnabled: z.boolean().optional(), minimumConfidence: z.number().min(0.9).max(1).optional(), autoApproveMinimumConfidence: z.number().min(0.9).max(1).optional(), autoRejectMinimumConfidence: z.number().min(0.9).max(1).optional(),  delaySeconds: z.number().int().min(30).max(120).optional() }).optional(),
    aiReviewRules: z.object({ blockedPatterns: z.array(z.string().trim().min(1).max(160)).max(100).optional(), allowedCategories: z.array(z.string().trim().min(1).max(80)).max(40).optional(), tone: z.string().max(500).optional(), strictPrivacy: z.boolean().optional() }).optional(),
    privatePostAiEnabled: z.boolean().optional(),
    postTaggingEnabled: z.boolean().optional(),
    postTagMaintenanceEnabled: z.boolean().optional(),
    privatePostAggregateDelaySeconds: z.number().int().min(0).max(120).optional(),
    postTriggerKeywords: z.array(z.string().trim().min(1).max(30)).max(20).optional(),
    privatePostKeywords: z.object({
      start: privatePostKeywordList.optional(),
      anonymous: privatePostKeywordList.optional(),
      realname: privatePostKeywordList.optional(),
      cancel: privatePostKeywordList.optional(),
      finish: privatePostKeywordList.optional(),
      undo: privatePostKeywordList.optional(),
      confirm: privatePostKeywordList.optional(),
    }).optional(),
    privatePostPrompt: z.string().trim().max(PRIVATE_POST_PROMPT_MAX_LENGTH).optional(),
  }).optional(),
});

export function registerAiRoutes(app: FastifyInstance) {
  /** 鎶?schema 閲屽彲閫夌殑 7 缁勫叧閿瘝琛ユ垚瀹屾暣缁撴瀯锛氳皟鐢ㄦ柟鍙渶瑕佺粰鎯虫敼鐨勭粍銆?*/
  function normalizeRules(body: z.infer<typeof aiSettingsSchema>) {
    const rules: AiRules | undefined = body.rules
      ? {
        ...body.rules,
        privatePostKeywords: body.rules.privatePostKeywords
          ? normalizePrivatePostKeywords(body.rules.privatePostKeywords)
          : undefined,
      }
      : undefined;
    return { ...body, rules };
  }

  app.get("/api/admin/ai/settings", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    return {
      settings: await readTenantAiSettings(context.selectedTenant.id),
    };
  });

  app.patch("/api/admin/ai/settings", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    const body = normalizeRules(aiSettingsSchema.parse(request.body ?? {}));
    const settings = await updateTenantAiSettings(context.selectedTenant.id, body);

    await writeAuditLog({
      tenantId: context.selectedTenant.id,
      actorId: context.user.id,
      action: "tenant.ai.settings.update",
      targetType: "tenant",
      targetId: context.selectedTenant.id,
      detail: {
        fields: Object.keys(body).filter((key) => key !== "apiKey"),
        apiKeyUpdated: Boolean(body.apiKey || body.clearApiKey),
      },
    });

    return { settings };
  });

  app.post("/api/admin/ai/settings/test", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    const body = normalizeRules(aiSettingsSchema.parse(request.body ?? {}));
    const result = await testTenantAiSettings(context.selectedTenant.id, body);

    await writeAuditLog({
      tenantId: context.selectedTenant.id,
      actorId: context.user.id,
      action: "tenant.ai.settings.test",
      targetType: "tenant",
      targetId: context.selectedTenant.id,
      detail: {
        ok: result.ok,
        mode: result.mode,
        provider: result.provider,
        model: result.model,
        baseUrl: result.baseUrl,
        latencyMs: result.latencyMs,
      },
    });

    return { result };
  });
}
