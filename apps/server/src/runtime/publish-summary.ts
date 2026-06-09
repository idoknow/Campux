import type { FastifyBaseLogger } from "fastify";
import { normalizeBaseUrl, readTenantAiSettings, resolveTenantAiApiKey } from "./campus-modeling";

// 说说文字里追加的极短总结硬上限：不超过 16 个字。
export const publishSummaryMaxChars = 16;

/**
 * 把 LLM 返回的总结收敛成「极短一行」：
 * - 去除首尾空白、换行折叠为单空格、去掉包裹引号和结尾标点；
 * - 用 Intl.Segmenter 按「字」截断到 maxChars（中文按字、英文单词不强切到字母，退化时按码点）。
 * 纯函数，便于单测。
 */
export function sanitizePublishSummary(raw: string, maxChars: number = publishSummaryMaxChars): string {
  let text = (raw ?? "")
    .replace(/\s+/g, " ")
    .trim()
    // 去掉模型常见的包裹引号 / 书名号 / 句末标点。
    .replace(/^["'“”『』「」\[\(（【]+/, "")
    .replace(/["'“”『』「」\]\)）】。.!！?？、,，;；:：]+$/, "")
    .trim();
  if (!text) {
    return "";
  }
  const units = segmentGraphemes(text);
  if (units.length > maxChars) {
    text = units.slice(0, maxChars).join("").trim();
  }
  return text;
}

function segmentGraphemes(text: string): string[] {
  const SegmenterCtor = (Intl as unknown as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  if (typeof SegmenterCtor === "function") {
    const seg = new SegmenterCtor("zh", { granularity: "grapheme" });
    return Array.from(seg.segment(text), (s) => s.segment);
  }
  // 退化：按 Unicode 码点切分（仍优于 UTF-16 半字符截断）。
  return Array.from(text);
}

/**
 * 当租户配置了 LLM（mode=llm 且填了 API Key）时，为一条稿件文本生成极短总结。
 * 返回 null 表示「不生成 / 生成失败 / 文本为空」——调用方应静默跳过，绝不阻塞发布。
 */
export async function generatePublishSummary(options: {
  tenantId: string;
  text: string;
  logger: FastifyBaseLogger;
}): Promise<string | null> {
  const text = options.text?.trim() ?? "";
  if (!text) {
    return null;
  }

  let settings;
  try {
    settings = await readTenantAiSettings(options.tenantId);
  } catch (error) {
    options.logger.warn({ error, tenantId: options.tenantId }, "publish summary: failed to read AI settings");
    return null;
  }

  // 未配置 LLM —— 直接跳过（功能开关由调用方先行判断，这里再兜底一次）。
  if (settings.mode !== "llm" || !settings.apiKeyConfigured) {
    return null;
  }

  const apiKey = await resolveTenantAiApiKey(options.tenantId, {});
  if (!apiKey) {
    return null;
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
        // 提要要求确定性输出（同一稿件多墙复用同一份），温度固定为 0。
        temperature: 0,
        messages: [
          {
            role: "system",
            content:
              "你是校园墙稿件的编辑助手。把稿件正文浓缩成一句极短的中文概括，作为说说里的一句话提要。" +
              `严格要求：不超过 ${publishSummaryMaxChars} 个字；只输出这句话本身，不要引号、标点结尾、表情或任何解释。`,
          },
          {
            role: "user",
            content: text,
          },
        ],
      }),
    });

    const data = (await response.json().catch(() => null)) as
      | { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } }
      | null;
    if (!response.ok) {
      options.logger.warn({ tenantId: options.tenantId, status: response.status, error: data?.error?.message }, "publish summary: LLM request failed");
      return null;
    }
    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      return null;
    }
    const summary = sanitizePublishSummary(content);
    return summary || null;
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    options.logger.warn({ error, tenantId: options.tenantId, aborted }, "publish summary: LLM call errored");
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
