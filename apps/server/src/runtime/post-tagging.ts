import type { FastifyBaseLogger } from "fastify";
import type { Prisma } from "@campux/db";
import { normalizeBaseUrl, readTenantAiSettings, resolveTenantAiApiKey } from "./ai-settings";
import { assignPostTags, maxTagsPerPost, normalizeTagName, tagColorForName } from "../lib/post-tags";
import { prisma } from "../lib/prisma";
import { isTenantRuntimeActive, tenantRuntimeRelationFilter } from "../lib/tenant-runtime";
import { runWithActiveTenantLease } from "../lib/tenant-runtime-lease";
import { llmFinishReason, llmOutputTokenBudget } from "./post-review";

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
/**
 * The maintenance agent feeds up to `tagAgentRecentPosts` posts to the LLM and asks
 * for a multi-action JSON plan — with a reasoning model this realistically takes
 * 60-90s. It must NOT be bounded by the tenant's `timeoutSeconds` (which is tuned
 * for the fast single-post auto-tag path, often 30s) or the call aborts mid-flight
 * and the agent silently returns "no changes". Give it its own generous ceiling.
 */
const tagMaintenanceTimeoutMs = 180_000;
/** Rock's rule ①: a new tag is only created once a theme recurs across at least this many posts. */
const minClusterSize = 3;

/**
 * 只有真正上过墙的稿件才参与标签聚类。被拒绝、撤回、取消的稿件留在库里，
 * 但它们不代表墙上的内容，拿它们聚类既没意义，还会让"墙上没稿件"的墙
 * 周期性发出一笔大 prompt。
 */
export const tagMaintenancePostStatuses = ["published", "partially_failed", "pending_recall"] as const;

type TagMaintenanceSettings = {
  enabled: boolean;
  mode: string;
  rules: { postTaggingEnabled?: boolean | undefined; postTagMaintenanceEnabled?: boolean | undefined };
};

/**
 * 标签维护的准入门槛：AI 开着、处于模型模式、维护开关开、且「自动打标」本身开着。
 * 打标关掉还去维护标签库，属于纯烧 token。
 */
export function shouldRunTagMaintenance(settings: TagMaintenanceSettings | null | undefined): settings is TagMaintenanceSettings {
  if (!settings) {
    return false;
  }
  if (!settings.enabled || settings.mode !== "llm") {
    return false;
  }
  return settings.rules.postTagMaintenanceEnabled === true;
}

/** 聚类要喂 LLM，只在「自动打标」开着时做；关掉时维护任务仍会归档旧标签。 */
export function shouldRunTagClustering(settings: TagMaintenanceSettings): boolean {
  return settings.rules.postTaggingEnabled !== false;
}

