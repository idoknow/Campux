import type { FastifyBaseLogger } from "fastify";
import { normalizeBaseUrl, readTenantAiSettings, resolveTenantAiApiKey } from "./ai-settings";
import { assignPostTags, maxTagsPerPost, normalizeTagName, tagColorForName } from "../lib/post-tags";
import { prisma } from "../lib/prisma";

type ExistingTag = {
  id: string;
  name: string;
  description: string | null;
  color: string;
};

export type PostTagSuggestion = {
  selected: string[];
  create: Array<{
    name: string;
    description: string | null;
    color: string | null;
  }>;
  confidence: number;
};

export type PostTagMaintenanceResult = {
  created: string[];
  archived: string[];
  deleted: string[];
};

const tagPromptMaxTextChars = 800;

export async function autoTagPost(options: {
  tenantId: string;
  postId: string;
  logger: FastifyBaseLogger;
}) {
  const post = await prisma.post.findFirst({
    where: {
      id: options.postId,
      tenantId: options.tenantId,
    },
    select: {
      id: true,
      text: true,
      tagAssignments: {
        select: {
          tagId: true,
        },
      },
    },
  });
  if (!post || !post.text.trim()) {
    return;
  }

  const existingTags = await prisma.postTag.findMany({
    where: {
      tenantId: options.tenantId,
      status: "active",
    },
    orderBy: [
      { lastUsedAt: "desc" },
      { updatedAt: "desc" },
      { name: "asc" },
    ],
    take: 80,
  });

  const suggestion = await generatePostTagSuggestion({
    tenantId: options.tenantId,
    text: post.text,
    existingTags,
    logger: options.logger,
  });
  if (!suggestion) {
    return;
  }

  const selectedNames = normalizeSuggestedNames(suggestion.selected);
  const createItems = suggestion.create
    .map((item) => {
      const name = normalizeTagName(item.name);
      return {
        name,
        description: item.description?.trim().slice(0, 80) || null,
        color: normalizeHexColor(item.color) ?? tagColorForName(name),
      };
    })
    .filter((item) => item.name)
    .slice(0, Math.max(0, maxTagsPerPost - selectedNames.length));

  const tagsByName = new Map(existingTags.map((tag) => [tag.name, tag]));
  const tagsToAssign: Array<{ tagId: string; source: "llm"; confidence: number }> = [];

  for (const name of selectedNames) {
    const tag = tagsByName.get(name);
    if (tag) {
      tagsToAssign.push({ tagId: tag.id, source: "llm", confidence: suggestion.confidence });
    }
  }

  for (const item of createItems) {
    if (tagsByName.has(item.name)) {
      const existing = tagsByName.get(item.name)!;
      tagsToAssign.push({ tagId: existing.id, source: "llm", confidence: suggestion.confidence });
      continue;
    }
    const tag = await prisma.postTag.upsert({
      where: {
        tenantId_name: {
          tenantId: options.tenantId,
          name: item.name,
        },
      },
      update: {
        status: "active",
        ...(item.description ? { description: item.description } : {}),
      },
      create: {
        tenantId: options.tenantId,
        name: item.name,
        description: item.description,
        color: item.color,
        source: "llm",
      },
    });
    tagsByName.set(tag.name, tag);
    tagsToAssign.push({ tagId: tag.id, source: "llm", confidence: suggestion.confidence });
  }

  const alreadyAssigned = new Set(post.tagAssignments.map((assignment) => assignment.tagId));
  const remainingSlots = Math.max(0, maxTagsPerPost - alreadyAssigned.size);
  if (remainingSlots === 0) {
    return;
  }
  await assignPostTags(prisma, {
    tenantId: options.tenantId,
    postId: post.id,
    tags: tagsToAssign
      .filter((tag) => !alreadyAssigned.has(tag.tagId))
      .slice(0, remainingSlots),
  });
}

