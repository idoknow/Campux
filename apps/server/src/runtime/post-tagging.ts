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
  confidence: number;
};

type PostTagMaintenanceActions = {
  create: Array<{
    name: string;
    description: string | null;
    color: string;
    postIds: string[];
    confidence: number;
  }>;
};

export type PostTagMaintenanceResult = {
  created: string[];
  archived: string[];
  deleted: string[];
  assigned: Array<{
    tag: string;
    postIds: string[];
  }>;
};

const tagPromptMaxTextChars = 800;
const defaultTagMaintenanceLookbackDays = 14;
const tagMaintenanceArchiveInactiveDays = 14;
const maxTagMaintenanceLookbackDays = 90;
const tagMaintenanceMaxPosts = 120;

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

  const selectedNames = normalizeSuggestedNames(suggestion.selected).slice(0, maxTagsPerPost);
  const tagsByName = new Map(existingTags.map((tag) => [tag.name, tag]));
  const tagsToAssign: Array<{ tagId: string; source: "llm"; confidence: number }> = [];

  for (const name of selectedNames) {
    const tag = tagsByName.get(name);
    if (tag) {
      tagsToAssign.push({ tagId: tag.id, source: "llm", confidence: suggestion.confidence });
    }
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
              "不要创建新标签；如果没有合适的已有标签，selected 返回空数组。",
              "标签名 2-8 个汉字最佳，不能包含 #、表情、个人隐私、姓名、QQ、联系方式。",
              "不确定时少打标。",
              "返回格式：{\"selected\":[\"已有标签名\"],\"confidence\":0到1}",
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
  const confidence = clampNumber(typeof parsed.confidence === "number" ? parsed.confidence : Number(parsed.confidence), 0, 1, 0.5);
  return {
    selected: selected.slice(0, maxTagsPerPost),
    confidence,
  };
}

export async function maintainTenantPostTags(options: {
  tenantId: string;
  lookbackDays?: number | undefined;
  logger: FastifyBaseLogger;
}): Promise<PostTagMaintenanceResult> {
  const emptyResult = (): PostTagMaintenanceResult => ({ created: [], archived: [], deleted: [], assigned: [] });
  const settings = await readTenantAiSettings(options.tenantId).catch((error) => {
    options.logger.warn({ error, tenantId: options.tenantId }, "post tag maintenance: failed to read AI settings");
    return null;
  });
  if (!settings || !settings.enabled || !settings.rules.postTagMaintenanceEnabled || settings.mode !== "llm") {
    return emptyResult();
  }

  const lookbackDays = clampInteger(options.lookbackDays, 7, maxTagMaintenanceLookbackDays, defaultTagMaintenanceLookbackDays);
  const maintenanceSince = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
  const archiveSince = new Date(Date.now() - tagMaintenanceArchiveInactiveDays * 24 * 60 * 60 * 1000);
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
        createdAt: { gte: maintenanceSince },
      },
      select: {
        id: true,
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
      take: tagMaintenanceMaxPosts,
    }),
  ]);

  if (posts.length === 0 && tags.length === 0) {
    return emptyResult();
  }

  let applied = emptyResult();
  const apiKey = settings.apiKeyConfigured ? await resolveTenantAiApiKey(options.tenantId, {}) : null;
  if (!apiKey || posts.length < 4) {
    const archived = await archiveInactivePostTags(options.tenantId, archiveSince);
    return { ...applied, archived };
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
              `你只负责从最近 ${lookbackDays} 天稿件里发现阶段性重复主题，输出可创建或复用的标签簇。`,
              "只有同类稿件超过 3 条，也就是 postIds 至少 4 个时，才允许返回一个 create 项。",
              "每个 create.postIds 必须只使用输入 recentPosts 里的 id，并覆盖这几条相似稿件。",
              "如果主题已被现有 active 标签覆盖，可以返回相同 name 用于回填这几条稿件；不要制造近义重复标签。",
              "不要归档或删除标签；系统会自动归档过去两周无命中的 active 标签。",
              "标签名要短中文，不含 #、表情、个人隐私、姓名、QQ、联系方式。",
              "返回格式：{\"create\":[{\"name\":\"高考志愿\",\"description\":\"志愿填报相关咨询\",\"color\":\"#dbeafe\",\"postIds\":[\"稿件id1\",\"稿件id2\",\"稿件id3\",\"稿件id4\"],\"confidence\":0到1}]}",
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
                id: post.id,
                displayId: post.displayId,
                createdAt: post.createdAt.toISOString(),
                text: post.text.slice(0, tagPromptMaxTextChars),
                tags: post.tagAssignments.map((assignment) => assignment.tag.name),
              })),
              lookbackDays,
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
      return { ...applied, archived: await archiveInactivePostTags(options.tenantId, archiveSince) };
    }
    const actions = parsePostTagMaintenanceJson(data?.choices?.[0]?.message?.content ?? "");
    if (actions) {
      applied = await applyTagMaintenanceActions(options.tenantId, actions, posts.map((post) => post.id));
    }
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    options.logger.warn({ error, tenantId: options.tenantId, aborted }, "post tag maintenance: LLM call errored");
  } finally {
    clearTimeout(timeout);
  }
  const archived = await archiveInactivePostTags(options.tenantId, archiveSince);
  return {
    ...applied,
    archived: uniqueStrings([...applied.archived, ...archived]),
  };
}