export async function autoTagPost(options: {
  tenantId: string;
  postId: string;
  logger: FastifyBaseLogger;
}) {
  if (!await isTenantRuntimeActive(prisma, options.tenantId)) {
    return;
  }
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
  if (!await isTenantRuntimeActive(prisma, options.tenantId)) {
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
  await runWithActiveTenantLease(prisma, options.tenantId, (transaction) => assignPostTags(transaction, {
    tenantId: options.tenantId,
    postId: post.id,
    tags: tagsToAssign
      .filter((tag) => !alreadyAssigned.has(tag.tagId))
      .slice(0, remainingSlots),
  }));
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
  if (!await isTenantRuntimeActive(prisma, options.tenantId)) {
    return null;
  }

  const maxTokens = llmOutputTokenBudget(options.text.length, { floor: 500, ceiling: 1500, multiplier: 0.6, padding: 300 });
  options.logger.info(
    { site: "post-tagging.single", tenantId: options.tenantId, model: settings.model, maxTokens, textChars: options.text.length },
    "llm request",
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.min(settings.timeoutSeconds, 20) * 1_000);
  try {
    const leased = await runWithActiveTenantLease(prisma, options.tenantId, async () => {
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
          max_tokens: maxTokens,
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
      return { response, data };
    });
    if (!leased.active) {
      return null;
    }
    const { response, data } = leased.value;
    if (!response.ok) {
      options.logger.warn({ tenantId: options.tenantId, status: response.status, error: data?.error?.message }, "post tags: LLM request failed");
      return null;
    }
    if (llmFinishReason(data) === "length") {
      options.logger.warn({ tenantId: options.tenantId, textChars: options.text.length, maxTokens }, "post tag suggestion output truncated by max_tokens");
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
  if (!await isTenantRuntimeActive(prisma, options.tenantId)) {
    return emptyResult();
  }
  const settings = await readTenantAiSettings(options.tenantId).catch((error) => {
    options.logger.warn({ error, tenantId: options.tenantId }, "post tag maintenance: failed to read AI settings");
    return null;
  });
  if (!shouldRunTagMaintenance(settings)) {
    return emptyResult();
  }

  const lookbackDays = clampInteger(options.lookbackDays, 7, maxTagMaintenanceLookbackDays, defaultTagMaintenanceLookbackDays);
  const clusterSince = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
  const archiveSince = new Date(Date.now() - tagMaintenanceArchiveInactiveDays * 24 * 60 * 60 * 1000);

  /** 归档与聚类解耦：打标关掉时只做过期标签归档，不再发 LLM 请求。 */
  const archiveInactive = async () => {
    if (!await isTenantRuntimeActive(prisma, options.tenantId)) {
      return [];
    }
    const result = await runWithActiveTenantLease(
      prisma,
      options.tenantId,
      (transaction) => archiveInactivePostTags(options.tenantId, archiveSince, transaction),
    );
    return result.active ? result.value : [];
  };

  if (!shouldRunTagClustering(settings)) {
    return { ...emptyResult(), archived: await archiveInactive() };
  }

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
        // 只聚类当前还在墙上的稿件：被拒绝/取消的、审过但还没发出去的草稿都不算，
        // 否则墙上一片空也会每 6 小时发一次大 prompt。
        status: { in: [...tagMaintenancePostStatuses] },
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
  if (!settings.apiKeyConfigured) {
    return { ...emptyResult(), archived: await archiveInactive() };
  }
  const apiKey = await resolveTenantAiApiKey(options.tenantId, {});
  if (!apiKey || posts.length < minClusterSize) {
    return { ...emptyResult(), archived: await archiveInactive() };
  }
  if (!await isTenantRuntimeActive(prisma, options.tenantId)) {
    return emptyResult();
  }

  // 读设置到真正发请求之间可能隔着查询，管理员此刻关掉打标就不该再烧 token。
  const freshSettings = await readTenantAiSettings(options.tenantId).catch(() => null);
  if (!shouldRunTagMaintenance(freshSettings) || !shouldRunTagClustering(freshSettings)) {
    return { ...emptyResult(), archived: await archiveInactive() };
  }

  // 查询到发请求之间稿件可能被撤回，用当前状态过一遍，避免拿已经下墙的稿件聚类。
  const stillVisible = new Set((await prisma.post.findMany({
    where: { tenantId: options.tenantId, id: { in: posts.map((post) => post.id) }, status: { in: [...tagMaintenancePostStatuses] } },
    select: { id: true },
  })).map((post) => post.id));
  const visiblePosts = posts.filter((post) => stillVisible.has(post.id));
  if (visiblePosts.length < minClusterSize) {
    return { ...emptyResult(), archived: await archiveInactive() };
  }

  let applied: PostTagMaintenanceResult = emptyResult();
  const systemPrompt = [
    "你是校园墙标签库的自治维护 agent。只返回 JSON，不要 Markdown。",
    `你只维护最近 ${lookbackDays} 天的稿件标签（这是一个近期活动特性，不回填历史稿件）。可以同时给出三类操作：create（新建标签）、merge（合并近义标签）、assign（给近期稿件补打标签）。`,
    `create：只有当最近 ${lookbackDays} 天里同一主题反复出现、相似稿件达到 ${minClusterSize} 条及以上（postIds 至少 ${minClusterSize} 个）时，才新建一个标签。postIds 必须来自输入 posts 的 id。`,
    "merge：当 tags 里存在含义重复或近义的标签时，把它们合并成一个规范名。from 是要被并入的标签名（可多个），into 是保留的规范标签名。不要制造近义重复标签。",
    "assign：把 posts 里仍缺合适标签的近期稿件映射到合适标签上（已有标签或本次 create 的标签都行）。tags 用标签名，每条稿件最多 " + maxTagsPerPost + " 个；没有合适标签就不要硬打。",
    "标签名要短中文，不含 #、表情、个人隐私、姓名、QQ、联系方式。不确定时宁可少操作。",
    "不需要也不要输出归档/删除操作；系统会自动归档过去两周无新稿件的标签。",
    "返回格式：{\"create\":[{\"name\":\"高考志愿\",\"description\":\"志愿填报相关\",\"color\":\"#dbeafe\",\"postIds\":[\"id1\",\"id2\",\"id3\"],\"confidence\":0到1}],\"merge\":[{\"from\":[\"近义名\"],\"into\":\"规范名\"}],\"assign\":[{\"postId\":\"id1\",\"tags\":[\"标签名\"]}]}",
  ].join("\n");
  const userPayload = JSON.stringify({
    tags: tags.map((tag) => ({
      name: tag.name,
      description: tag.description,
      status: tag.status,
      source: tag.source,
      postCount: tag._count.assignments,
      lastUsedAt: tag.lastUsedAt?.toISOString() ?? null,
    })),
    posts: visiblePosts.map((post) => ({
      id: post.id,
      displayId: post.displayId,
      createdAt: post.createdAt.toISOString(),
      text: post.text.slice(0, tagAgentPostTextChars),
      tags: post.tagAssignments.map((assignment) => assignment.tag.name),
    })),
    lookbackDays,
    minClusterSize,
  });
  // 每个动作占几十 token，稿件越多动作越多；给 2000 起步、4096 封顶。
  const maxTokens = Math.min(4096, Math.max(2000, 800 + visiblePosts.length * 80));

  options.logger.info(
    { site: "post-tagging.maintenance", tenantId: options.tenantId, model: settings.model, maxTokens, promptChars: systemPrompt.length + userPayload.length, posts: visiblePosts.length, tags: tags.length },
    "llm request",
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), tagMaintenanceTimeoutMs);
  try {
    const leased = await runWithActiveTenantLease(prisma, options.tenantId, async () => {
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
          max_tokens: maxTokens,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPayload },
          ],
        }),
      });
      const data = (await response.json().catch(() => null)) as
        | { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } }
        | null;
      return { response, data };
    });
    if (!leased.active) {
      return applied;
    }
    const { response, data } = leased.value;
    if (!response.ok) {
      options.logger.warn({ tenantId: options.tenantId, status: response.status, error: data?.error?.message }, "post tag maintenance: LLM request failed");
      return { ...applied, archived: uniqueStrings([...applied.archived, ...await archiveInactive()]) };
    }
    if (llmFinishReason(data) === "length") {
      options.logger.warn({ tenantId: options.tenantId, posts: visiblePosts.length, maxTokens }, "post tag maintenance output truncated by max_tokens");
    }
    const plan = parsePostTagMaintenanceJson(data?.choices?.[0]?.message?.content ?? "");
    if (plan) {
      const planned = await runWithActiveTenantLease(
        prisma,
        options.tenantId,
        (transaction) => applyTagAgentPlan(options.tenantId, plan, visiblePosts.map((post) => post.id), options.logger, transaction),
      );
      if (planned.active) {
        applied = planned.value;
      }
    }
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    options.logger.warn({ error, tenantId: options.tenantId, aborted }, "post tag maintenance: LLM call errored");
  } finally {
    clearTimeout(timeout);
  }
  return {
    ...applied,
    archived: uniqueStrings([...applied.archived, ...await archiveInactive()]),
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
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<PostTagMaintenanceResult> {
  const created: string[] = [];
  const merged: Array<{ from: string[]; into: string }> = [];
  const assignedByTag = new Map<string, Set<string>>();
  const knownIds = new Set(knownPostIds);
  // LLM 往返期间稿件可能被撤回或删除：应用前重新确认它们还在墙上。
  if (knownIds.size > 0) {
    const visibleRows = await client.post.findMany({
      where: { tenantId, id: { in: [...knownIds] }, status: { in: [...tagMaintenancePostStatuses] } },
      select: { id: true },
    });
    const visibleIds = new Set(visibleRows.map((row) => row.id));
    for (const postId of [...knownIds]) {
      if (!visibleIds.has(postId)) {
        knownIds.delete(postId);
      }
    }
  }
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
      const existing = await client.postTag.findUnique({
        where: { tenantId_name: { tenantId, name: item.name } },
        select: { id: true },
      });
      const tag = await client.postTag.upsert({
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
        await assignPostTags(client, {
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
      const canonical = await client.postTag.upsert({
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
        const fromTag = await client.postTag.findUnique({
          where: { tenantId_name: { tenantId, name: fromName } },
          select: { id: true, name: true },
        });
        if (!fromTag || fromTag.id === canonical.id) {
          continue;
        }
        const assignments = await client.postTagAssignment.findMany({
          where: { tenantId, tagId: fromTag.id },
          select: { postId: true, confidence: true },
        });
        for (const assignment of assignments) {
          await assignPostTags(client, {
            tenantId,
            postId: assignment.postId,
            tags: [{ tagId: canonical.id, source: "llm", confidence: assignment.confidence ?? null }],
          });
          recordAssignment(canonical.name, assignment.postId);
        }
        // Drop the source tag's now-redundant assignments and retire it.
        await client.postTagAssignment.deleteMany({ where: { tenantId, tagId: fromTag.id } });
        await client.postTag.update({ where: { id: fromTag.id }, data: { status: "archived" } });
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
    const activeTags = await client.postTag.findMany({
      where: { tenantId, status: "active" },
      select: { id: true, name: true },
    });
    const tagIdByName = new Map(activeTags.map((tag) => [tag.name, tag.id]));
    for (const item of plan.assign) {
      if (!knownIds.has(item.postId)) {
        continue;
      }
      const existingAssignments = await client.postTagAssignment.findMany({
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
        await assignPostTags(client, {
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

async function archiveInactivePostTags(
  tenantId: string,
  recentSince: Date,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<string[]> {
  const [activeTags, recentAssignments] = await Promise.all([
    client.postTag.findMany({
      where: {
        tenantId,
        status: "active",
      },
      select: {
        id: true,
        name: true,
      },
    }),
    client.postTagAssignment.findMany({
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
  const result = await client.postTag.updateMany({
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
        ...tenantRuntimeRelationFilter,
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
