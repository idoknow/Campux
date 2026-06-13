import type { FastifyBaseLogger } from "fastify";
import { normalizeBaseUrl, readTenantAiSettings, resolveTenantAiApiKey } from "../runtime/campus-modeling";

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
  text: "",
  anonymous: null,
  shouldSubmit: false,
  sections: [],
  confidence: 0,
  reason: "not_analyzed",
};

const submitKeywords = ["提交", "发出", "发出去", "投递", "投稿", "结束", "就这样", "可以发", "帮我发", "直接发"];
const anonymousKeywords = ["匿名", "别署名", "不要署名", "隐藏身份", "匿了", "匿名发", "匿名投稿"];
const realNameKeywords = ["实名", "署名", "用我名字", "不要匿名", "不匿名"];
const postIntentKeywords = ["投稿", "发墙", "墙墙", "表白墙", "树洞", "帮我发", "想发", "吐槽", "求助", "失物招领", "捞人", "扩列"];
const commandLikePattern = /^\s*(?:#|＃|\/|！|!)[\s\S]{1,40}$/;

export function fallbackAnalyzePrivatePostSemantics(input: {
  messageText: string;
  currentDraftText?: string | undefined;
  hasCurrentDraft?: boolean | undefined;
}): PrivatePostSemanticResult {
  const messageText = input.messageText.trim();
  if (!messageText || commandLikePattern.test(messageText)) {
    return { ...defaultSemanticResult, intent: commandLikePattern.test(messageText) ? "command" : "chat", reason: "empty_or_command" };
  }

  const anonymous = includesAny(messageText, anonymousKeywords) ? true : includesAny(messageText, realNameKeywords) ? false : null;
  const hasPostIntent = includesAny(messageText, postIntentKeywords);
  const shouldSubmit = includesAny(messageText, submitKeywords) && (Boolean(input.hasCurrentDraft) || hasPostIntent);
  const intent = input.hasCurrentDraft || hasPostIntent ? "post" : "chat";
  const text = stripMetaPhrases(messageText);
  const combinedText = input.currentDraftText && text ? `${input.currentDraftText.trim()}\n${text}`.trim() : text || input.currentDraftText?.trim() || "";

  return {
    intent,
    text: combinedText,
    anonymous,
    shouldSubmit,
    sections: splitPostSections(combinedText),
    confidence: intent === "post" ? 0.56 : 0.35,
    reason: "local_fallback",
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
            content: [
              "你是校园墙 QQ 私聊投稿语义解析器。只返回 JSON，不要 Markdown。",
              "任务：从用户消息和当前草稿中判断是否是投稿、提取最终投稿正文、自动分段、判断匿名/实名、判断是否已经表达提交。",
              "返回标准格式：{\"intent\":\"post|chat|command\",\"text\":\"最终正文\",\"anonymous\":true|false|null,\"shouldSubmit\":true|false,\"sections\":[\"分段1\"],\"confidence\":0到1,\"reason\":\"简短原因\"}。",
              "规则：命令、注册、重置密码、闲聊不是投稿；若用户说匿名/匿了/别署名则 anonymous=true；说实名/不匿名/署名则 anonymous=false；未表达则 null；只有明确说提交、发出去、结束、就这样、可以发等才 shouldSubmit=true。",
              "text 必须是不含投稿指令、匿名/提交指令的可发布正文；sections 是按语义自然分段后的正文段落。",
            ].join("\n"),
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

    return parsed.confidence >= 0.4 ? parsed : fallback;
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    input.logger.warn({ error, tenantId: input.tenantId, aborted }, "private post semantic: LLM call errored");
    return fallback;
  } finally {
    clearTimeout(timeout);
  }
}

export function parsePrivatePostSemanticJson(raw: string): PrivatePostSemanticResult | null {
  const parsed = parseJsonObject(raw);
  if (!parsed) {
    return null;
  }

  const intent = parsed.intent === "post" || parsed.intent === "chat" || parsed.intent === "command" ? parsed.intent : "chat";
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

function stripMetaPhrases(text: string) {
  let result = text.trim();
  const phrasePattern = new RegExp([...anonymousKeywords, ...realNameKeywords, ...submitKeywords, "帮我发", "帮我", "我要投稿", "想投稿", "投稿"].join("|"), "g");
  result = result.replace(phrasePattern, "");
  return result.replace(/^[，。,.;；：:\s]+|[，。,.;；：:\s]+$/g, "").trim();
}

function includesAny(text: string, keywords: string[]) {
  return keywords.some((keyword) => text.includes(keyword));
}

function clampNumber(value: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, value));
}
