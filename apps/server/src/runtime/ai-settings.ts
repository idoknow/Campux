import { DEFAULT_PRIVATE_POST_PROMPT, PRIVATE_POST_PROMPT_MAX_LENGTH } from "@campux/domain";
import { DbNull, type Prisma } from "@campux/db";
import { prisma } from "../lib/prisma";
import { DEFAULT_PRIVATE_POST_KEYWORDS, normalizePrivatePostKeywords, type PrivatePostKeywords } from "../lib/private-posting";
import { decryptJson, encryptJson } from "../lib/secret-json";
import { assertSafeLlmUrl } from "./llm-url";
import { readBoundedLlmResponse } from "./post-review";
import { runWithActiveTenantLease } from "../lib/tenant-runtime-lease";

export type TenantAiSettingsPayload = {
  enabled: boolean;
  mode: "local" | "llm";
  /** 主通道的镜像字段：等于 providers[0]，保留给旧调用方和页面。 */
  provider: string;
  baseUrl: string;
  model: string;
  apiKeyConfigured: boolean;
  temperature: number;
  timeoutSeconds: number;
  /** 服务商通道列表，按顺序降级；第一个是主通道。 */
  providers: AiProviderEndpoint[];
  /** 已配置的密钥（只返回掩码，不回传明文）。 */
  apiKeys: AiApiKeySummary[];
  rules: AiRules;
};

/**
 * 一个服务商通道：同一个 baseUrl 下的一组模型（主模型 + 备用模型）。
 * 运行时会按 providers 顺序、模型顺序、密钥顺序逐个尝试。
 */
export type AiProviderEndpoint = {
  id: string;
  label: string;
  provider: string;
  baseUrl: string;
  /** 主模型 */
  model: string;
  /** 备用模型：主模型不可用时按顺序接着试 */
  fallbackModels: string[];
  /** 该通道可用的密钥 id；空数组表示所有密钥都可用 */
  keyIds: string[];
};

export type AiApiKeySummary = {
  id: string;
  label: string;
  masked: string;
};

/** 保存时的密钥输入：不填 value 表示沿用同 id 的旧密钥。 */
export type AiApiKeyInput = {
  id: string;
  label?: string | undefined;
  value?: string | undefined;
};

export type AiRules = {
  /** 服务商通道列表（主 + 备用模型 + 备用服务商），第一个是主通道 */
  aiProviders?: AiProviderEndpoint[] | undefined;
  /** Tenant moderation controls consumed by human-only AI review. */
  aiReviewRules?: {
    blockedPatterns?: string[] | undefined;
    allowedCategories?: string[] | undefined;
    tone?: string | undefined;
    strictPrivacy?: boolean | undefined;
  } | undefined;
  /** Whether to run review assistance after a post is submitted. */
  aiReviewMode?: "off" | "shadow" | "assist" | "auto" | undefined;
  /** 单租户同时进行的 AI 审核请求数上限（1-5）；超出的稿件排队等待，不丢弃。 */
  aiReviewConcurrency?: number | undefined;
  autoModeration?: {
    enabled?: boolean | undefined;
    globalKillSwitch?: boolean | undefined;
    autoApproveEnabled?: boolean | undefined;
    autoRejectEnabled?: boolean | undefined;
    blockedPatterns?: string[] | undefined;
    minimumConfidence?: number | undefined;
    autoApproveMinimumConfidence?: number | undefined;
    autoRejectMinimumConfidence?: number | undefined;
    delaySeconds?: number | undefined;
  } | undefined;
  /** 是否启用私聊投稿 AI 语义收稿 */
  privatePostAiEnabled?: boolean | undefined;
  /** 是否启用投稿后的 LLM 自动打标 */
  postTaggingEnabled?: boolean | undefined;
  /** 是否启用 LLM 定期维护标签库 */
  postTagMaintenanceEnabled?: boolean | undefined;
  /** 私聊 AI 聚合收稿等待秒数，0 表示不聚合 */
  privatePostAggregateDelaySeconds?: number | undefined;
  /** 对话投稿额外触发关键词，如 ["发帖", "吐槽", "表白"]，不含 # 前缀 */
  postTriggerKeywords?: string[] | undefined;
  /** 对话投稿各操作的关键词（允许不带 # 直接发送）；未配置时用内置默认值 */
  privatePostKeywords?: PrivatePostKeywords | undefined;
  /** 私聊投稿 AI 语义收稿的完整系统提示词，留空使用内置默认提示词 */
  privatePostPrompt?: string | undefined;
};

