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

/**
 * The full lifecycle plan an autonomous tag agent may propose in a single pass.
 * Every field is advisory: the server re-validates each action against the hard
 * rules (cluster size, known post ids, max tags per post) before applying it.
 */
type PostTagAgentPlan = {
  /** New tags to mint for a recurring recent theme. */
  create: Array<{
    name: string;
    description: string | null;
    color: string;
    postIds: string[];
    confidence: number;
  }>;
  /** Near-duplicate tags to fold into one canonical tag. */
  merge: Array<{
    from: string[];
    into: string;
  }>;
  /** Back-fill / re-tag: map a post onto the (existing or just-created) taxonomy. */
  assign: Array<{
    postId: string;
    tags: string[];
  }>;
};

export type PostTagMaintenanceResult = {
  created: string[];
  merged: Array<{ from: string[]; into: string }>;
  archived: string[];
  deleted: string[];
  assigned: Array<{
    tag: string;
    postIds: string[];
  }>;
};

const tagPromptMaxTextChars = 800;
const tagAgentPostTextChars = 240;
const defaultTagMaintenanceLookbackDays = 14;
const tagMaintenanceArchiveInactiveDays = 14;
const maxTagMaintenanceLookbackDays = 90;
const tagAgentRecentPosts = 80;
/** Rock's rule ①: a new tag is only created once a theme recurs across at least this many posts. */
const minClusterSize = 3;

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

/**
 * The autonomous tag-lifecycle agent. A single pass that, given the whole tag
 * library plus recent and historically-untagged posts, lets the LLM propose the
 * full set of lifecycle actions (create / merge / assign), then applies them
 * under hard server-side rules, and finally archives tags that went quiet.
 *
 * It is driven both by the periodic scheduler (no human trigger needed) and by
 * the admin "整理标签" button — both call here. There is no confirmation step:
 * the agent owns the tag lifecycle end to end.
 */