export async function generatePostTagSuggestion(options: {
  tenantId: string;
  text: string;
  existingTags: ExistingTag[];
  logger: FastifyBaseLogger;
}): Promise<PostTagSuggestion | null> {
  const settings = await readTenantAiSettings(options.tenantId).catch((error) => {
    options.logger.warn({ error, tenantId: options.tenantId }, "post tags: failed to read AI settings");
    return null;
  });
  if (!settings || !settings.enabled || !settings.rules.postTaggingEnabled || settings.mode !== "llm" || !settings.apiKeyConfigured) {
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
        temperature: 0,
        max_tokens: 500,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: [
              "你是校园墙稿件标签助手。只返回 JSON，不要 Markdown。",
              `目标：为一条校园墙稿件选择最多 ${maxTagsPerPost} 个主题标签。`,
              "优先复用 existingTags 里的 name，selected 必须是已有标签名。",
              "如果正文明显属于一个近期事件、办事主题或高频咨询方向，可以在 create 中新增 1-2 个短中文标签。",
              "标签名 2-8 个汉字最佳，不能包含 #、表情、个人隐私、姓名、QQ、联系方式。",
              "不要为了单条闲聊创建过细标签；不确定时少打标。",
              "返回格式：{\"selected\":[\"已有标签名\"],\"create\":[{\"name\":\"新标签\",\"description\":\"一句话说明\",\"color\":\"#dbeafe\"}],\"confidence\":0到1}",
            ].join("\n"),
          },
          {
            role: "user",
            content: JSON.stringify({
              existingTags: options.existingTags.map((tag) => ({
                name: tag.name,
                description: tag.description,
              })),
              text: options.text.trim().slice(0, tagPromptMaxTextChars),
            }),
          },
        ],
      }),
    });

    const data = (await response.json().catch(() => null)) as
      | { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } }
      | null;
    if (!response.ok) {
      options.logger.warn({ tenantId: options.tenantId, status: response.status, error: data?.error?.message }, "post tags: LLM request failed");
      return null;
    }
    const parsed = parsePostTagSuggestionJson(data?.choices?.[0]?.message?.content ?? "");
    return parsed;
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    options.logger.warn({ error, tenantId: options.tenantId, aborted }, "post tags: LLM call errored");
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export function parsePostTagSuggestionJson(raw: string): PostTagSuggestion | null {
  const parsed = parseJsonObject(raw);
  if (!parsed) {
    return null;
  }
  const selected = normalizeSuggestedNames(parsed.selected);
  const create = Array.isArray(parsed.create)
    ? parsed.create.flatMap((item) => {
        if (!item || typeof item !== "object") {
          return [];
        }
        const record = item as Record<string, unknown>;
        const name = normalizeTagName(record.name);
        if (!name) {
          return [];
        }
        return [{
          name,
          description: typeof record.description === "string" ? record.description.trim().slice(0, 80) || null : null,
          color: normalizeHexColor(record.color),
        }];
      })
    : [];
  const confidence = clampNumber(typeof parsed.confidence === "number" ? parsed.confidence : Number(parsed.confidence), 0, 1, 0.5);
  return {
    selected: selected.slice(0, maxTagsPerPost),
    create: create.slice(0, maxTagsPerPost),
    confidence,
  };
}

export async function maintainTenantPostTags(options: {
  tenantId: string;
  logger: FastifyBaseLogger;
}): Promise<PostTagMaintenanceResult> {
  const settings = await readTenantAiSettings(options.tenantId).catch((error) => {
    options.logger.warn({ error, tenantId: options.tenantId }, "post tag maintenance: failed to read AI settings");
    return null;
  });
  if (!settings || !settings.enabled || !settings.rules.postTagMaintenanceEnabled || settings.mode !== "llm" || !settings.apiKeyConfigured) {
    return { created: [], archived: [], deleted: [] };
  }

  const apiKey = await resolveTenantAiApiKey(options.tenantId, {});
  if (!apiKey) {
    return { created: [], archived: [], deleted: [] };
  }

  const [tags, posts] = await Promise.all([
    prisma.postTag.findMany({
      where: { tenantId: options.tenantId },
      include: { _count: { select: { assignments: true } } },
      orderBy: [{ status: "asc" }, { lastUsedAt: "desc" }, { updatedAt: "desc" }],
      take: 100,
    }),
    prisma.post.findMany({
      where: {
        tenantId: options.tenantId,
        createdAt: { gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) },
      },
      select: {
        displayId: true,
        text: true,
        createdAt: true,
        tagAssignments: {
          select: {
            tag: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 80,
    }),
  ]);

  if (posts.length === 0 && tags.length === 0) {
    return { created: [], archived: [], deleted: [] };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.min(settings.timeoutSeconds, 30) * 1_000);
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
        max_tokens: 900,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: [
              "你是校园墙标签维护助手。只返回 JSON。",
              "根据最近 14 天稿件和现有标签，维护一个简洁、可筛选的标签库。",
              "create：近期事件或高频主题缺少标签时新增，最多 5 个。",
              "archive：明显过期、近期不用但历史仍有价值的标签，最多 10 个。",
              "delete：没有任何使用记录且冗余/质量差的标签，最多 10 个。不要删除有使用记录的标签。",
              "标签名要短中文，不含 #、表情、个人隐私、姓名、QQ、联系方式。",
              "返回格式：{\"create\":[{\"name\":\"高考志愿\",\"description\":\"志愿填报相关咨询\",\"color\":\"#dbeafe\"}],\"archive\":[\"旧标签\"],\"delete\":[\"空标签\"]}",
            ].join("\n"),
          },
          {
            role: "user",
            content: JSON.stringify({
              tags: tags.map((tag) => ({
                name: tag.name,
                description: tag.description,
                status: tag.status,
                source: tag.source,
                postCount: tag._count.assignments,
                lastUsedAt: tag.lastUsedAt?.toISOString() ?? null,
              })),
              recentPosts: posts.map((post) => ({
                displayId: post.displayId,
                createdAt: post.createdAt.toISOString(),
                text: post.text.slice(0, tagPromptMaxTextChars),
                tags: post.tagAssignments.map((assignment) => assignment.tag.name),
              })),
            }),
          },
        ],
      }),
    });
    const data = (await response.json().catch(() => null)) as
      | { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } }
      | null;
    if (!response.ok) {
      options.logger.warn({ tenantId: options.tenantId, status: response.status, error: data?.error?.message }, "post tag maintenance: LLM request failed");
      return { created: [], archived: [], deleted: [] };
    }
    const actions = parsePostTagMaintenanceJson(data?.choices?.[0]?.message?.content ?? "");
    if (!actions) {
      return { created: [], archived: [], deleted: [] };
    }
    return applyTagMaintenanceActions(options.tenantId, actions);
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    options.logger.warn({ error, tenantId: options.tenantId, aborted }, "post tag maintenance: LLM call errored");
    return { created: [], archived: [], deleted: [] };
  } finally {
    clearTimeout(timeout);
  }
}