export type TenantAiSettingsUpdate = {
  enabled?: boolean | undefined;
  mode?: "local" | "llm" | undefined;
  provider?: string | undefined;
  baseUrl?: string | undefined;
  model?: string | undefined;
  /** 兼容旧客户端：单个密钥写入主密钥 */
  apiKey?: string | null | undefined;
  clearApiKey?: boolean | undefined;
  /** 服务商通道整表替换；省略表示不改 */
  providers?: AiProviderEndpoint[] | undefined;
  /** 密钥整表替换；不填 value 表示沿用同 id 的旧密钥 */
  apiKeys?: AiApiKeyInput[] | undefined;
  clearApiKeys?: boolean | undefined;
  temperature?: number | undefined;
  timeoutSeconds?: number | undefined;
  rules?: AiRules | undefined;
};

export type TenantAiSettingsTestResult = {
  ok: boolean;
  mode: "local" | "llm";
  provider: string;
  model: string;
  baseUrl: string;
  latencyMs: number | null;
  message: string;
};

/** 通道/模型/密钥的数量与长度上限：既防误填，也避免降级链过长。 */
export const AI_PROVIDERS_MAX = 4;
export const AI_FALLBACK_MODELS_MAX = 6;
export const AI_API_KEYS_MAX = 6;
export const AI_MODEL_MAX_LENGTH = 120;
export const AI_KEY_MAX_LENGTH = 400;
/** 一次请求最多尝试多少个 (通道, 模型, 密钥) 组合。 */
export const AI_LLM_ATTEMPTS_MAX = 12;

const defaultEndpoint: AiProviderEndpoint = {
  id: "default",
  label: "",
  provider: "openai_compatible",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4.1-mini",
  fallbackModels: [],
  keyIds: [],
};

const defaultAiSettings: TenantAiSettingsPayload = {
  enabled: true,
  mode: "local",
  provider: defaultEndpoint.provider,
  baseUrl: defaultEndpoint.baseUrl,
  model: defaultEndpoint.model,
  apiKeyConfigured: false,
  temperature: 0.2,
  timeoutSeconds: 30,
  providers: [defaultEndpoint],
  apiKeys: [],
  rules: {
    aiReviewMode: "off",
    aiReviewConcurrency: 2,
    autoModeration: { enabled: false, globalKillSwitch: false, autoApproveEnabled: false, autoRejectEnabled: false, minimumConfidence: 0.98, autoApproveMinimumConfidence: 0.98, autoRejectMinimumConfidence: 0.99, delaySeconds: 60 },
    privatePostAiEnabled: false,
    postTaggingEnabled: true,
    postTagMaintenanceEnabled: true,
    privatePostAggregateDelaySeconds: 8,
    postTriggerKeywords: [],
    privatePostKeywords: DEFAULT_PRIVATE_POST_KEYWORDS,
    privatePostPrompt: DEFAULT_PRIVATE_POST_PROMPT,
  },
};

export type TenantAiSettingsClient = Pick<Prisma.TransactionClient, "tenantAiSettings">;

