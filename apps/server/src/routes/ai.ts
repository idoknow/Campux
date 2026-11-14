import type { FastifyInstance } from "fastify";
import { PRIVATE_POST_PROMPT_MAX_LENGTH } from "@campux/domain";
import { z } from "zod";
import { requireTenantRole } from "../lib/auth";
import { writeAuditLog } from "../lib/audit";
import {
  AI_API_KEYS_MAX,
  AI_FALLBACK_MODELS_MAX,
  AI_MODEL_MAX_LENGTH,
  AI_PROVIDERS_MAX,
  readTenantAiApiKeys,
  readTenantAiSettings,
  testTenantAiSettings,
  updateTenantAiSettings,
  type AiApiKeyInput,
  type AiProviderEndpoint,
  type AiRules,
} from "../runtime/ai-settings";
import { normalizePrivatePostKeywords } from "../lib/private-posting";
import { assertSafeLlmUrl } from "../runtime/llm-url";
import { readBoundedLlmResponse } from "../runtime/post-review";

const privatePostKeywordList = z.array(z.string().trim().min(1).max(12)).max(20);

/** 一个服务商通道：同一 baseUrl 下的主模型 + 备用模型。 */
const aiProviderEndpointSchema = z.object({
  id: z.string().trim().max(40).optional(),
  label: z.string().trim().max(60).optional(),
  provider: z.string().trim().max(80).optional(),
  baseUrl: z.string().trim().url().max(500),
  model: z.string().trim().min(1).max(AI_MODEL_MAX_LENGTH),
  fallbackModels: z.array(z.string().trim().min(1).max(AI_MODEL_MAX_LENGTH)).max(AI_FALLBACK_MODELS_MAX).optional(),
  keyIds: z.array(z.string().trim().min(1).max(40)).max(AI_API_KEYS_MAX).optional(),
});

/** 密钥：value 留空表示沿用同 id 的旧密钥。 */
const aiApiKeySchema = z.object({
  id: z.string().trim().max(40).optional(),
  label: z.string().trim().max(40).optional(),
  value: z.string().trim().max(400).optional(),
});