export async function maintainTenantPostTags(options: {
  tenantId: string;
  lookbackDays?: number | undefined;
  logger: FastifyBaseLogger;
}): Promise<PostTagMaintenanceResult> {
  const emptyResult = (): PostTagMaintenanceResult => ({ created: [], merged: [], archived: [], deleted: [], assigned: [] });
  const settings = await readTenantAiSettings(options.tenantId).catch((error) => {
    options.logger.warn({ error, tenantId: options.tenantId }, "post tag maintenance: failed to read AI settings");
    return null;
  });
  if (!settings || !settings.enabled || !settings.rules.postTagMaintenanceEnabled || settings.mode !== "llm") {
    return emptyResult();
  }

  const lookbackDays = clampInteger(options.lookbackDays, 7, maxTagMaintenanceLookbackDays, defaultTagMaintenanceLookbackDays);
  const clusterSince = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
  const archiveSince = new Date(Date.now() - tagMaintenanceArchiveInactiveDays * 24 * 60 * 60 * 1000);

  const [tags, posts] = await Promise.all([
    prisma.postTag.findMany({
      where: { tenantId: options.tenantId },
      include: { _count: { select: { assignments: true } } },
      orderBy: [{ status: "asc" }, { lastUsedAt: "desc" }, { updatedAt: "desc" }],
      take: 100,
    }),
    // Recent window only — tags are a recent-activity feature, no historical
    // back-fill. The agent reasons over the last `lookbackDays` of posts to spot
    // recurring themes (create), tidy the taxonomy (merge), and tag any recent
    // post that slipped through per-post auto-tagging (assign).
    prisma.post.findMany({
      where: {
        tenantId: options.tenantId,
        text: { not: "" },
        createdAt: { gte: clusterSince },
      },
      select: {
        id: true,
        displayId: true,
        text: true,
        createdAt: true,
        tagAssignments: { select: { tag: { select: { name: true } } } },
      },
      orderBy: { createdAt: "desc" },
      take: tagAgentRecentPosts,
    }),
  ]);

  if (posts.length === 0 && tags.length === 0) {
    return emptyResult();
  }

  let applied = emptyResult();
  const apiKey = settings.apiKeyConfigured ? await resolveTenantAiApiKey(options.tenantId, {}) : null;
  if (!apiKey || posts.length < minClusterSize) {
    const archived = await archiveInactivePostTags(options.tenantId, archiveSince);
    return { ...applied, archived };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.min(settings.timeoutSeconds, 60) * 1_000);
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
        max_tokens: 2000,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: [
              "你是校园墙标签库的自治维护 agent。只返回 JSON，不要 Markdown。",
              `你只维护最近 ${lookbackDays} 天的稿件标签（这是一个近期活动特性，不回填历史稿件）。可以同时给出三类操作：create（新建标签）、merge（合并近义标签）、assign（给近期稿件补打标签）。`,
              `create：只有当最近 ${lookbackDays} 天里同一主题反复出现、相似稿件达到 ${minClusterSize} 条及以上（postIds 至少 ${minClusterSize} 个）时，才新建一个标签。postIds 必须来自输入 posts 的 id。`,
              "merge：当 tags 里存在含义重复或近义的标签时，把它们合并成一个规范名。from 是要被并入的标签名（可多个），into 是保留的规范标签名。不要制造近义重复标签。",
              "assign：把 posts 里仍缺合适标签的近期稿件映射到合适标签上（已有标签或本次 create 的标签都行）。tags 用标签名，每条稿件最多 " + maxTagsPerPost + " 个；没有合适标签就不要硬打。",
              "标签名要短中文，不含 #、表情、个人隐私、姓名、QQ、联系方式。不确定时宁可少操作。",
              "不需要也不要输出归档/删除操作；系统会自动归档过去两周无新稿件的标签。",
              "返回格式：{\"create\":[{\"name\":\"高考志愿\",\"description\":\"志愿填报相关\",\"color\":\"#dbeafe\",\"postIds\":[\"id1\",\"id2\",\"id3\"],\"confidence\":0到1}],\"merge\":[{\"from\":[\"近义名\"],\"into\":\"规范名\"}],\"assign\":[{\"postId\":\"id1\",\"tags\":[\"标签名\"]}]}",
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
              posts: posts.map((post) => ({
                id: post.id,
                displayId: post.displayId,
                createdAt: post.createdAt.toISOString(),
                text: post.text.slice(0, tagAgentPostTextChars),
                tags: post.tagAssignments.map((assignment) => assignment.tag.name),
              })),
              lookbackDays,
              minClusterSize,
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
    const plan = parsePostTagMaintenanceJson(data?.choices?.[0]?.message?.content ?? "");
    if (plan) {
      applied = await applyTagAgentPlan(options.tenantId, plan, posts.map((post) => post.id), options.logger);
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

export function parsePostTagMaintenanceJson(raw: string): PostTagAgentPlan | null {
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
        if (postIds.length < minClusterSize) {
          return [];
        }
        return [{
          name,
          description: typeof record.description === "string" ? record.description.trim().slice(0, 80) || null : null,
          color: normalizeHexColor(record.color) ?? tagColorForName(name),
          postIds,
          confidence: clampNumber(typeof record.confidence === "number" ? record.confidence : Number(record.confidence), 0, 1, 0.8),
        }];
      }).slice(0, 8)
    : [];

  const merge = Array.isArray(parsed.merge)
    ? parsed.merge.flatMap((item) => {
        if (!item || typeof item !== "object") {
          return [];
        }
        const record = item as Record<string, unknown>;
        const into = normalizeTagName(record.into);
        if (!into) {
          return [];
        }
        const from = normalizeSuggestedNames(record.from).filter((name) => name !== into);
        if (from.length === 0) {
          return [];
        }
        return [{ from, into }];
      }).slice(0, 8)
    : [];

  const assign = Array.isArray(parsed.assign)
    ? parsed.assign.flatMap((item) => {
        if (!item || typeof item !== "object") {
          return [];
        }
        const record = item as Record<string, unknown>;
        const postId = typeof record.postId === "string" ? record.postId.trim() : "";
        if (!postId) {
          return [];
        }
        const tags = normalizeSuggestedNames(record.tags).slice(0, maxTagsPerPost);
        if (tags.length === 0) {
          return [];
        }
        return [{ postId, tags }];
      }).slice(0, 200)
    : [];

  return { create, merge, assign };
}

export async function applyTagAgentPlan(
  tenantId: string,
  plan: PostTagAgentPlan,
  knownPostIds: string[],
  logger: FastifyBaseLogger,
): Promise<PostTagMaintenanceResult> {
  const created: string[] = [];
  const merged: Array<{ from: string[]; into: string }> = [];
  const assignedByTag = new Map<string, Set<string>>();
  const knownIds = new Set(knownPostIds);
  const handledCreateNames = new Set<string>();

  const recordAssignment = (tagName: string, postId: string) => {
    const set = assignedByTag.get(tagName) ?? new Set<string>();
    set.add(postId);
    assignedByTag.set(tagName, set);
  };

  // 1) CREATE — only for clusters that clear the hard ≥minClusterSize rule.
  for (const item of plan.create) {
    if (handledCreateNames.has(item.name)) {
      continue;
    }
    handledCreateNames.add(item.name);
    const postIds = uniqueStrings(item.postIds).filter((postId) => knownIds.has(postId)).slice(0, 50);
    if (postIds.length < minClusterSize) {
      continue;
    }
    try {
      const existing = await prisma.postTag.findUnique({
        where: { tenantId_name: { tenantId, name: item.name } },
        select: { id: true },
      });
      const tag = await prisma.postTag.upsert({
        where: { tenantId_name: { tenantId, name: item.name } },
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
          tags: [{ tagId: tag.id, source: "llm", confidence: item.confidence }],
        });
        recordAssignment(tag.name, postId);
      }
    } catch (error) {
      logger.warn({ error, tenantId, tag: item.name }, "post tag agent: create failed");
    }
  }

  // 2) MERGE — fold near-duplicate tags into one canonical tag. Assignments are
  // migrated to the canonical tag (upsert de-dupes), then the source tag's own
  // assignments are removed and the tag is archived (reversible, no post loses a tag).
  for (const item of plan.merge) {
    try {
      const canonical = await prisma.postTag.upsert({
        where: { tenantId_name: { tenantId, name: item.into } },
        update: { status: "active" },
        create: {
          tenantId,
          name: item.into,
          description: null,
          color: tagColorForName(item.into),
          source: "llm",
        },
      });
      const mergedFrom: string[] = [];
      for (const fromName of item.from) {
        if (fromName === canonical.name) {
          continue;
        }
        const fromTag = await prisma.postTag.findUnique({
          where: { tenantId_name: { tenantId, name: fromName } },
          select: { id: true, name: true },
        });
        if (!fromTag || fromTag.id === canonical.id) {
          continue;
        }
        const assignments = await prisma.postTagAssignment.findMany({
          where: { tenantId, tagId: fromTag.id },
          select: { postId: true, confidence: true },
        });
        for (const assignment of assignments) {
          await assignPostTags(prisma, {
            tenantId,
            postId: assignment.postId,
            tags: [{ tagId: canonical.id, source: "llm", confidence: assignment.confidence ?? null }],
          });
          recordAssignment(canonical.name, assignment.postId);
        }
        // Drop the source tag's now-redundant assignments and retire it.
        await prisma.postTagAssignment.deleteMany({ where: { tenantId, tagId: fromTag.id } });
        await prisma.postTag.update({ where: { id: fromTag.id }, data: { status: "archived" } });
        mergedFrom.push(fromTag.name);
      }
      if (mergedFrom.length > 0) {
        merged.push({ from: mergedFrom, into: canonical.name });
      }
    } catch (error) {
      logger.warn({ error, tenantId, into: item.into }, "post tag agent: merge failed");
    }
  }

  // 3) ASSIGN — back-fill posts onto the (now-current) active taxonomy.
  if (plan.assign.length > 0) {
    const activeTags = await prisma.postTag.findMany({
      where: { tenantId, status: "active" },
      select: { id: true, name: true },
    });
    const tagIdByName = new Map(activeTags.map((tag) => [tag.name, tag.id]));
    for (const item of plan.assign) {
      if (!knownIds.has(item.postId)) {
        continue;
      }
      const existingAssignments = await prisma.postTagAssignment.findMany({
        where: { tenantId, postId: item.postId },
        select: { tagId: true },
      });
      const alreadyAssigned = new Set(existingAssignments.map((assignment) => assignment.tagId));
      const remainingSlots = Math.max(0, maxTagsPerPost - alreadyAssigned.size);
      if (remainingSlots === 0) {
        continue;
      }
      const tagIds: Array<{ tagId: string; name: string }> = [];
      for (const tagName of item.tags) {
        const tagId = tagIdByName.get(tagName);
        if (tagId && !alreadyAssigned.has(tagId) && !tagIds.some((entry) => entry.tagId === tagId)) {
          tagIds.push({ tagId, name: tagName });
        }
      }
      const toAssign = tagIds.slice(0, remainingSlots);
      if (toAssign.length === 0) {
        continue;
      }
      try {
        await assignPostTags(prisma, {
          tenantId,
          postId: item.postId,
          tags: toAssign.map((entry) => ({ tagId: entry.tagId, source: "llm" as const, confidence: null })),
        });
        for (const entry of toAssign) {
          recordAssignment(entry.name, item.postId);
        }
      } catch (error) {
        logger.warn({ error, tenantId, postId: item.postId }, "post tag agent: assign failed");
      }
    }
  }

  const assigned = Array.from(assignedByTag.entries())
    .map(([tag, postIds]) => ({ tag, postIds: Array.from(postIds) }))
    .filter((entry) => entry.postIds.length > 0);

  return { created: uniqueStrings(created), merged, archived: [], deleted: [], assigned };
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
