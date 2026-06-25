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

  return [
    "你是校园墙 QQ 私聊投稿语义解析器。只返回 JSON，不要 Markdown。",
    "任务：基于整句语义和上下文判断是否是稿件、提取最终投稿正文、自动分段、判断匿名/实名、判断是否已经表达提交。",
    "返回标准格式：{\"intent\":\"post|chat|command\",\"text\":\"最终正文\",\"anonymous\":true|false|null,\"shouldSubmit\":true|false,\"sections\":[\"分段1\"],\"confidence\":0到1,\"reason\":\"简短原因\"}。",
    "请判断以下内容是否为校园墙稿件；如果是稿件，intent=post，并把适合发布的正文放入 text 和 sections；如果不是稿件，intent=chat；如果明显是机器人命令，intent=command。",
    "不要用关键词表或单个词命中做判断；必须理解用户真实意图，例如咨询如何匿名、注册、重置密码、闲聊、机器人命令都不是稿件。",
    "只有用户表达的是希望墙号发布/代发/匿名发布/发到校园墙，或发送了可直接发布的明确稿件正文时，才判定为 post。",
    "单纯好奇、闲聊、询问大家情况、聊天式问题、对机器人或墙号流程的咨询，即使提到学校/高考/食堂/老师，也不要判定为稿件，除非语境明确是在让墙号发布。",
    "anonymous 表示用户希望本条投稿如何发布：明确希望匿名则 true，明确希望署名/实名则 false，未表达则 null。",
    "如果 hasCurrentDraft=true 且用户本轮只是在表达匿名/实名选择（例如：匿名、别显示名字、用实名、可以署名），也要基于语义设置 anonymous；text 保留 currentDraftText，不要把这句话追加进正文。",
    "shouldSubmit 表示用户是否已经表达可以结束并提交当前投稿；没有明确完成意图时必须 false。",
    "text 只能包含适合发布到校园墙的正文；去掉对机器人的请求、匿名/实名要求、提交指令、解释性废话和非正文信息。",
    "sections 是按语义自然分段后的正文段落；如果不是稿件，text 为空、sections 为空、shouldSubmit=false。",
  ].join("\n");
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

function isCasualCrowdQuestion(text: string) {
  const normalized = text.replace(/\s+/g, "").trim();
  if (!normalized || normalized.length > 40) {
    return false;
  }
  const hasCrowdCue = /大家|你们|有人|有没有人|同学们|朋友们/.test(normalized);
  const hasQuestionCue = /吗|嘛|么|啥|什么|怎么样|咋样|如何|多少|几|\?|？/.test(normalized);
  const hasCasualCue = /好奇|想问|问问|问一下|有人知道|有无|有没有/.test(normalized);
  const hasPostCue = /投稿|发墙|上墙|帮我发|帮忙发|匿名|求扩|墙墙|墙墙帮/.test(normalized);
  return !hasPostCue && hasQuestionCue && (hasCrowdCue || hasCasualCue);
}

function appendReason(reason: string, marker: string) {
  const trimmed = reason.trim();
  return trimmed ? `${trimmed};${marker}`.slice(0, 120) : marker;
}

function clampNumber(value: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, value));
}
