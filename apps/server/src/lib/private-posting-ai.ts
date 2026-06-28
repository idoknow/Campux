import type { FastifyBaseLogger } from "fastify";
import { DEFAULT_PRIVATE_POST_PROMPT } from "@campux/domain";
import { normalizeBaseUrl, readTenantAiSettings, resolveTenantAiApiKey } from "../runtime/ai-settings";

export type PrivatePostSemanticInput = {
  tenantId: string;
  messageText: string;
  currentDraftText?: string | undefined;
  hasCurrentDraft?: boolean | undefined;
  imageCount?: number | undefined;
  logger: FastifyBaseLogger;
};

export type PrivatePostSemanticResult = {
  intent: "post" | "chat" | "command";
  action: "none" | "submit" | "cancel" | "undo";
  text: string;
  anonymous: boolean | null;
  shouldSubmit: boolean;
  sections: string[];
  confidence: number;
  reason: string;
  rawOutput?: unknown;
};

const defaultSemanticResult: PrivatePostSemanticResult = {
  intent: "chat",
  action: "none",
  text: "",
  anonymous: null,
  shouldSubmit: false,
  sections: [],
  confidence: 0,
  reason: "not_analyzed",
};

const commandLikePattern = /^\s*(?:#|＃|\/|！|!)[\s\S]{1,40}$/;

export function fallbackAnalyzePrivatePostSemantics(input: {
  messageText: string;
  currentDraftText?: string | undefined;
  hasCurrentDraft?: boolean | undefined;
}): PrivatePostSemanticResult {
  const messageText = input.messageText.trim();
  if (commandLikePattern.test(messageText)) {
    return { ...defaultSemanticResult, intent: "command", reason: "command_like_without_llm" };
  }
  return {
    ...defaultSemanticResult,
    text: input.hasCurrentDraft ? input.currentDraftText?.trim() || "" : "",
    sections: input.hasCurrentDraft ? splitPostSections(input.currentDraftText?.trim() || "") : [],
    reason: messageText ? "llm_unavailable" : "empty_message",
  };
}

export async function analyzePrivatePostSemantics(input: PrivatePostSemanticInput): Promise<PrivatePostSemanticResult> {
  const fallback = fallbackAnalyzePrivatePostSemantics(input);
  const messageText = input.messageText.trim();
  if (!messageText) {
    return fallback;
  }

  let settings;
  try {
    settings = await readTenantAiSettings(input.tenantId);
  } catch (error) {
    input.logger.warn({ error, tenantId: input.tenantId }, "private post semantic: failed to read AI settings");
    return fallback;
  }

  if (settings.mode !== "llm" || !settings.apiKeyConfigured) {
    return fallback;
  }

  const apiKey = await resolveTenantAiApiKey(input.tenantId, {});
  if (!apiKey) {
    return fallback;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.min(settings.timeoutSeconds, 20) * 1_000);
  const systemPrompt = buildPrivatePostSystemPrompt(settings.rules.privatePostPrompt);
  try {
    const response = await fetch(`${normalizeBaseUrl(settings.baseUrl)}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: settings.model,
        temperature: 0,
        max_tokens: 600,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: JSON.stringify({
              currentDraftText: input.currentDraftText?.trim() || "",
              hasCurrentDraft: Boolean(input.hasCurrentDraft),
              imageCount: input.imageCount ?? 0,
              messageText,
            }),
          },
        ],
      }),
    });

    const data = (await response.json().catch(() => null)) as
      | { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } }
      | null;
    if (!response.ok) {
      input.logger.warn({ tenantId: input.tenantId, status: response.status, error: data?.error?.message }, "private post semantic: LLM request failed");
      return fallback;
    }

    const content = data?.choices?.[0]?.message?.content;
    const parsed = parsePrivatePostSemanticJson(content ?? "");
    if (!parsed) {
      input.logger.warn({ tenantId: input.tenantId }, "private post semantic: invalid LLM JSON");
      return fallback;
    }

    const normalized = normalizePrivatePostSemanticResult(parsed, input);
    return normalized.confidence >= 0.4 ? normalized : fallback;
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    input.logger.warn({ error, tenantId: input.tenantId, aborted }, "private post semantic: LLM call errored");
    return fallback;
  } finally {
    clearTimeout(timeout);
  }
}

export function buildPrivatePostSystemPrompt(customPrompt?: string | undefined) {
  const trimmedCustomPrompt = customPrompt?.trim();
  if (trimmedCustomPrompt) {
    return trimmedCustomPrompt;
  }

  return DEFAULT_PRIVATE_POST_PROMPT;
}

export function normalizePrivatePostSemanticResult(
  result: PrivatePostSemanticResult,
  context: { messageText: string; hasCurrentDraft?: boolean | undefined; imageCount?: number | undefined },
): PrivatePostSemanticResult {
  if (result.intent !== "post") {
    return result;
  }

  const messageText = context.messageText.trim();
  const hasCurrentDraft = Boolean(context.hasCurrentDraft);
  const imageCount = context.imageCount ?? 0;
  if (!hasCurrentDraft && imageCount === 0 && isCasualCrowdQuestion(messageText)) {
    return {
      ...defaultSemanticResult,
      intent: "chat",
      confidence: Math.max(result.confidence, 0.8),
      reason: appendReason(result.reason, "casual_crowd_question"),
      rawOutput: result.rawOutput,
    };
  }

  return result;
}

export function parsePrivatePostSemanticJson(raw: string): PrivatePostSemanticResult | null {
  const parsed = parseJsonObject(raw);
  if (!parsed) {
    return null;
  }

  const intent = parsed.intent === "post" || parsed.intent === "chat" || parsed.intent === "command" ? parsed.intent : "chat";
  const action = parsed.action === "submit" || parsed.action === "cancel" || parsed.action === "undo" ? parsed.action : "none";
  const text = typeof parsed.text === "string" ? parsed.text.trim() : "";
  const sections = Array.isArray(parsed.sections)
    ? parsed.sections.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean).slice(0, 20)
    : splitPostSections(text);
  const normalizedText = sections.length > 0 ? sections.join("\n") : text;
  const anonymous = typeof parsed.anonymous === "boolean" ? parsed.anonymous : null;
  const shouldSubmit = parsed.shouldSubmit === true;
  const confidence = clampNumber(typeof parsed.confidence === "number" ? parsed.confidence : Number(parsed.confidence), 0, 1, 0.5);
  const reason = typeof parsed.reason === "string" ? parsed.reason.slice(0, 120) : "llm";

  return {
    intent,
    action,
    text: normalizedText,
    anonymous,
    shouldSubmit,
    sections: sections.length > 0 ? sections : splitPostSections(normalizedText),
    confidence,
    reason,
    rawOutput: parsed,
  };
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  if (!trimmed) {
    return null;
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function splitPostSections(text: string) {
  return text
    .split(/\n{2,}|\n|(?<=[。！？!?])\s+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function isCasualCrowdQuestion(text: string) {
  const trimmed = text.trim();
  const lines = trimmed.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  if (lines.length > 1) {
    return false;
  }
  const normalized = trimmed.replace(/\s+/g, "").trim();
  if (!normalized || normalized.length > 40) {
    return false;
  }
  const hasCrowdCue = /大家|你们|有人|有没有人|同学们|朋友们/.test(normalized);
  const hasQuestionCue = /吗|嘛|么|啥|什么|怎么样|咋样|如何|多少|几|\?|？/.test(normalized);
  const hasCasualCue = /好奇|想问|问问|问一下|有人知道|有无|有没有/.test(normalized);
  const hasPostCue = /投稿|发墙|上墙|帮我发|帮忙发|匿名|实名|求扩|墙墙|墙墙帮|提交|发出去|发布|谢谢/.test(normalized);
  return !hasPostCue && hasQuestionCue && (hasCrowdCue || hasCasualCue);
}

function appendReason(reason: unknown, marker: string) {
  const trimmed = typeof reason === "string" ? reason.trim() : "";
  return trimmed ? `${trimmed};${marker}`.slice(0, 120) : marker;
}

function clampNumber(value: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, value));
}