export function parsePostTagMaintenanceJson(raw: string): PostTagMaintenanceActions | null {
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
        const postIds = normalizeStringList(record.postIds);
        if (postIds.length < 4) {
          return [];
        }
        return [{
          name,
          description: typeof record.description === "string" ? record.description.trim().slice(0, 80) || null : null,
          color: normalizeHexColor(record.color) ?? tagColorForName(name),
          postIds,
          confidence: clampNumber(typeof record.confidence === "number" ? record.confidence : Number(record.confidence), 0, 1, 0.8),
        }];
      }).slice(0, 5)
    : [];
  return {
    create,
  };
}

async function applyTagMaintenanceActions(
  tenantId: string,
  actions: PostTagMaintenanceActions,
  recentPostIds: string[],
): Promise<PostTagMaintenanceResult> {
  const created: string[] = [];
  const assigned: PostTagMaintenanceResult["assigned"] = [];
  const knownRecentPostIds = new Set(recentPostIds);
  const handledTagNames = new Set<string>();

  for (const item of actions.create) {
    if (handledTagNames.has(item.name)) {
      continue;
    }
    handledTagNames.add(item.name);
    const postIds = uniqueStrings(item.postIds).filter((postId) => knownRecentPostIds.has(postId)).slice(0, 30);
    if (postIds.length < 4) {
      continue;
    }
    const existing = await prisma.postTag.findUnique({
      where: {
        tenantId_name: {
          tenantId,
          name: item.name,
        },
      },
      select: {
        id: true,
      },
    });
    const tag = await prisma.postTag.upsert({
      where: {
        tenantId_name: {
          tenantId,
          name: item.name,
        },
      },
      update: {
        status: "active",
        source: "llm",
        color: item.color,
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
    if (!existing) {
      created.push(tag.name);
    }
    for (const postId of postIds) {
      await assignPostTags(prisma, {
        tenantId,
        postId,
        tags: [{
          tagId: tag.id,
          source: "llm",
          confidence: item.confidence,
        }],
      });
    }
    assigned.push({ tag: tag.name, postIds });
  }

  return { created: uniqueStrings(created), archived: [], deleted: [], assigned };
}

async function archiveInactivePostTags(tenantId: string, recentSince: Date): Promise<string[]> {
  const [activeTags, recentAssignments] = await Promise.all([
    prisma.postTag.findMany({
      where: {
        tenantId,
        status: "active",
      },
      select: {
        id: true,
        name: true,
      },
    }),
    prisma.postTagAssignment.findMany({
      where: {
        tenantId,
        post: {
          tenantId,
          createdAt: { gte: recentSince },
        },
      },
      select: {
        tagId: true,
      },
    }),
  ]);
  const recentTagIds = new Set(recentAssignments.map((assignment) => assignment.tagId));
  const inactiveTags = activeTags.filter((tag) => !recentTagIds.has(tag.id));
  if (inactiveTags.length === 0) {
    return [];
  }
  const inactiveIds = inactiveTags.map((tag) => tag.id);
  const result = await prisma.postTag.updateMany({
    where: {
      tenantId,
      id: { in: inactiveIds },
      status: "active",
    },
    data: {
      status: "archived",
    },
  });
  return result.count > 0 ? inactiveTags.map((tag) => tag.name) : [];
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

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return uniqueStrings(value
    .flatMap((item) => {
      if (typeof item === "string") {
        return [item.trim()];
      }
      if (typeof item === "number") {
        return [String(item)];
      }
      return [];
    })
    .filter(Boolean));
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

function clampInteger(value: number | undefined, min: number, max: number, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.trunc(value)));
}
