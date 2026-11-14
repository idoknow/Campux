import { prisma } from "../lib/prisma";
import { assertSafeLlmUrl } from "./llm-url";
import {
  AI_LLM_ATTEMPTS_MAX,
  readTenantAiApiKeys,
  readTenantAiSettings,
  type AiProviderEndpoint,
  type StoredAiApiKey,
  type TenantAiSettingsClient,
  type TenantAiSettingsPayload,
} from "./ai-settings";
import { readBoundedLlmResponse } from "./post-review";

/** 一次具体尝试：某个通道、某个模型、某把密钥。 */
export type LlmAttempt = {
  provider: string;
  baseUrl: string;
  model: string;
  keyId: string;
  key: string;
};

export type LlmAttemptFailure = {
  provider: string;
  baseUrl: string;
  model: string;
  keyId: string;
  status: number;
  message: string;
};

/**
 * 降级链：provider 顺序 → 模型（主模型 + 备用模型）→ 密钥。
 * 没有配置任何密钥时 ready=false，调用方按"未启用 AI"处理，不发起请求。
 */
export type TenantLlmChain = {
  ready: boolean;
  attempts: LlmAttempt[];
  reason: string;
};

export function buildTenantLlmChain(
  settings: Pick<TenantAiSettingsPayload, "mode" | "providers">,
  keys: StoredAiApiKey[],
): TenantLlmChain {
  if (settings.mode !== "llm") {
    return { ready: false, attempts: [], reason: "AI 未切换到 LLM 模式" };
  }
  if (keys.length === 0) {
    return { ready: false, attempts: [], reason: "尚未配置 API 密钥" };
  }

  const attempts: LlmAttempt[] = [];
  for (const endpoint of settings.providers) {
    const endpointKeys = endpoint.keyIds.length > 0
      ? endpoint.keyIds.map((id) => keys.find((key) => key.id === id)).filter((key): key is StoredAiApiKey => Boolean(key))
      : keys;
    if (endpointKeys.length === 0) {
      continue;
    }
    for (const model of [endpoint.model, ...endpoint.fallbackModels]) {
      for (const key of endpointKeys) {
        attempts.push({
          provider: endpoint.provider,
          baseUrl: endpoint.baseUrl,
          model,
          keyId: key.id,
          key: key.value,
        });
        if (attempts.length >= AI_LLM_ATTEMPTS_MAX) {
          return { ready: true, attempts, reason: "" };
        }
      }
    }
  }

  return attempts.length > 0
    ? { ready: true, attempts, reason: "" }
    : { ready: false, attempts: [], reason: "没有可用的服务商通道" };
}

export async function resolveTenantLlmChain(
  tenantId: string,
  client: TenantAiSettingsClient = prisma,
): Promise<TenantLlmChain> {
  const [settings, keys] = await Promise.all([
    readTenantAiSettings(tenantId, client),
    readTenantAiApiKeys(tenantId, client),
  ]);
  return buildTenantLlmChain(settings, keys);
}

export type LlmChatResult =
  | { ok: true; data: unknown; attempt: LlmAttempt }
  | { ok: false; status: number; message: string; retryAfterMs?: number | undefined; failures: LlmAttemptFailure[] };

export type LlmChatOptions = {
  tenantId: string;
  /** 用哪次尝试（模型/通道）拼请求体；模型是每次尝试的变量，所以由调用方按模型构造。 */
  buildBody: (attempt: Pick<LlmAttempt, "model" | "baseUrl" | "provider">) => Record<string, unknown>;
  /** 单次尝试的响应上限，默认 64 KiB。 */
  maxBytes?: number | undefined;
  /** 单次尝试的超时，默认 30 秒。 */
  timeoutMs?: number | undefined;
  client?: TenantAiSettingsClient | undefined;
};

/** 这些状态/错误说明"这次尝试的通道或密钥不行"，可以换下一个组合。 */
export function isRetryableLlmStatus(status: number): boolean {
  return status === 401 || status === 403 || status === 404 || status === 408 || status === 409 || status === 429 || status >= 500 || status === 0;
}

/**
 * 按降级链调用 OpenAI 兼容的 /chat/completions。
 * 通道不可达、密钥失效、限流、5xx 都换下一个组合；4xx 其它（如 400 参数错误）直接返回，
 * 因为换模型也解决不了，只会把同一个错误重试 12 次。
 */
export async function callTenantLlmChat(options: LlmChatOptions): Promise<LlmChatResult> {
  const chain = await resolveTenantLlmChain(options.tenantId, options.client);
  if (!chain.ready) {
    return { ok: false, status: 0, message: chain.reason, failures: [] };
  }

  const maxBytes = options.maxBytes ?? 64 * 1024;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const failures: LlmAttemptFailure[] = [];
  let retryAfterMs: number | undefined;

  for (const attempt of chain.attempts) {
    const fail = (status: number, message: string): LlmAttemptFailure => ({
      provider: attempt.provider,
      baseUrl: attempt.baseUrl,
      model: attempt.model,
      keyId: attempt.keyId,
      status,
      message,
    });

    try {
      const origin = await assertSafeLlmUrl(attempt.baseUrl);
      const response = await fetch(`${origin.toString().replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${attempt.key}`,
        },
        body: JSON.stringify({ ...options.buildBody(attempt), model: attempt.model }),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        const detail = await readBoundedLlmResponse(response, 4 * 1024).catch(() => "");
        const failure = fail(response.status, `HTTP ${response.status}${detail ? `：${detail.slice(0, 200)}` : ""}`);
        failures.push(failure);
        retryAfterMs = parseRetryAfter(response.headers.get("retry-after")) ?? retryAfterMs;
        if (isRetryableLlmStatus(response.status)) {
          continue;
        }
        return { ok: false, status: response.status, message: failure.message, retryAfterMs, failures };
      }

      const raw = await readBoundedLlmResponse(response, maxBytes);
      return { ok: true, data: JSON.parse(raw) as unknown, attempt };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(fail(0, message));
    }
  }

  const last = failures.at(-1);
  return {
    ok: false,
    status: last?.status ?? 0,
    message: last ? `所有通道均失败，最后一次：${last.message}` : "没有可用的服务商通道",
    retryAfterMs,
    failures,
  };
}

/** retry-after 支持秒数与 HTTP 日期两种写法。 */
function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  if (/^\d+(?:\.\d+)?$/.test(header.trim())) {
    return Math.max(0, Number(header.trim()) * 1000);
  }
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : undefined;
}

/** 供日志/界面展示：把尝试描述成 "通道 · 模型 · 密钥#id"。 */
export function describeLlmAttempt(attempt: LlmAttempt): string {
  const label = attempt.provider || new URL(attempt.baseUrl).host;
  return `${label} · ${attempt.model} · 密钥 ${attempt.keyId}`;
}

/** 通道列表里是否有可用的（至少一条能有密钥的）。 */
export function hasUsableEndpoint(providers: AiProviderEndpoint[], keys: StoredAiApiKey[]): boolean {
  return buildTenantLlmChain({ mode: "llm", providers }, keys).ready;
}
