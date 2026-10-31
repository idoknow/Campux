import type { FastifyBaseLogger } from "fastify";
import type { Prisma } from "@campux/db";
import { supportsAdvisoryLock, supportsSkipDuplicates } from "@campux/db";
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
/** 单次维护请求携带的稿件数。整墙一次提交时输出会被 max_tokens 截断（78 篇约需 8k token，上限 4096）。 */
const tagMaintenanceBatchSize = 30;
/** 截断后继续折半的最小批；再小还截断就记失败，交给 15 分钟全量重跑。 */
const tagMaintenanceMinSplitSize = 4;
/**
 * 记录「该 baseUrl+model 拒绝 reasoning_effort」的组合（如 GLM-5.3 这类 thinking-only 模型）。
 * 进程内缓存，不落库：重启后重新探测一次即可。
 */
const reasoningEffortRejected = new Set<string>();

export function reasoningEffortKey(baseUrl: string, model: string): string {
  return `${normalizeBaseUrl(baseUrl)}|${model}`;
}

/**
 * 是否应该去掉 reasoning_effort 重试一次。
 * 4xx 表示请求本身被拒，除鉴权/限流/超时这几类与参数无关的状态外，都可能是
 * 「不认识这个参数」（FastAPI 的 {detail:[...]}、网关的纯文本错误也一样）。
 * 5xx 是上游故障，保持原有重试语义；已经降级过就不再降级。
 */
export function shouldFallbackReasoning(options: { status: number; alreadyFellBack: boolean }): boolean {
  if (options.alreadyFellBack) return false;
  if (options.status < 400 || options.status >= 500) return false;
  return ![401, 403, 408, 413, 429].includes(options.status);
}

/** 从各种错误响应形态里取出可读信息：{error:{message}} / {error:"..."} / {detail:[{msg}]} / 纯文本。 */
export function extractLlmErrorMessage(bodyText: string, parsed?: unknown): string {
  const body = parsed as Record<string, unknown> | null | undefined;
  const error = body?.error as unknown;
  const detail = body?.detail as unknown;
  const candidates: unknown[] = [
    typeof error === "object" && error !== null ? (error as Record<string, unknown>).message : error,
    body?.message,
    detail,
    Array.isArray(detail) ? detail.map((item) => (item as Record<string, unknown>)?.msg ?? JSON.stringify(item)).join("; ") : undefined,
    bodyText,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.slice(0, 300);
  }
  return "";
}

/** 统一的 OpenAI 兼容 JSON 请求体；reasoningOff 为 false 时不带 reasoning_effort。 */
export function buildLlmJsonRequestBody(options: {
  model: string;
  maxTokens: number;
  systemPrompt: string;
  userPayload: string;
  reasoningOff: boolean;
  temperature?: number;
}): Record<string, unknown> {
  return {
    model: options.model,
    temperature: options.temperature ?? 0,
    max_tokens: options.maxTokens,
    response_format: { type: "json_object" },
    ...(options.reasoningOff ? { reasoning_effort: "none" } : {}),
    messages: [
      { role: "system", content: options.systemPrompt },
      { role: "user", content: options.userPayload },
    ],
  };
}

/**
 * 把待维护稿件切成固定大小的批次。
 * 批太小会让同一主题的稿件被拆散、create 的 ≥minClusterSize 判定不成立；批太大又会撞 max_tokens。
 */
export function chunkTagMaintenancePosts<T>(items: readonly T[], size: number = tagMaintenanceBatchSize): T[][] {
  const batchSize = Number.isFinite(size) && size >= 1 ? Math.trunc(size) : tagMaintenanceBatchSize;
  const batches: T[][] = [];
  for (let offset = 0; offset < items.length; offset += batchSize) {
    batches.push(items.slice(offset, offset + batchSize));
  }
  return batches;
}