export async function readTenantAiSettings(tenantId: string, client: TenantAiSettingsClient = prisma): Promise<TenantAiSettingsPayload> {
  const settings = await client.tenantAiSettings.findUnique({
    where: { tenantId },
  });
  if (!settings) {
    return defaultAiSettings;
  }

  const rules = normalizeAiRules(settings.rules);
  // 老租户只有 provider/baseUrl/model 三列：把它们折成唯一的主通道。
  const providers = rules.aiProviders?.length
    ? rules.aiProviders
    : [endpointFromColumns({ provider: settings.provider, baseUrl: settings.baseUrl, model: settings.model })];
  rules.aiProviders = providers;
  const primary = providers[0] ?? defaultEndpoint;
  const keys = normalizeStoredKeys(settings.apiKeySecret);

  return {
    enabled: settings.enabled,
    mode: normalizeMode(settings.mode),
    provider: primary.provider,
    baseUrl: primary.baseUrl,
    model: primary.model,
    apiKeyConfigured: keys.length > 0,
    temperature: clampNumber(settings.temperature, 0, 1, defaultAiSettings.temperature),
    timeoutSeconds: Math.max(5, Math.min(120, settings.timeoutSeconds)),
    providers,
    apiKeys: keys.map(toKeySummary),
    rules,
  };
}

export async function updateTenantAiSettings(
  tenantId: string,
  input: TenantAiSettingsUpdate,
) {
  const existing = await prisma.tenantAiSettings.findUnique({ where: { tenantId } });
  const apiKeySecret = resolveApiKeySecret(existing?.apiKeySecret ?? null, input);

  const currentRules = normalizeAiRules(existing?.rules ?? {});
  const currentProviders = currentRules.aiProviders?.length
    ? currentRules.aiProviders
    : [endpointFromColumns({
        provider: existing?.provider ?? defaultAiSettings.provider,
        baseUrl: existing?.baseUrl ?? defaultAiSettings.baseUrl,
        model: existing?.model ?? defaultAiSettings.model,
      })];

  // 通道列表：优先整表替换；旧字段（provider/baseUrl/model）只改主通道，保持镜像一致。
  const baseProviders = (input.providers ? normalizeAiProviders(input.providers) : currentProviders).slice(0, AI_PROVIDERS_MAX);
  const first = baseProviders[0] ?? defaultEndpoint;
  const primary: AiProviderEndpoint = {
    ...first,
    ...(input.provider === undefined ? {} : { provider: input.provider.trim().slice(0, 80) || first.provider }),
    ...(input.baseUrl === undefined ? {} : { baseUrl: normalizeBaseUrl(input.baseUrl) }),
    ...(input.model === undefined ? {} : { model: input.model.trim().slice(0, AI_MODEL_MAX_LENGTH) || first.model }),
  };
  const providers = [primary, ...baseProviders.slice(1)];
  const rulesInput: AiRules = { ...(input.rules ?? {}), aiProviders: providers };

  await prisma.tenantAiSettings.upsert({
    where: { tenantId },
    update: {
      ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
      ...(input.mode === undefined ? {} : { mode: normalizeMode(input.mode) }),
      provider: primary.provider,
      baseUrl: primary.baseUrl,
      model: primary.model,
      apiKeySecret,
      ...(input.temperature === undefined ? {} : { temperature: clampNumber(input.temperature, 0, 1, defaultAiSettings.temperature) }),
      ...(input.timeoutSeconds === undefined ? {} : { timeoutSeconds: Math.max(5, Math.min(120, input.timeoutSeconds)) }),
      rules: normalizeAiRules(mergeAiRules(existing?.rules, rulesInput)),
    },
    create: {
      tenantId,
      enabled: input.enabled ?? defaultAiSettings.enabled,
      mode: normalizeMode(input.mode ?? defaultAiSettings.mode),
      provider: primary.provider,
      baseUrl: primary.baseUrl,
      model: primary.model,
      apiKeySecret,
      temperature: clampNumber(input.temperature ?? defaultAiSettings.temperature, 0, 1, defaultAiSettings.temperature),
      timeoutSeconds: Math.max(5, Math.min(120, input.timeoutSeconds ?? defaultAiSettings.timeoutSeconds)),
      rules: normalizeAiRules(rulesInput),
    },
  });

  return readTenantAiSettings(tenantId);
}

