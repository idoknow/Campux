import { DEFAULT_PRIVATE_POST_PROMPT, PRIVATE_POST_PROMPT_MAX_LENGTH } from "@campux/domain";
import { DbNull } from "@campux/db";
import { prisma } from "../lib/prisma";
import { decryptJson, encryptJson } from "../lib/secret-json";

export type TenantAiSettingsPayload = {
  enabled: boolean;
  mode: "local" | "llm";
  provider: string;
  baseUrl: string;
  model: string;
  apiKeyConfigured: boolean;
  temperature: number;
  timeoutSeconds: number;
  rules: AiRules;
};

export type AiRules = {
  /** 是否启用私聊投稿 AI 语义收稿 */
  privatePostAiEnabled?: boolean | undefined;
  /** 私聊 AI 聚合收稿等待秒数，0 表示不聚合 */
  privatePostAggregateDelaySeconds?: number | undefined;
  /** 对话投稿额外触发关键词，如 ["发帖", "吐槽", "表白"]，不含 # 前缀 */
  postTriggerKeywords?: string[] | undefined;
  /** 私聊投稿 AI 语义收稿的完整系统提示词，留空使用内置默认提示词 */
  privatePostPrompt?: string | undefined;
};

export type TenantAiSettingsUpdate = {
  enabled?: boolean | undefined;
  mode?: "local" | "llm" | undefined;
  provider?: string | undefined;
  baseUrl?: string | undefined;
  model?: string | undefined;
  apiKey?: string | null | undefined;
  clearApiKey?: boolean | undefined;
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

const defaultAiSettings: TenantAiSettingsPayload = {
  enabled: true,
  mode: "local",
  provider: "openai_compatible",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4.1-mini",
  apiKeyConfigured: false,
  temperature: 0.2,
  timeoutSeconds: 30,
  rules: {
    privatePostAiEnabled: false,
    privatePostAggregateDelaySeconds: 8,
    postTriggerKeywords: [],
    privatePostPrompt: DEFAULT_PRIVATE_POST_PROMPT,
  },
};

export async function readTenantAiSettings(tenantId: string): Promise<TenantAiSettingsPayload> {
  const settings = await prisma.tenantAiSettings.findUnique({
    where: { tenantId },
  });
  if (!settings) {
    return defaultAiSettings;
  }

  return {
    enabled: settings.enabled,
    mode: normalizeMode(settings.mode),
    provider: settings.provider,
    baseUrl: settings.baseUrl,
    model: settings.model,
    apiKeyConfigured: Boolean(settings.apiKeySecret),
    temperature: clampNumber(settings.temperature, 0, 1, defaultAiSettings.temperature),
    timeoutSeconds: Math.max(5, Math.min(120, settings.timeoutSeconds)),
    rules: normalizeAiRules(settings.rules),
  };
}

export async function updateTenantAiSettings(
  tenantId: string,
  input: TenantAiSettingsUpdate,
) {
  const existing = await prisma.tenantAiSettings.findUnique({ where: { tenantId } });
  const apiKeySecret =
    input.clearApiKey
      ? DbNull
      : input.apiKey && input.apiKey.trim().length > 0
        ? encryptJson({ apiKey: input.apiKey.trim() })
        : existing?.apiKeySecret ?? DbNull;

  await prisma.tenantAiSettings.upsert({
    where: { tenantId },
    update: {
      ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
      ...(input.mode === undefined ? {} : { mode: normalizeMode(input.mode) }),
      ...(input.provider === undefined ? {} : { provider: input.provider }),
      ...(input.baseUrl === undefined ? {} : { baseUrl: normalizeBaseUrl(input.baseUrl) }),
      ...(input.model === undefined ? {} : { model: input.model.trim() || defaultAiSettings.model }),
      apiKeySecret,
      ...(input.temperature === undefined ? {} : { temperature: clampNumber(input.temperature, 0, 1, defaultAiSettings.temperature) }),
      ...(input.timeoutSeconds === undefined ? {} : { timeoutSeconds: Math.max(5, Math.min(120, input.timeoutSeconds)) }),
      ...(input.rules === undefined ? {} : { rules: normalizeAiRules(input.rules) }),
    },
    create: {
      tenantId,
      enabled: input.enabled ?? defaultAiSettings.enabled,
      mode: normalizeMode(input.mode ?? defaultAiSettings.mode),
      provider: input.provider ?? defaultAiSettings.provider,
      baseUrl: normalizeBaseUrl(input.baseUrl ?? defaultAiSettings.baseUrl),
      model: input.model?.trim() || defaultAiSettings.model,
      apiKeySecret,
      temperature: clampNumber(input.temperature ?? defaultAiSettings.temperature, 0, 1, defaultAiSettings.temperature),
      timeoutSeconds: Math.max(5, Math.min(120, input.timeoutSeconds ?? defaultAiSettings.timeoutSeconds)),
      rules: normalizeAiRules(input.rules ?? defaultAiSettings.rules),
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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutSeconds * 1_000);
  const startedAt = Date.now();
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 32,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "只返回 JSON。",
          },
          {
            role: "user",
            content: "请返回 {\"ok\":true,\"message\":\"ready\"}",
          },
        ],
      }),
    });
    const latencyMs = Date.now() - startedAt;
    const data = await response.json().catch(() => null) as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } } | null;
    if (!response.ok) {
      return {
        ok: false,
        mode,
        provider,
        model,
        baseUrl,
        latencyMs,
        message: data?.error?.message || `LLM 请求失败：${response.status}`,
      };
    }
    const content = data?.choices?.[0]?.message?.content;
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

export async function resolveTenantAiApiKey(tenantId: string, input: Pick<TenantAiSettingsUpdate, "apiKey" | "clearApiKey">) {
  if (input.apiKey && input.apiKey.trim().length > 0) {
    return input.apiKey.trim();
  }
  if (input.clearApiKey) {
    return "";
  }
  const settings = await prisma.tenantAiSettings.findUnique({ where: { tenantId } });
  const secret = settings?.apiKeySecret ? decryptJson(settings.apiKeySecret) : null;
  return secret && typeof secret === "object" && "apiKey" in secret ? String(secret.apiKey) : "";
}

export function normalizeAiRules(value: unknown): AiRules {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return defaultAiSettings.rules;
  }
  const candidate = value as Record<string, unknown>;
  return {
    privatePostAiEnabled: typeof candidate.privatePostAiEnabled === "boolean" ? candidate.privatePostAiEnabled : defaultAiSettings.rules.privatePostAiEnabled,
    privatePostAggregateDelaySeconds: normalizeNumber(candidate.privatePostAggregateDelaySeconds, 0, 120, defaultAiSettings.rules.privatePostAggregateDelaySeconds ?? 8),
    postTriggerKeywords: normalizeStringArray(candidate.postTriggerKeywords ?? defaultAiSettings.rules.postTriggerKeywords),
    privatePostPrompt: normalizePrivatePostPrompt(candidate.privatePostPrompt),
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