/** 合并多批维护结果：created/archived/deleted 去重，merged 按「来源集合 + 目标」去重。 */
export function mergeTagMaintenanceResults(target: PostTagMaintenanceResult, next: PostTagMaintenanceResult): PostTagMaintenanceResult {
  const merged = [...target.merged];
  const mergeKey = (item: { from: string[]; into: string }) => `${[...item.from].sort().join("|")}>${item.into}`;
  const seen = new Set(merged.map(mergeKey));
  for (const item of next.merged) {
    const key = mergeKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return {
    created: uniqueStrings([...target.created, ...next.created]),
    merged,
    archived: uniqueStrings([...target.archived, ...next.archived]),
    deleted: uniqueStrings([...target.deleted, ...next.deleted]),
    assigned: [...target.assigned, ...next.assigned],
  };
}
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

/** 维护 LLM 请求失败后的重试策略：先快速重试 5 次，仍失败则每 15 分钟自动重跑一轮，最多 3 轮，
 * 之后停止并等待下一次周期维护。状态按租户隔离，成功即清除。 */
const TAG_MAINTENANCE_RETRY_ATTEMPTS = 5;
const TAG_MAINTENANCE_RETRY_PAUSE_MS = 10_000;
const TAG_MAINTENANCE_RETRY_BUDGET_MS = 5 * 60_000;
const TAG_MAINTENANCE_AUTO_RETRY_INTERVAL_MS = 15 * 60 * 1000;
const TAG_MAINTENANCE_AUTO_RETRY_MAX_ROUNDS = 3;
/** 维护自动重试状态：timer 为已排程的 15 分钟重试；定时器触发后置 null（rerun 进行中，remaining 保留）。 */
const tagMaintenanceAutoRetryTimers = new Map<string, { timer: ReturnType<typeof setTimeout> | null; remaining: number }>();

/** 维护任务进行中标记（按租户互斥，路由/调度器/自动重试共用）。 */
const tagMaintenanceInFlight = new Map<string, true>();

/** 该租户是否已有待执行的维护自动重试（定时器已排程且未触发）。 */
export function hasPendingTagMaintenanceRetry(tenantId: string): boolean {
  return tagMaintenanceAutoRetryTimers.get(tenantId)?.timer != null;
}

function clearTagMaintenanceAutoRetry(tenantId: string) {
  const state = tagMaintenanceAutoRetryTimers.get(tenantId);
  if (state) {
    if (state.timer) clearTimeout(state.timer);
    tagMaintenanceAutoRetryTimers.delete(tenantId);
  }
}

export function scheduleTagMaintenanceAutoRetry(tenantId: string, lookbackDays: number | undefined, logger: FastifyBaseLogger) {
  const state = tagMaintenanceAutoRetryTimers.get(tenantId);
  const remaining = state ? state.remaining - 1 : TAG_MAINTENANCE_AUTO_RETRY_MAX_ROUNDS;
  if (remaining <= 0) {
    tagMaintenanceAutoRetryTimers.delete(tenantId);
    logger.warn({ tenantId }, "post tag maintenance: automatic retries exhausted; waiting for the next scheduled maintenance");
    return;
  }
  if (state?.timer) clearTimeout(state.timer);
  logger.warn({ tenantId, remaining, retryAfterMinutes: 15 }, "post tag maintenance: clustering failed, scheduling automatic retry");
  const timer = setTimeout(() => {
    // 触发后先把 timer 置 null（rerun 进行中、remaining 保留）：
    // hasPendingTagMaintenanceRetry 只认未触发的定时器，rerun 内部的失败才能按剩余预算继续排程。
    const entry = tagMaintenanceAutoRetryTimers.get(tenantId);
    if (entry) entry.timer = null;
    void maintainTenantPostTags({ tenantId, lookbackDays, logger })
      .catch((error) => {
        logger.warn({ error, tenantId }, "post tag maintenance: automatic retry crashed");
        if (!hasPendingTagMaintenanceRetry(tenantId)) {
          scheduleTagMaintenanceAutoRetry(tenantId, lookbackDays, logger);
        }
      });
  }, TAG_MAINTENANCE_AUTO_RETRY_INTERVAL_MS);
  tagMaintenanceAutoRetryTimers.set(tenantId, { timer, remaining });
}

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
  const systemPrompt = [
    "你是校园墙稿件标签助手。只返回 JSON，不要 Markdown。",
    `目标：为一条校园墙稿件选择最多 ${maxTagsPerPost} 个主题标签。`,
    "优先复用 existingTags 里的 name，selected 必须是已有标签名。",
    "不要创建新标签；如果没有合适的已有标签，selected 返回空数组。",
    "标签名 2-8 个汉字最佳，不能包含 #、表情、个人隐私、姓名、QQ、联系方式。",
    "打标标准放宽：主题相关、接近或属于同一大类就应打上；只有与标签完全无关时才不打。",
    "返回格式：{\"selected\":[\"已有标签名\"],\"confidence\":0到1}",
  ].join("\n");
  const userPayload = JSON.stringify({
    existingTags: options.existingTags.map((tag) => ({
      name: tag.name,
      description: tag.description,
    })),
    text: options.text.trim().slice(0, tagPromptMaxTextChars),
  });
  const reasoningKey = reasoningEffortKey(settings.baseUrl, settings.model);
  let reasoningOff = !reasoningEffortRejected.has(reasoningKey);
  const requestBody = (off: boolean) => JSON.stringify(buildLlmJsonRequestBody({
    model: settings.model,
    // 关不掉思考时用满 4096，给 reasoning 留空间；否则按文本长度估算即可。
    maxTokens: off ? maxTokens : 4096,
    systemPrompt,
    userPayload,
    reasoningOff: off,
  }));
  let controller = new AbortController();
  let timeout = setTimeout(() => controller.abort(), Math.min(settings.timeoutSeconds, 20) * 1_000);
  try {
    const leased = await runWithActiveTenantLease(prisma, options.tenantId, async () => {
      const response = await fetch(`${normalizeBaseUrl(settings.baseUrl)}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: requestBody(reasoningOff),
      });
      const bodyText = await response.text().catch(() => "");
      let data: { choices?: Array<{ message?: { content?: string } }> } | null = null;
      try {
        data = JSON.parse(bodyText);
      } catch {
        data = null;
      }
      return { response, data, bodyText };
    });
    if (!leased.active) {
      return null;
    }
    let { response, data, bodyText } = leased.value;
    let probed = false;
    if (!response.ok && shouldFallbackReasoning({ status: response.status, alreadyFellBack: !reasoningOff })) {
      // 可能是后端不认 reasoning_effort：去掉字段重试一次。租户已停用就不再外发正文。
      if (!await isTenantRuntimeActive(prisma, options.tenantId)) return null;
      probed = true;
      reasoningOff = false;
      // 降级请求单独计时：首次请求可能已经用掉大半 20 秒预算，而这次要输出到 4096。
      clearTimeout(timeout);
      controller = new AbortController();
      timeout = setTimeout(() => controller.abort(), Math.min(settings.timeoutSeconds, 20) * 1_000);
      options.logger.info({ tenantId: options.tenantId, status: response.status, error: extractLlmErrorMessage(bodyText, data) }, "post tags: retrying without reasoning_effort");
      const retry = await fetch(`${normalizeBaseUrl(settings.baseUrl)}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: requestBody(false),
      });
      bodyText = await retry.text().catch(() => "");
      try {
        data = JSON.parse(bodyText);
      } catch {
        data = null;
      }
      response = retry;
    }
    if (!response.ok) {
      options.logger.warn({ tenantId: options.tenantId, status: response.status, error: extractLlmErrorMessage(bodyText, data) }, "post tags: LLM request failed");
      return null;
    }
    if (probed) reasoningEffortRejected.add(reasoningKey);
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
  // 租户级互斥：路由、周期调度器、自动重试定时器共用同一把锁，
  // 防止并发运行消耗双份 token、应用相互冲突的标签计划。
  // 进程内互斥覆盖单实例部署；多副本需另引入分布式锁（当前部署为单实例）。
  if (tagMaintenanceInFlight.has(options.tenantId)) {
    options.logger.info({ tenantId: options.tenantId }, "post tag maintenance: already running, skipping");
    return { created: [], merged: [], archived: [], deleted: [], assigned: [] };
  }
  tagMaintenanceInFlight.set(options.tenantId, true);
  try {
    return await (async (): Promise<PostTagMaintenanceResult> => {
  const emptyResult = (): PostTagMaintenanceResult => ({ created: [], merged: [], archived: [], deleted: [], assigned: [] });
  if (!await isTenantRuntimeActive(prisma, options.tenantId)) {
    return emptyResult();
  }
  const settings = await readTenantAiSettings(options.tenantId).catch((error) => {
    options.logger.warn({ error, tenantId: options.tenantId }, "post tag maintenance: failed to read AI settings");
    // 读设置的暂时性失败向上抛出：路由 catch 会安排 15 分钟自动重试，而不是静默空跑。
    throw error;
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
    "merge：当 tags 里存在含义重复或近义的标签时，把它们合并成一个规范名。from 是要被并入的标签名（可多个），into 是保留的规范标签名。不要制造近义重复标签。source 为 manual/user 的是人工维护的标签，禁止作为 merge 的 from（系统会拒绝）。",
    "assign：把 posts 里仍缺合适标签的近期稿件映射到合适标签上（已有标签或本次 create 的标签都行）。tags 用标签名，每条稿件最多 " + maxTagsPerPost + " 个；主题相关、接近或属于同一大类就应打上，只有完全无关才不打。",
    "标签名要短中文，不含 #、表情、个人隐私、姓名、QQ、联系方式。create 与 merge 保持谨慎；assign 放宽：相关即打标，不必强求精确匹配。",
    "不需要也不要输出归档/删除操作；系统会自动归档过去两周无新稿件的标签。",
    "返回格式：{\"create\":[{\"name\":\"高考志愿\",\"description\":\"志愿填报相关\",\"color\":\"#dbeafe\",\"postIds\":[\"id1\",\"id2\",\"id3\"],\"confidence\":0到1}],\"merge\":[{\"from\":[\"近义名\"],\"into\":\"规范名\"}],\"assign\":[{\"postId\":\"id1\",\"tags\":[\"标签名\"]}]}",
  ].join("\n");

  // 整墙一次提交时，动作 JSON 会被 max_tokens 截断（78 篇约需 8k token，上限 4096），
  // 结果是整轮 JSON 非法、重试也只是重复同一个截断。改为按批提交：单批输出可控，
  // 某批失败只影响该批，其余批次照常落库。
  const batches = chunkTagMaintenancePosts(visiblePosts);
  let succeededBatches = 0;
  let failedBatches = 0;
  // 每批落库后标签库就变了：next 批必须重读，否则会重复建近义标签、
  // 甚至把上一批刚合并归档的标签 create 回来。
  let tagsSnapshot: typeof tags | null = tags;
  // 探测结果整轮共享：截断折半出的子批不会再重复撞同一个 4xx。
  const reasoningKey = reasoningEffortKey(settings.baseUrl, settings.model);
  let sendReasoningOff = !reasoningEffortRejected.has(reasoningKey);

  type BatchRun =
    | { status: "ok"; value: PostTagMaintenanceResult }
    | { status: "truncated" }
    | { status: "failed" }
    | { status: "stopped" };

  const runBatch = async (batch: typeof visiblePosts, label: string): Promise<BatchRun> => {
    // 停用/归档的墙不必再补一轮 15 分钟重试；已完成的批次直接返回。
    if (!await isTenantRuntimeActive(prisma, options.tenantId)) return { status: "stopped" };
    const batchTags = tagsSnapshot ?? await prisma.postTag.findMany({
      where: { tenantId: options.tenantId },
      include: { _count: { select: { assignments: true } } },
      orderBy: [{ status: "asc" }, { lastUsedAt: "desc" }, { updatedAt: "desc" }],
      take: 100,
    }).catch(() => tags);
    const userPayload = JSON.stringify({
      tags: batchTags.map((tag) => ({
        name: tag.name,
        description: tag.description,
        status: tag.status,
        source: tag.source,
        postCount: tag._count.assignments,
        lastUsedAt: tag.lastUsedAt?.toISOString() ?? null,
      })),
      posts: batch.map((post) => ({
        id: post.id,
        displayId: post.displayId,
        createdAt: post.createdAt.toISOString(),
        text: post.text.slice(0, tagAgentPostTextChars),
        tags: post.tagAssignments.map((assignment) => assignment.tag.name),
      })),
      lookbackDays,
      minClusterSize,
    });
    // 输出规模按动作数估算，留约 25% 余量；仍受 4096 封顶（30 篇 → 4096）。
    const maxTokens = Math.min(4096, Math.max(2000, Math.round(800 + batch.length * 110)));

    options.logger.info(
      { site: "post-tagging.maintenance", tenantId: options.tenantId, model: settings.model, maxTokens, promptChars: systemPrompt.length + userPayload.length, posts: batch.length, batch: label, batches: batches.length, tags: batchTags.length },
      "llm request",
    );
    // LLM 网络调用不进租户租约事务（避免 180 秒级调用长时间持有 Tenant 行锁、阻塞状态切换）：
    // 每轮尝试前校验租户活跃，写库（applyTagAgentPlan）时才取 lease。
    // 失败自动重试 5 次（间隔 10 秒，整体预算 5 分钟）；仍失败走 15 分钟间隔的自动重跑。
    const retryStartedAt = Date.now();
    // 推理模型（deepseek-v4 系列等）会把 max_tokens 大半花在 reasoning 上，真正要的 JSON
    // 反而被截断。维护只需要结构化结果，显式关掉思考；thinking-only 模型（GLM-5.3 等）
    // 会拒绝这个字段，降级后 sendReasoningOff 关闭并整轮复用。
    for (let attempt = 1; attempt <= 1 + TAG_MAINTENANCE_RETRY_ATTEMPTS; attempt += 1) {
      if (attempt > 1) {
        if (Date.now() - retryStartedAt > TAG_MAINTENANCE_RETRY_BUDGET_MS) {
          options.logger.warn({ tenantId: options.tenantId, attempt, batch: label }, "post tag maintenance: retry budget exceeded");
          break;
        }
        options.logger.warn({ tenantId: options.tenantId, attempt, batch: label }, "post tag maintenance: retrying LLM request");
        await new Promise((resolve) => setTimeout(resolve, TAG_MAINTENANCE_RETRY_PAUSE_MS));
      }
      if (!await isTenantRuntimeActive(prisma, options.tenantId)) {
        return { status: "stopped" };
      }
      // 同一次 attempt 内最多两次请求；第二次是去掉 reasoning_effort 的降级探测，
      // 不消耗重试名额、也不等 10 秒退避。
      let probePending = false;
      for (let variant = 0; variant < 2; variant += 1) {
      if (variant === 1 && !probePending) break;
      const requestReasoningOff = variant === 0 ? sendReasoningOff : false;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), tagMaintenanceTimeoutMs);
      // thinking-only 模型（关不掉思考）只能用满 4096，给推理留空间。
      const requestMaxTokens = requestReasoningOff ? maxTokens : 4096;
      try {
        const response = await fetch(`${normalizeBaseUrl(settings.baseUrl)}/chat/completions`, {
          method: "POST",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(buildLlmJsonRequestBody({
            model: settings.model,
            maxTokens: requestMaxTokens,
            systemPrompt,
            userPayload,
            reasoningOff: requestReasoningOff,
          })),
        });
        const responseBody = await response.text().catch(() => "");
        let data: { choices?: Array<{ message?: { content?: string } }> } | null = null;
        try {
          data = JSON.parse(responseBody);
        } catch {
          data = null;
        }
        if (!response.ok) {
          const errorMessage = extractLlmErrorMessage(responseBody, data);
          // 4xx 一律按「可能不认识 reasoning_effort」降级一次：FastAPI 的 {detail:[...]}、
          // 网关返回纯文本或 {error:"..."} 时同样能救回来；5xx 保持原有重试语义。
          if (variant === 0 && shouldFallbackReasoning({ status: response.status, alreadyFellBack: !sendReasoningOff })) {
            probePending = true;
            // 先不动共享的 sendReasoningOff：等去掉参数的这次真的成功，才认定是参数问题。
            options.logger.info({ tenantId: options.tenantId, batch: label, status: response.status, error: errorMessage }, "post tag maintenance: retrying without reasoning_effort");
            continue;
          }
          options.logger.warn({ tenantId: options.tenantId, attempt, batch: label, status: response.status, error: errorMessage }, "post tag maintenance: LLM request failed");
          continue;
        }
        // 去掉参数后这次成功了，才认定该 baseUrl+model 不支持关闭思考，
        // 并对后续批次关闭探测；无关的 4xx（上下文超长、模型不存在）不会污染状态。
        if (variant === 1) {
          sendReasoningOff = false;
          reasoningEffortRejected.add(reasoningKey);
        }
        if (llmFinishReason(data) === "length") {
          // 原样重试只会再撞同一个上限：直接交给调用方折半。
          options.logger.warn({ tenantId: options.tenantId, posts: batch.length, maxTokens: requestMaxTokens, batch: label }, "post tag maintenance output truncated by max_tokens");
          return { status: "truncated" };
        }
        const plan = parsePostTagMaintenanceJson(data?.choices?.[0]?.message?.content ?? "");
        if (!plan) {
          // 结构非法/截断：按失败处理，走既定重试策略，而不是当成功空跑。
          options.logger.warn({ tenantId: options.tenantId, attempt, batch: label }, "post tag maintenance: llm returned invalid plan JSON");
          continue;
        }
        const planned = await runWithActiveTenantLease(
          prisma,
          options.tenantId,
          (transaction) => applyTagAgentPlan(options.tenantId, plan, batch.map((post) => post.id), options.logger, transaction),
        );
        if (!planned.active) {
          // 租约没拿到、事务未执行：这一批什么都没写，不能算成功。
          return { status: "stopped" };
        }
        return { status: "ok", value: planned.value };
      } catch (error) {
        const aborted = error instanceof Error && error.name === "AbortError";
        options.logger.warn({ error, tenantId: options.tenantId, aborted, attempt, batch: label }, "post tag maintenance: LLM call errored");
        break;
      } finally {
        clearTimeout(timeout);
      }
      }
    }
    return { status: "failed" };
  };

  // 截断就折半（30 → 15 → 8 → 4），最小 4 篇；到最小还截断才记失败，交给 15 分钟全量重跑。
  const processBatch = async (batch: typeof visiblePosts, label: string): Promise<"ok" | "failed" | "stopped"> => {
    const outcome = await runBatch(batch, label);
    if (outcome.status === "ok") {
      applied = mergeTagMaintenanceResults(applied, outcome.value);
      tagsSnapshot = null;
      return "ok";
    }
    if (outcome.status === "stopped") return "stopped";
    if (outcome.status === "truncated" && batch.length > tagMaintenanceMinSplitSize) {
      const middle = Math.ceil(batch.length / 2);
      const left = await processBatch(batch.slice(0, middle), `${label}a`);
      if (left === "stopped") return "stopped";
      const right = await processBatch(batch.slice(middle), `${label}b`);
      if (right === "stopped") return "stopped";
      // 子批各自落库，失败的那半留给下一轮重跑。
      return left === "ok" && right === "ok" ? "ok" : "failed";
    }
    return "failed";
  };

  for (const [batchIndex, batch] of batches.entries()) {
    if (!await isTenantRuntimeActive(prisma, options.tenantId)) return applied;
    const outcome = await processBatch(batch, `${batchIndex + 1}/${batches.length}`);
    if (outcome === "stopped") return applied;
    if (outcome === "ok") succeededBatches += 1;
    else failedBatches += 1;
  }

  if (failedBatches === 0) {
    clearTagMaintenanceAutoRetry(options.tenantId);
  } else {
    // 成功的批次已经落库；下一轮会按当前可见稿件重新全量分批跑一遍（打标幂等），
    // 不是只补失败的那几批，这里不做持久化断点。
    options.logger.warn({ tenantId: options.tenantId, failedBatches, succeededBatches, batches: batches.length }, "post tag maintenance: some batches failed, next run will retry the whole wall");
    scheduleTagMaintenanceAutoRetry(options.tenantId, lookbackDays, options.logger);
  }
  return {
    ...applied,
    archived: uniqueStrings([...applied.archived, ...await archiveInactive()]),
  };
    })();
  } finally {
    tagMaintenanceInFlight.delete(options.tenantId);
  }
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
      // 全程使用不抛 P2002 的容错写法（事务内 PG 的失败语句会中止整个事务，禁止 catch-recover）：
      // 1) 已存在的 llm 标签：原子恢复并刷新配色/描述；
      // 2) 已存在的人工标签：仅激活，不夺走来源与配色；
      // 3) 都不存在：PG 用 skipDuplicates 容错插入（SQLite 事务内无并发写者，先查后插不会撞键）。
      const existing = await client.postTag.findUnique({
        where: { tenantId_name: { tenantId, name: item.name } },
        select: { id: true, name: true },
      });
      await client.postTag.updateMany({
        where: { tenantId, name: item.name, source: "llm" },
        data: {
          status: "active",
          color: item.color,
          ...(item.description ? { description: item.description } : {}),
        },
      });
      await client.postTag.updateMany({
        where: { tenantId, name: item.name, source: { not: "llm" } },
        data: { status: "active" },
      });
      if (!existing && supportsSkipDuplicates) {
        await client.postTag.createMany({
          data: [{
            tenantId,
            name: item.name,
            description: item.description,
            color: item.color,
            source: "llm",
          }],
          skipDuplicates: true,
        });
      }
      const tag = await client.postTag.findUniqueOrThrow({
        where: { tenantId_name: { tenantId, name: item.name } },
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
  // 人工添加的标签（manual/user）不允许被 AI 合并/下架：先校验存在可合并的 llm 来源，
  // 再创建规范标签，避免所有来源都被保护时留下一个没有任何迁移打标的空 AI 标签。
  for (const item of plan.merge) {
    try {
      const mergeable: Array<{ id: string; name: string }> = [];
      for (const fromName of item.from) {
        if (fromName === item.into) {
          continue;
        }
        const fromTag = await client.postTag.findUnique({
          where: { tenantId_name: { tenantId, name: fromName } },
          select: { id: true, name: true, source: true },
        });
        if (!fromTag || fromTag.name === item.into || fromTag.source !== "llm") {
          continue;
        }
        mergeable.push(fromTag);
      }
      if (mergeable.length === 0) {
        continue;
      }
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
      for (const fromTag of mergeable) {
        if (fromTag.id === canonical.id) {
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
        source: true,
        createdAt: true,
        lastUsedAt: true,
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
  // 新建标签打标数为零是常态：归档只针对"创建已久且近期既无打标也无使用"的标签，
  // 否则手动刚建的标签会在第一次整理时就被归档消失。
  // 人工添加的标签（manual/user）不允许 AI 归档，只能由管理员手动删除。
  const inactiveTags = activeTags.filter((tag) => {
    if (tag.source !== "llm") {
      return false;
    }
    if (recentTagIds.has(tag.id)) {
      return false;
    }
    const lastActivity = tag.lastUsedAt ?? tag.createdAt;
    return lastActivity < recentSince;
  });
  if (inactiveTags.length === 0) {
    return [];
  }
  const inactiveIds = inactiveTags.map((tag) => tag.id);
  // 更新时原子重验不活跃条件：查询与写入之间若有稿件被打上标签（lastUsedAt 更新），
  // 该标签不再满足归档条件，避免刚被使用的标签被归档。
  const result = await client.postTag.updateMany({
    where: {
      tenantId,
      id: { in: inactiveIds },
      status: "active",
      createdAt: { lt: recentSince },
      OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: recentSince } }],
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

export type PostTagBackfillResult = {
  scannedCount: number;
  assignedCount: number;
  skippedCount: number;
  /** LLM 调用失败/响应无效而未能归类的分批数量：区别于「正常判断为零匹配」。 */
  failedChunks: number;
  /** 是否处理完本轮候选；false 表示触达预算/批数上限，剩余稿件可再次触发回溯续跑。 */
  completed: boolean;
};

const tagBackfillMaxPosts = 300;
const tagBackfillChunkSize = 25;
/** HTTP 请求内单次回溯的批数与时间预算：剩余稿件未评估时 completed=false，可再次触发续跑。 */
const tagBackfillMaxChunksPerRun = 8;
const tagBackfillBudgetMs = 45_000;

/**
 * 手动新建标签后，把 lookbackDays 窗口内的存量稿件交给 AI 判断是否属于该标签并归类。
 * 与维护 agent 不同，这里只针对一个标签做确定性回溯；新稿件仍由 autoTagPost 即时处理。
 */
export async function backfillPostsForTag(options: {
  tenantId: string;
  tagId: string;
  lookbackDays?: number | undefined;
  logger: FastifyBaseLogger;
}): Promise<PostTagBackfillResult> {
  const empty: PostTagBackfillResult = { scannedCount: 0, assignedCount: 0, skippedCount: 0, failedChunks: 0, completed: true };
  const settings = await readTenantAiSettings(options.tenantId).catch((error) => {
    options.logger.warn({ error, tenantId: options.tenantId }, "post tag backfill: failed to read AI settings");
    return null;
  });
  if (!settings || !settings.enabled || settings.mode !== "llm" || !settings.apiKeyConfigured) {
    return empty;
  }
  const apiKey = await resolveTenantAiApiKey(options.tenantId, {});
  if (!apiKey || !await isTenantRuntimeActive(prisma, options.tenantId)) {
    return empty;
  }

  const lookbackDays = clampInteger(options.lookbackDays, 7, maxTagMaintenanceLookbackDays, defaultTagMaintenanceLookbackDays);
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
  const tag = await prisma.postTag.findFirst({
    where: { id: options.tagId, tenantId: options.tenantId, status: "active" },
  });
  if (!tag) {
    return empty;
  }

  // 常驻墙上的、有正文的窗口内稿件；排除已打上该标签的。
  const candidates = await prisma.post.findMany({
    where: {
      tenantId: options.tenantId,
      text: { not: "" },
      createdAt: { gte: since },
      status: { in: [...tagMaintenancePostStatuses] },
      tagAssignments: { none: { tagId: tag.id } },
    },
    select: {
      id: true,
      displayId: true,
      text: true,
    },
    orderBy: { createdAt: "desc" },
    take: tagBackfillMaxPosts,
  });
  const result: PostTagBackfillResult = { scannedCount: candidates.length, assignedCount: 0, skippedCount: 0, failedChunks: 0, completed: true };
  if (candidates.length === 0) {
    return result;
  }

  const startedAt = Date.now();
  let chunksProcessed = 0;
  for (let offset = 0; offset < candidates.length; offset += tagBackfillChunkSize) {
    if (chunksProcessed >= tagBackfillMaxChunksPerRun || Date.now() - startedAt > tagBackfillBudgetMs) {
      // 触达批数/时间预算：本轮到此为止，剩余稿件未评估，再次触发回溯即可续跑。
      result.completed = false;
      break;
    }
    chunksProcessed += 1;
    const chunk = candidates.slice(offset, offset + tagBackfillChunkSize);
    const { matched, failed } = await classifyPostsIntoTag({
      tenantId: options.tenantId,
      settings,
      apiKey,
      tag,
      chunk,
      logger: options.logger,
    });
    if (failed) {
      // LLM 调用失败/响应无效：这一批未被真正评估，不能当作零匹配。
      result.failedChunks += 1;
      continue;
    }
    if (matched.size === 0) {
      continue;
    }
    for (const post of chunk) {
      if (!matched.has(post.id)) {
        continue;
      }
      const leased = await runWithActiveTenantLease(prisma, options.tenantId, async (tx) => {
        // PG 下锁定稿件行，防止并发打标把单稿标签数顶破上限；SQLite 单写者天然串行。
        if (supportsAdvisoryLock) {
          await tx.$queryRaw`SELECT "id" FROM "Post" WHERE "id" = ${post.id} AND "tenantId" = ${options.tenantId} FOR UPDATE`;
        }
        const assignmentCount = await tx.postTagAssignment.count({ where: { postId: post.id } });
        if (assignmentCount >= maxTagsPerPost) {
          return false;
        }
        await assignPostTags(tx, {
          tenantId: options.tenantId,
          postId: post.id,
          tags: [{ tagId: tag.id, source: "llm" }],
        });
        return true;
      });
      if (!leased.active) {
        continue;
      }
      if (leased.value) {
        result.assignedCount += 1;
      } else {
        result.skippedCount += 1;
      }
    }
  }
  if (result.assignedCount > 0) {
    await prisma.postTag.update({ where: { id: tag.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
  }
  return result;
}

/** 把一批稿件交给 LLM，判断哪些应归入指定标签；failed 表示这批因调用失败而未被真正评估。 */
async function classifyPostsIntoTag(context: {
  tenantId: string;
  settings: NonNullable<Awaited<ReturnType<typeof readTenantAiSettings>>>;
  apiKey: string;
  tag: { id: string; name: string; description: string | null };
  chunk: Array<{ id: string; displayId: number; text: string }>;
  logger: FastifyBaseLogger;
}): Promise<{ matched: Set<string>; failed: boolean }> {
  const matched = new Set<string>();
  const { settings, apiKey, tag, chunk } = context;
  const knownIds = new Set(chunk.map((post) => post.id));
  const totalChars = chunk.reduce((sum, post) => sum + post.text.length, 0);
  const maxTokens = llmOutputTokenBudget(totalChars, { floor: 300, ceiling: 1500, multiplier: 0.3, padding: 200 });
  context.logger.info(
    { site: "post-tagging.backfill", tenantId: context.tenantId, model: settings.model, posts: chunk.length, maxTokens, tag: tag.name },
    "llm request",
  );
  const systemPrompt = [
    "你是校园墙稿件标签助手。只返回 JSON，不要 Markdown。",
    `目标：判断下列稿件中哪些适合归入标签「${tag.name}」。`,
    tag.description ? `标签含义：${tag.description}` : "标签含义：按名称常见语义判断。",
    "只判断是否属于这一个标签，不要发明新标签，不要考虑其他标签。",
    "判断标准放宽：稿件主题与标签相关、接近或属于同一大类就应选中；只有明确无关时才不选。",
    "postIds 必须来自输入 posts 的 id。",
    "返回格式：{\"postIds\":[\"id1\",\"id2\"]}",
  ].join("\n");
  const userPayload = JSON.stringify({
    tag: { name: tag.name, description: tag.description },
    posts: chunk.map((post) => ({
      id: post.id,
      displayId: post.displayId,
      text: post.text.slice(0, tagAgentPostTextChars),
    })),
  });
  const reasoningKey = reasoningEffortKey(settings.baseUrl, settings.model);
  let reasoningOff = !reasoningEffortRejected.has(reasoningKey);
  const requestBody = (off: boolean) => JSON.stringify(buildLlmJsonRequestBody({
    model: settings.model,
    // 关不掉思考时用满 4096，给 reasoning 留空间；否则按文本长度估算即可。
    maxTokens: off ? maxTokens : 4096,
    systemPrompt,
    userPayload,
    reasoningOff: off,
  }));
  let controller = new AbortController();
  let timeout = setTimeout(() => controller.abort(), Math.min(settings.timeoutSeconds, 60) * 1_000);
  try {
    // LLM 网络调用不进租户租约事务：避免 60 秒级调用长时间持锁；写库在回溯循环内单独取 lease。
    const response = await fetch(`${normalizeBaseUrl(settings.baseUrl)}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: requestBody(reasoningOff),
    });
    let bodyText = await response.text().catch(() => "");
    let data: { choices?: Array<{ message?: { content?: string } }> } | null = null;
    try {
      data = JSON.parse(bodyText);
    } catch {
      data = null;
    }
    let finalResponse = response;
    let probed = false;
    if (!response.ok && shouldFallbackReasoning({ status: response.status, alreadyFellBack: !reasoningOff })) {
      probed = true;
      reasoningOff = false;
      // 降级请求单独计时：首次请求可能已经耗掉大半 60 秒预算。
      clearTimeout(timeout);
      controller = new AbortController();
      timeout = setTimeout(() => controller.abort(), Math.min(settings.timeoutSeconds, 60) * 1_000);
      context.logger.info({ tag: tag.name, status: response.status, error: extractLlmErrorMessage(bodyText, data) }, "post tag backfill: retrying without reasoning_effort");
      finalResponse = await fetch(`${normalizeBaseUrl(settings.baseUrl)}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: requestBody(false),
      });
      bodyText = await finalResponse.text().catch(() => "");
      try {
        data = JSON.parse(bodyText);
      } catch {
        data = null;
      }
    }
    if (!finalResponse.ok || !data) {
      context.logger.warn(
        { tag: tag.name, status: finalResponse.status, error: extractLlmErrorMessage(bodyText, data) || null },
        "post tag backfill: llm request failed",
      );
      return { matched, failed: true };
    }
    if (probed) reasoningEffortRejected.add(reasoningKey);
    const raw = data.choices?.[0]?.message?.content ?? "";
    try {
      const parsed = JSON.parse(raw) as { postIds?: unknown };
      if (Array.isArray(parsed.postIds)) {
        for (const id of parsed.postIds) {
          if (typeof id === "string" && knownIds.has(id)) {
            matched.add(id);
          }
        }
      }
    } catch {
      context.logger.warn({ tag: tag.name, raw: raw.slice(0, 200) }, "post tag backfill: llm returned unparseable JSON");
      return { matched, failed: true };
    }
    return { matched, failed: false };
  } catch (caught) {
    context.logger.warn({ error: caught, tag: tag.name }, "post tag backfill: llm request threw");
    return { matched, failed: true };
  } finally {
    clearTimeout(timeout);
  }
}