export async function testTenantAiSettings(
  tenantId: string,
  input: TenantAiSettingsUpdate,
): Promise<TenantAiSettingsTestResult> {
  const current = await readTenantAiSettings(tenantId);
  const mode = normalizeMode(input.mode ?? current.mode);
  const provider = input.provider?.trim() || current.provider;
  const baseUrl = normalizeBaseUrl(input.baseUrl ?? current.baseUrl);
  const model = input.model?.trim() || current.model;
  const timeoutSeconds = Math.max(5, Math.min(120, input.timeoutSeconds ?? current.timeoutSeconds));

  if (mode !== "llm") {
    return {
      ok: true,
      mode,
      provider,
      model,
      baseUrl,
      latencyMs: null,
      message: "当前是本地模式，不需要连接 LLM。",
    };
  }

  const apiKey = await resolveTenantAiApiKey(tenantId, input);
  if (!apiKey) {
    return {
      ok: false,
      mode,
      provider,
      model,
      baseUrl,
      latencyMs: null,
      message: "未配置 LLM API Key。",
    };
  }
  const safeUrl = await assertSafeLlmUrl(baseUrl);
  const safeBaseUrl = safeUrl.toString().replace(/\/$/, "");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutSeconds * 1_000);
  const startedAt = Date.now();
  try {
    const leased = await runWithActiveTenantLease(prisma, tenantId, async () => {
      const response = await fetch(`${safeBaseUrl}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        redirect: "error",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          // 推理型模型会先消耗一部分 token 思考，32 容易在吐 JSON 之前就被截断。
          max_tokens: 128,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: "只返回 JSON。" },
            { role: "user", content: "请返回 {\"ok\":true,\"message\":\"ready\"}" },
          ],
        }),
      });
      const raw = await readBoundedLlmResponse(response, 16 * 1024);
      const data = JSON.parse(raw) as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } };
      return { response, data };
    });
    if (!leased.active) {
      return { ok: false, mode, provider, model, baseUrl, latencyMs: null, message: "校园墙已暂停或归档。" };
    }
    const { response, data } = leased.value;
    const latencyMs = Date.now() - startedAt;
    if (!response.ok) {
      return { ok: false, mode, provider, model, baseUrl, latencyMs, message: data.error?.message || `LLM 请求失败：${response.status}` };
    }
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      return {
        ok: false,
        mode,
        provider,
        model,
        baseUrl,
        latencyMs,
        message: "LLM 已响应，但没有返回内容。",
      };
    }
    return {
      ok: true,
      mode,
      provider,
      model,
      baseUrl,
      latencyMs,
      message: "LLM 配置可用。",
    };
  } catch (error) {
    return {
      ok: false,
      mode,
      provider,
      model,
      baseUrl,
      latencyMs: Date.now() - startedAt,
      message: error instanceof Error && error.name === "AbortError" ? "LLM 测试超时。" : error instanceof Error ? error.message : "LLM 测试失败。",
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function resolveTenantAiApiKey(
  tenantId: string,
  input: Pick<TenantAiSettingsUpdate, "apiKey" | "clearApiKey" | "apiKeys" | "clearApiKeys">,
  client: TenantAiSettingsClient = prisma,
) {
  const fromInput = input.apiKeys?.[0]?.value?.trim();
  if (fromInput) {
    return fromInput;
  }
  if (input.apiKey && input.apiKey.trim().length > 0) {
    return input.apiKey.trim();
  }
  if (input.clearApiKey || input.clearApiKeys) {
    return "";
  }
  const keys = await readTenantAiApiKeys(tenantId, client);
  return keys[0]?.value ?? "";
}

/** 读出全部密钥明文（仅在服务端使用；对外只给掩码）。 */
export async function readTenantAiApiKeys(
  tenantId: string,
  client: TenantAiSettingsClient = prisma,
): Promise<StoredAiApiKey[]> {
  const settings = await client.tenantAiSettings.findUnique({ where: { tenantId } });
  return normalizeStoredKeys(settings?.apiKeySecret ?? null);
}

export type StoredAiApiKey = { id: string; label: string; value: string };

export function maskApiKey(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 8) {
    return "••••";
  }
  return `${trimmed.slice(0, 3)}…${trimmed.slice(-4)}`;
}

function toKeySummary(key: StoredAiApiKey): AiApiKeySummary {
  return { id: key.id, label: key.label, masked: maskApiKey(key.value) };
}

/** 兼容旧的 `{ apiKey }` 结构：自动折成一条 id=default 的密钥。 */
function normalizeStoredKeys(raw: unknown): StoredAiApiKey[] {
  const value = raw && typeof raw === "object" && !Array.isArray(raw) ? decryptSafe(raw) : null;
  const candidate = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const list = Array.isArray(candidate.keys) ? candidate.keys : [];
  const keys: StoredAiApiKey[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const secret = typeof record.value === "string" ? record.value.trim().slice(0, AI_KEY_MAX_LENGTH) : "";
    if (!secret) continue;
    keys.push({
      id: normalizeKeyId(record.id) || `key_${keys.length + 1}`,
      label: typeof record.label === "string" ? record.label.trim().slice(0, 40) : "",
      value: secret,
    });
    if (keys.length >= AI_API_KEYS_MAX) break;
  }
  if (keys.length > 0) {
    return keys;
  }
  const legacy = typeof candidate.apiKey === "string" ? candidate.apiKey.trim().slice(0, AI_KEY_MAX_LENGTH) : "";
  return legacy ? [{ id: "default", label: "", value: legacy }] : [];
}

function decryptSafe(value: unknown) {
  try {
    return decryptJson(value as Prisma.JsonValue);
  } catch {
    return null;
  }
}

function normalizeKeyId(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/[^\w-]/g, "").slice(0, 40);
}

/** 密钥整表替换：value 为空表示沿用同 id 的旧值，新 id 没值直接忽略。 */
function resolveApiKeySecret(existingSecret: unknown, input: TenantAiSettingsUpdate): Prisma.InputJsonValue | typeof DbNull {
  const current = normalizeStoredKeys(existingSecret);
  if (input.clearApiKeys) {
    return DbNull;
  }
  if (input.apiKeys) {
    const next: StoredAiApiKey[] = [];
    for (const entry of input.apiKeys.slice(0, AI_API_KEYS_MAX)) {
      const id = normalizeKeyId(entry.id) || `key_${next.length + 1}`;
      const kept = current.find((key) => key.id === id);
      const value = (entry.value ?? "").trim().slice(0, AI_KEY_MAX_LENGTH) || kept?.value || "";
      if (!value) continue;
      const label = (entry.label ?? kept?.label ?? "").trim().slice(0, 40);
      next.push({ id, label, value });
    }
    return next.length > 0 ? encryptJson({ keys: next }) : DbNull;
  }
  if (input.clearApiKey) {
    return DbNull;
  }
  if (input.apiKey && input.apiKey.trim().length > 0) {
    const value = input.apiKey.trim().slice(0, AI_KEY_MAX_LENGTH);
    const next = [{ id: current[0]?.id ?? "default", label: current[0]?.label ?? "", value }, ...current.slice(1)];
    return encryptJson({ keys: next });
  }
  return existingSecret ? (existingSecret as Prisma.InputJsonValue) : DbNull;
}

/** 老租户只有 provider/baseUrl/model 三列时，折成唯一的主通道。 */
function endpointFromColumns(columns: { provider: string; baseUrl: string; model: string }): AiProviderEndpoint {
  return {
    id: "default",
    label: "",
    provider: columns.provider.trim().slice(0, 80) || defaultEndpoint.provider,
    baseUrl: normalizeBaseUrl(columns.baseUrl),
    model: columns.model.trim().slice(0, AI_MODEL_MAX_LENGTH) || defaultEndpoint.model,
    fallbackModels: [],
    keyIds: [],
  };
}

/**
 * 规范化通道列表：去掉空项、去重 baseUrl+model、截断超长字段。
 * 空数组合法（调用方会回落到三列镜像）。
 */
export function normalizeAiProviders(value: unknown): AiProviderEndpoint[] {
  if (!Array.isArray(value)) return [];
  const providers: AiProviderEndpoint[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const baseUrl = typeof record.baseUrl === "string" ? normalizeBaseUrl(record.baseUrl) : "";
    const model = typeof record.model === "string" ? record.model.trim().slice(0, AI_MODEL_MAX_LENGTH) : "";
    if (!baseUrl || !model) continue;
    const provider = typeof record.provider === "string" && record.provider.trim() ? record.provider.trim().slice(0, 80) : "openai_compatible";
    const dedupeKey = `${baseUrl}::${model.toLowerCase()}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const fallbackModels: string[] = [];
    if (Array.isArray(record.fallbackModels)) {
      for (const item of record.fallbackModels) {
        if (typeof item !== "string") continue;
        const trimmed = item.trim().slice(0, AI_MODEL_MAX_LENGTH);
        if (!trimmed || trimmed.toLowerCase() === model.toLowerCase() || fallbackModels.includes(trimmed)) continue;
        fallbackModels.push(trimmed);
        if (fallbackModels.length >= AI_FALLBACK_MODELS_MAX) break;
      }
    }
    const keyIds: string[] = [];
    if (Array.isArray(record.keyIds)) {
      for (const item of record.keyIds) {
        const id = normalizeKeyId(item);
        if (id && !keyIds.includes(id)) keyIds.push(id);
        if (keyIds.length >= AI_API_KEYS_MAX) break;
      }
    }
    providers.push({
      id: normalizeKeyId(record.id) || `ep_${providers.length + 1}`,
      label: typeof record.label === "string" ? record.label.trim().slice(0, 60) : "",
      provider,
      baseUrl,
      model,
      fallbackModels,
      keyIds,
    });
    if (providers.length >= AI_PROVIDERS_MAX) break;
  }
  return providers;
}

/**
 * PATCH 里的 rules 是部分更新：先用库里已存的规则打底再合并，否则未提交的字段会被
 * 默认值清空（例：只改 aiReviewConcurrency，却把 aiReviewMode 重置成 off）。
 * 只做一层深合并——autoModeration / aiReviewRules 这类嵌套对象同样按字段合并。
 */
export function mergeAiRules(existing: unknown, update: unknown): unknown {
  const base = existing && typeof existing === "object" && !Array.isArray(existing) ? (existing as Record<string, unknown>) : {};
  if (!update || typeof update !== "object" || Array.isArray(update)) return base;
  const patch = update as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...base, ...patch };
  for (const [key, value] of Object.entries(patch)) {
    const current = base[key];
    if (value && typeof value === "object" && !Array.isArray(value) && current && typeof current === "object" && !Array.isArray(current)) {
      merged[key] = { ...(current as Record<string, unknown>), ...(value as Record<string, unknown>) };
    }
  }
  return merged;
}

export function normalizeAiRules(value: unknown): AiRules {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return defaultAiSettings.rules;
  }
  const candidate = value as Record<string, unknown>;
  return {
    aiProviders: normalizeAiProviders(candidate.aiProviders),
    privatePostAiEnabled: typeof candidate.privatePostAiEnabled === "boolean" ? candidate.privatePostAiEnabled : defaultAiSettings.rules.privatePostAiEnabled,
    aiReviewMode: candidate.aiReviewMode === "shadow" || candidate.aiReviewMode === "assist" || candidate.aiReviewMode === "auto" ? candidate.aiReviewMode : "off",
    aiReviewConcurrency: normalizeNumber(candidate.aiReviewConcurrency, 1, 5, defaultAiSettings.rules.aiReviewConcurrency ?? 2),
    autoModeration: normalizeAutoModeration(candidate.autoModeration),
    aiReviewRules: normalizeAiReviewRules(candidate.aiReviewRules),
    postTaggingEnabled: typeof candidate.postTaggingEnabled === "boolean" ? candidate.postTaggingEnabled : defaultAiSettings.rules.postTaggingEnabled,
    postTagMaintenanceEnabled: typeof candidate.postTagMaintenanceEnabled === "boolean" ? candidate.postTagMaintenanceEnabled : defaultAiSettings.rules.postTagMaintenanceEnabled,
    privatePostAggregateDelaySeconds: normalizeNumber(candidate.privatePostAggregateDelaySeconds, 0, 120, defaultAiSettings.rules.privatePostAggregateDelaySeconds ?? 8),
    postTriggerKeywords: normalizeStringArray(candidate.postTriggerKeywords ?? defaultAiSettings.rules.postTriggerKeywords),
    privatePostKeywords: normalizePrivatePostKeywords(candidate.privatePostKeywords),
    privatePostPrompt: normalizePrivatePostPrompt(candidate.privatePostPrompt),
  };
}