export function parsePostTagMaintenanceJson(raw: string) {
  const parsed = parseJsonObject(raw);
  if (!parsed) {
    return null;
  }
  const create = Array.isArray(parsed.create)
    ? parsed.create.flatMap((item) => {
        if (!item || typeof item !== "object") {
          return [];
        }
        const record = item as Record<string, unknown>;
        const name = normalizeTagName(record.name);
        if (!name) {
          return [];
        }
        return [{
          name,
          description: typeof record.description === "string" ? record.description.trim().slice(0, 80) || null : null,
          color: normalizeHexColor(record.color) ?? tagColorForName(name),
        }];
      }).slice(0, 5)
    : [];
  return {
    create,
    archive: normalizeSuggestedNames(parsed.archive).slice(0, 10),
    delete: normalizeSuggestedNames(parsed.delete).slice(0, 10),
  };
}

async function applyTagMaintenanceActions(
  tenantId: string,
  actions: NonNullable<ReturnType<typeof parsePostTagMaintenanceJson>>,
): Promise<PostTagMaintenanceResult> {
  const created: string[] = [];
  const archived: string[] = [];
  const deleted: string[] = [];

  for (const item of actions.create) {
    const tag = await prisma.postTag.upsert({
      where: {
        tenantId_name: {
          tenantId,
          name: item.name,
        },
      },
      update: {
        status: "active",
        ...(item.description ? { description: item.description } : {}),
      },
      create: {
        tenantId,
        name: item.name,
        description: item.description,
        color: item.color,
        source: "llm",
      },
    });
    created.push(tag.name);
  }

  if (actions.archive.length > 0) {
    const result = await prisma.postTag.updateMany({
      where: {
        tenantId,
        name: { in: actions.archive },
        status: "active",
      },
      data: {
        status: "archived",
      },
    });
    if (result.count > 0) {
      archived.push(...actions.archive);
    }
  }

  if (actions.delete.length > 0) {
    const candidates = await prisma.postTag.findMany({
      where: {
        tenantId,
        name: { in: actions.delete },
      },
      include: {
        _count: {
          select: {
            assignments: true,
          },
        },
      },
    });
    const deletable = candidates.filter((tag) => tag._count.assignments === 0);
    if (deletable.length > 0) {
      await prisma.postTag.deleteMany({
        where: {
          id: { in: deletable.map((tag) => tag.id) },
        },
      });
      deleted.push(...deletable.map((tag) => tag.name));
    }
  }

  return { created: uniqueStrings(created), archived: uniqueStrings(archived), deleted: uniqueStrings(deleted) };
}

export function registerPostTagMaintenanceScheduler(options: { logger: FastifyBaseLogger }) {
  let stopped = false;
  async function run() {
    if (stopped) {
      return;
    }
    const tenants = await prisma.tenant.findMany({
      where: {
        status: "active",
        aiSettings: {
          isNot: null,
        },
      },
      select: { id: true },
      take: 100,
    });
    for (const tenant of tenants) {
      await maintainTenantPostTags({ tenantId: tenant.id, logger: options.logger }).catch((error) => {
        options.logger.warn({ error, tenantId: tenant.id }, "post tag maintenance scheduler failed");
      });
    }
  }

  const initial = setTimeout(() => {
    void run().catch((error) => options.logger.warn({ error }, "post tag maintenance initial run failed"));
  }, 2 * 60 * 1000);
  const interval = setInterval(() => {
    void run().catch((error) => options.logger.warn({ error }, "post tag maintenance run failed"));
  }, 6 * 60 * 60 * 1000);

  return () => {
    stopped = true;
    clearTimeout(initial);
    clearInterval(interval);
  };
}

function normalizeSuggestedNames(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return uniqueStrings(value.map(normalizeTagName).filter(Boolean));
}

function normalizeHexColor(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed.toLowerCase() : null;
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

function uniqueStrings(values: string[]): string[] {
  const result: string[] = [];
  for (const value of values) {
    if (value && !result.includes(value)) {
      result.push(value);
    }
  }
  return result;
}

function clampNumber(value: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, value));
}