export const aiSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  mode: z.enum(["local", "llm"]).optional(),
  provider: z.string().trim().min(1).max(80).optional(),
  baseUrl: z.string().trim().url().optional(),
  model: z.string().trim().min(1).max(120).optional(),
  apiKey: z.string().optional(),
  clearApiKey: z.boolean().optional(),
  providers: z.array(aiProviderEndpointSchema).max(AI_PROVIDERS_MAX).optional(),
  apiKeys: z.array(aiApiKeySchema).max(AI_API_KEYS_MAX).optional(),
  clearApiKeys: z.boolean().optional(),
  temperature: z.number().min(0).max(1).optional(),
  timeoutSeconds: z.number().int().min(5).max(120).optional(),
  rules: z.object({
    aiProviders: z.array(aiProviderEndpointSchema).max(AI_PROVIDERS_MAX).optional(),
    aiReviewMode: z.enum(["off", "shadow", "assist", "auto"]).optional(),
    aiReviewConcurrency: z.number().int().min(1).max(5).optional(),
    autoModeration: z.object({ enabled: z.boolean().optional(), globalKillSwitch: z.boolean().optional(), autoApproveEnabled: z.boolean().optional(), autoRejectEnabled: z.boolean().optional(), minimumConfidence: z.number().min(0.9).max(1).optional(), autoApproveMinimumConfidence: z.number().min(0.9).max(1).optional(), autoRejectMinimumConfidence: z.number().min(0.9).max(1).optional(), delaySeconds: z.number().int().min(30).max(120).optional() }).optional(),
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

const modelsRequestSchema = z.object({
  baseUrl: z.string().trim().url().max(500),
  apiKey: z.string().trim().max(400).optional(),
  keyId: z.string().trim().max(40).optional(),
});

type EndpointInput = z.infer<typeof aiProviderEndpointSchema>;

function toEndpoint(value: EndpointInput, index: number): AiProviderEndpoint {
  return {
    id: value.id?.trim() || `ep_${index + 1}`,
    label: value.label?.trim() ?? "",
    provider: value.provider?.trim() || "openai_compatible",
    baseUrl: value.baseUrl,
    model: value.model,
    fallbackModels: value.fallbackModels ?? [],
    keyIds: value.keyIds ?? [],
  };
}

function toApiKeyInput(value: z.infer<typeof aiApiKeySchema>, index: number): AiApiKeyInput {
  return {
    id: value.id?.trim() || `key_${index + 1}`,
    label: value.label,
    value: value.value,
  };
}

function normalizeEndpoints(list: EndpointInput[] | undefined): AiProviderEndpoint[] | undefined {
  return list === undefined ? undefined : list.map(toEndpoint);
}

export function registerAiRoutes(app: FastifyInstance) {
  /** 把 schema 里可选的 7 组补成完整结构：调用方只需要给想改的组。 */
  function normalizeRules(body: z.infer<typeof aiSettingsSchema>) {
    const rules: AiRules | undefined = body.rules
      ? {
        ...body.rules,
        aiProviders: normalizeEndpoints(body.rules.aiProviders),
        privatePostKeywords: body.rules.privatePostKeywords
          ? normalizePrivatePostKeywords(body.rules.privatePostKeywords)
          : undefined,
      }
      : undefined;
    return {
      ...body,
      providers: normalizeEndpoints(body.providers),
      apiKeys: body.apiKeys?.map(toApiKeyInput),
      rules,
    };
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
        fields: Object.keys(body).filter((key) => key !== "apiKey" && key !== "apiKeys"),
        apiKeyUpdated: Boolean(body.apiKey || body.clearApiKey || body.clearApiKeys || body.apiKeys?.some((key) => (key.value ?? "").length > 0)),
        providerCount: body.providers?.length ?? null,
        apiKeyCount: body.apiKeys?.length ?? null,
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

  /**
   * 拉取服务商的模型列表（OpenAI 兼容的 GET /models）。
   * 密钥优先级：本次表单里填的明文 → 指定 keyId → 任意一个已保存的密钥。
   * 这样管理员可以先填地址和密钥试拉，不必先保存。
   */
  app.post("/api/admin/ai/models", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    const body = modelsRequestSchema.parse(request.body ?? {});

    let apiKey = body.apiKey?.trim() ?? "";
    if (!apiKey) {
      const keys = await readTenantAiApiKeys(context.selectedTenant.id);
      apiKey = (body.keyId ? keys.find((key) => key.id === body.keyId)?.value : undefined) ?? keys[0]?.value ?? "";
    }
    if (!apiKey) {
      return reply.code(400).send({ ok: false, models: [], message: "请先填写 API 密钥，或先保存一个密钥。" });
    }

    try {
      const origin = await assertSafeLlmUrl(body.baseUrl);
      const endpoint = `${origin.toString().replace(/\/+$/, "")}/models`;
      const response = await fetch(endpoint, {
        headers: { authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(15_000),
      });

      if (!response.ok) {
        const detail = await readBoundedLlmResponse(response, 2 * 1024).catch(() => "");
        return reply.code(502).send({
          ok: false,
          models: [],
          message: `HTTP ${response.status}${detail ? `：${detail.slice(0, 200)}` : ""}`,
        });
      }

      const raw = await readBoundedLlmResponse(response, 256 * 1024);
      const parsed = JSON.parse(raw) as { data?: Array<{ id?: unknown; owned_by?: unknown; ownedBy?: unknown }> };
      const seen = new Set<string>();
      const models: Array<{ id: string; ownedBy: string }> = [];
      for (const entry of Array.isArray(parsed.data) ? parsed.data : []) {
        const id = typeof entry?.id === "string" ? entry.id.trim() : "";
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const ownedBy = typeof entry?.owned_by === "string" ? entry.owned_by : typeof entry?.ownedBy === "string" ? entry.ownedBy : "";
        models.push({ id, ownedBy });
        if (models.length >= 300) break;
      }
      models.sort((a, b) => a.id.localeCompare(b.id));

      await writeAuditLog({
        tenantId: context.selectedTenant.id,
        actorId: context.user.id,
        action: "tenant.ai.models.list",
        targetType: "tenant",
        targetId: context.selectedTenant.id,
        detail: { ok: true, baseUrl: body.baseUrl, count: models.length },
      });

      return { ok: true, models, message: `找到 ${models.length} 个模型` };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(400).send({ ok: false, models: [], message });
    }
  });
}