function normalizeAutoModeration(value: unknown): NonNullable<AiRules["autoModeration"]> {
  const candidate = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    enabled: candidate.enabled === true,
    globalKillSwitch: candidate.globalKillSwitch === true,
    autoApproveEnabled: candidate.autoApproveEnabled === true,
    autoRejectEnabled: candidate.autoRejectEnabled === true,
    minimumConfidence: clampNumber(candidate.minimumConfidence, 0.9, 1, 0.98),
    autoApproveMinimumConfidence: clampNumber(candidate.autoApproveMinimumConfidence, 0.9, 1, 0.98),
    autoRejectMinimumConfidence: clampNumber(candidate.autoRejectMinimumConfidence, 0.9, 1, 0.99),
    delaySeconds: normalizeNumber(candidate.delaySeconds, 30, 120, 60),
  };
}

function normalizeAiReviewRules(value: unknown): NonNullable<AiRules["aiReviewRules"]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { blockedPatterns: [], allowedCategories: [], tone: "", strictPrivacy: true };
  const candidate = value as Record<string, unknown>;
  return {
    blockedPatterns: normalizeStringArray(candidate.blockedPatterns).slice(0, 100).map((item) => item.slice(0, 160)),
    allowedCategories: normalizeStringArray(candidate.allowedCategories).slice(0, 40).map((item) => item.slice(0, 80)),
    tone: typeof candidate.tone === "string" ? candidate.tone.trim().slice(0, 500) : "",
    strictPrivacy: candidate.strictPrivacy !== false,
  };
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean) : [];
}

function normalizePrivatePostPrompt(value: unknown) {
  if (typeof value !== "string") {
    return defaultAiSettings.rules.privatePostPrompt;
  }
  const trimmed = value.trim().slice(0, PRIVATE_POST_PROMPT_MAX_LENGTH);
  return trimmed || defaultAiSettings.rules.privatePostPrompt;
}

function normalizeNumber(value: unknown, min: number, max: number, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.trunc(value))) : fallback;
}

function normalizeMode(value: unknown): "local" | "llm" {
  return value === "llm" ? "llm" : "local";
}

export function normalizeBaseUrl(value: string) {
  return (value.trim() || defaultAiSettings.baseUrl).replace(/\/+$/, "");
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : fallback;
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, numeric));
}
