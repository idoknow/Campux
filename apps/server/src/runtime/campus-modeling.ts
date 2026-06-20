import type { FastifyBaseLogger } from "fastify";
import { PRIVATE_POST_PROMPT_MAX_LENGTH } from "@campux/domain";
import { Prisma, DbNull, createManyDedup } from "@campux/db";
import { prisma } from "../lib/prisma";
import { decryptJson, encryptJson } from "../lib/secret-json";
import type { RuntimeJob, RuntimeQueue } from "./queue";

export type TenantAiSettingsPayload = {
  enabled: boolean;
  mode: "local" | "llm";
  provider: string;
  baseUrl: string;
  model: string;
  apiKeyConfigured: boolean;
  temperature: number;
  timeoutSeconds: number;
  rules: AiRules;
};

export type AiRules = {
  tone?: string | undefined;
  strictPrivacy?: boolean | undefined;
  allowedCategories?: string[] | undefined;
  modelingKeywords?: string[] | undefined;
  modelingNotes?: string | undefined;
  /** 是否启用私聊投稿 AI 语义收稿 */
  privatePostAiEnabled?: boolean | undefined;
  /** 私聊 AI 聚合收稿等待秒数，0 表示不聚合 */
  privatePostAggregateDelaySeconds?: number | undefined;
  /** 对话投稿额外触发关键词，如 ["发帖", "吐槽", "表白"]，不含 # 前缀 */
  postTriggerKeywords?: string[] | undefined;
  /** 私聊投稿 AI 语义收稿的补充提示词 */
  privatePostPrompt?: string | undefined;
};

type ExtractedEntity = {
  type: string;
  name: string;
  confidence: number;
  evidence: string;
};

type AnalysisResult = {
  confidence: number;
  categories: string[];
  entities: ExtractedEntity[];
  reasons: string[];
  rawOutput?: Prisma.InputJsonValue;
};

export type TenantAiSettingsUpdate = {
  enabled?: boolean | undefined;
  mode?: "local" | "llm" | undefined;
  provider?: string | undefined;
  baseUrl?: string | undefined;
  model?: string | undefined;
  apiKey?: string | null | undefined;
  clearApiKey?: boolean | undefined;
  temperature?: number | undefined;
  timeoutSeconds?: number | undefined;
  rules?: AiRules | undefined;
};

export type TenantAiSettingsTestResult = {
  ok: boolean;
  mode: "local" | "llm";
  provider: string;
  model: string;
  baseUrl: string;
  latencyMs: number | null;
  message: string;
};

export type AiBackfillMode = "missing" | "failed" | "all";

export type CreateAiBackfillOptions = {
  mode?: AiBackfillMode | undefined;
  maxAttempts?: number | undefined;
  limit?: number | undefined;
};

const defaultAiSettings: TenantAiSettingsPayload = {
  enabled: true,
  mode: "local",
  provider: "openai_compatible",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4.1-mini",
  apiKeyConfigured: false,
  temperature: 0.2,
  timeoutSeconds: 30,
  rules: {
    tone: "提取校园空间、组织、活动和常见话题，沉淀学校上下文",
    strictPrivacy: true,
    allowedCategories: ["表白", "失物招领", "二手", "活动宣传", "树洞", "校园生活", "求助", "社团活动"],
    modelingKeywords: [],
    modelingNotes: "仅用于校园建模，专注实体、话题和关系抽取",
    privatePostAiEnabled: false,
    privatePostAggregateDelaySeconds: 8,
    postTriggerKeywords: [],
    privatePostPrompt: "",
  },
};

const activeBackfillStatuses = ["queued", "running"] as const;
const backfillDispatchSize = 1;

const campusTopicPhrases = [
  "兼职",
  "外卖群",
  "失物招领",
  "二手",
  "表白",
  "树洞",
  "社团",
  "比赛",
  "讲座",
  "活动",
  "拼车",
  "拼单",
];

const locationPattern = /[\u4e00-\u9fa5A-Za-z0-9]{1,12}(?:楼|门|食堂|操场|图书馆|宿舍|校区|教室|广场|体育馆|实验室|超市|快递站|奶茶店|门口)/g;
const classPattern = /(?:高|初|大)?[一二三四五六七八九十0-9]{1,4}(?:年级|级)?[\u4e00-\u9fa5A-Za-z]{0,8}[一二三四五六七八九十0-9]{1,3}班/g;
const phonePattern = /(?:\+?86[- ]?)?1[3-9]\d{9}/g;
const qqPattern = /(?:QQ|qq|企鹅|扣扣)[:：\s]*[1-9]\d{4,11}/g;
const wechatPattern = /(?:微信|vx|VX|v信)[:：\s]*[A-Za-z][-_A-Za-z0-9]{5,19}/g;
const personPattern = /[\u4e00-\u9fa5]{1,3}(?:同学|老师|主任|宿管|导员|辅导员|学长|学姐|哥|姐)/g;

const entityTypeLabels: Record<string, string> = {
  location: "地点",
  class: "班级",
  person_alias: "人物称呼",
  organization: "组织",
  topic: "话题",
  event: "活动",
  service: "服务入口",
  contact: "联系方式",
};

export function registerCampusModelingWorker(queue: RuntimeQueue, logger: FastifyBaseLogger) {
  queue.registerHandler("aiAnalyzePost", async (job) => {
    await handleAiAnalyzePost(job, logger);
  });
  queue.registerHandler("refreshSchoolModel", async (job) => {
    await refreshSchoolModelSnapshot(job.tenantId);
  });
  queue.registerHandler("aiBackfillBatch", async (job) => {
    await handleAiBackfillBatch(queue, job, logger);
  });
  queue.registerHandler("aiBackfillItem", async (job) => {
    await handleAiBackfillItem(queue, job, logger);
  });
}

export function enqueueAiAnalyzePost(queue: RuntimeQueue, tenantId: string, postId: string) {
  return queue.enqueue({
    name: "aiAnalyzePost",
    tenantId,
    payload: { postId },
    runAt: new Date(),
  });
}

function enqueueAiBackfillBatch(queue: RuntimeQueue, tenantId: string, batchId: string, runAt = new Date()) {
  return queue.enqueue({
    name: "aiBackfillBatch",
    tenantId,
    payload: { batchId },
    runAt,
  });
}

function enqueueAiBackfillItem(queue: RuntimeQueue, tenantId: string, batchId: string, itemId: string, runAt = new Date()) {
  return queue.enqueue({
    name: "aiBackfillItem",
    tenantId,
    payload: { batchId, itemId },
    runAt,
  });
}

export async function readTenantAiSettings(tenantId: string): Promise<TenantAiSettingsPayload> {
  const settings = await prisma.tenantAiSettings.findUnique({
    where: { tenantId },
  });
  if (!settings) {
    return defaultAiSettings;
  }

  return {
    enabled: settings.enabled,
    mode: normalizeMode(settings.mode),
    provider: settings.provider,
    baseUrl: settings.baseUrl,
    model: settings.model,
    apiKeyConfigured: Boolean(settings.apiKeySecret),
    temperature: clampNumber(settings.temperature, 0, 1, defaultAiSettings.temperature),
    timeoutSeconds: Math.max(5, Math.min(120, settings.timeoutSeconds)),
    rules: normalizeRules(settings.rules),
  };
}

export async function updateTenantAiSettings(
  tenantId: string,
  input: TenantAiSettingsUpdate,
) {
  const existing = await prisma.tenantAiSettings.findUnique({ where: { tenantId } });
  const apiKeySecret =
    input.clearApiKey
      ? DbNull
      : input.apiKey && input.apiKey.trim().length > 0
        ? encryptJson({ apiKey: input.apiKey.trim() })
        : existing?.apiKeySecret ?? DbNull;

  await prisma.tenantAiSettings.upsert({
    where: { tenantId },
    update: {
      ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
      ...(input.mode === undefined ? {} : { mode: normalizeMode(input.mode) }),
      ...(input.provider === undefined ? {} : { provider: input.provider }),
      ...(input.baseUrl === undefined ? {} : { baseUrl: normalizeBaseUrl(input.baseUrl) }),
      ...(input.model === undefined ? {} : { model: input.model.trim() || defaultAiSettings.model }),
      apiKeySecret,
      ...(input.temperature === undefined ? {} : { temperature: clampNumber(input.temperature, 0, 1, defaultAiSettings.temperature) }),
      ...(input.timeoutSeconds === undefined ? {} : { timeoutSeconds: Math.max(5, Math.min(120, input.timeoutSeconds)) }),
      ...(input.rules === undefined ? {} : { rules: normalizeRules(input.rules) as Prisma.InputJsonValue }),
    },
    create: {
      tenantId,
      enabled: input.enabled ?? defaultAiSettings.enabled,
      mode: normalizeMode(input.mode ?? defaultAiSettings.mode),
      provider: input.provider ?? defaultAiSettings.provider,
      baseUrl: normalizeBaseUrl(input.baseUrl ?? defaultAiSettings.baseUrl),
      model: input.model?.trim() || defaultAiSettings.model,
      apiKeySecret,
      temperature: clampNumber(input.temperature ?? defaultAiSettings.temperature, 0, 1, defaultAiSettings.temperature),
      timeoutSeconds: Math.max(5, Math.min(120, input.timeoutSeconds ?? defaultAiSettings.timeoutSeconds)),
      rules: normalizeRules(input.rules ?? defaultAiSettings.rules) as Prisma.InputJsonValue,
    },
  });

  return readTenantAiSettings(tenantId);
}

export async function testTenantAiSettings(
  tenantId: string,
  input: TenantAiSettingsUpdate,
): Promise<TenantAiSettingsTestResult> {
  const current = await readTenantAiSettings(tenantId);
  const mode = normalizeMode(input.mode ?? current.mode);
  const provider = input.provider?.trim() || current.provider;
  const baseUrl = normalizeBaseUrl(input.baseUrl ?? current.baseUrl);
  const model = input.model?.trim() || current.model;
  const timeoutSeconds = Math.max(5, Math.min(120, input.timeoutSeconds ?? current.timeoutSeconds));

  if (mode !== "llm") {
    return {
      ok: true,
      mode,
      provider,
      model,
      baseUrl,
      latencyMs: null,
      message: "当前是本地规则模式，不需要连接 LLM。",
    };
  }

  const apiKey = await resolveTenantAiApiKey(tenantId, input);
  if (!apiKey) {
    return {
      ok: false,
      mode,
      provider,
      model,
      baseUrl,
      latencyMs: null,
      message: "未配置 LLM API Key。",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutSeconds * 1_000);
  const startedAt = Date.now();
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 32,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "只返回 JSON。",
          },
          {
            role: "user",
            content: "请返回 {\"ok\":true,\"message\":\"ready\"}",
          },
        ],
      }),
    });
    const latencyMs = Date.now() - startedAt;
    const data = await response.json().catch(() => null) as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } } | null;
    if (!response.ok) {
      return {
        ok: false,
        mode,
        provider,
        model,
        baseUrl,
        latencyMs,
        message: data?.error?.message || `LLM 请求失败：${response.status}`,
      };
    }
    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      return {
        ok: false,
        mode,
        provider,
        model,
        baseUrl,
        latencyMs,
        message: "LLM 已响应，但没有返回内容。",
      };
    }
    return {
      ok: true,
      mode,
      provider,
      model,
      baseUrl,
      latencyMs,
      message: "LLM 配置可用。",
    };
  } catch (error) {
    return {
      ok: false,
      mode,
      provider,
      model,
      baseUrl,
      latencyMs: Date.now() - startedAt,
      message: error instanceof Error && error.name === "AbortError" ? "LLM 测试超时。" : error instanceof Error ? error.message : "LLM 测试失败。",
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function recoverAiBackfillJobs(queue: RuntimeQueue, logger: FastifyBaseLogger) {
  await prisma.aiBackfillItem.updateMany({
    where: { status: "running" },
    data: {
      status: "queued",
      nextRunAt: new Date(),
      startedAt: null,
    },
  });

  const batches = await prisma.aiBackfillBatch.findMany({
    where: {
      status: {
        in: [...activeBackfillStatuses],
      },
    },
    select: {
      id: true,
      tenantId: true,
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  for (const batch of batches) {
    enqueueAiBackfillBatch(queue, batch.tenantId, batch.id);
  }

  logger.info({ count: batches.length }, "ai backfill batches recovered");
}

export async function createAiBackfillBatch(queue: RuntimeQueue, tenantId: string, actorId: string | null, options: CreateAiBackfillOptions = {}) {
  const mode = normalizeBackfillMode(options.mode);
  const maxAttempts = Math.max(1, Math.min(8, Math.floor(options.maxAttempts ?? 3)));
  const limit = options.limit === undefined ? undefined : Math.max(1, Math.floor(options.limit));

  const active = await prisma.aiBackfillBatch.findFirst({
    where: {
      tenantId,
      status: {
        in: [...activeBackfillStatuses],
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });
  if (active) {
    enqueueAiBackfillBatch(queue, tenantId, active.id);
    return {
      batch: await serializeBackfillBatch(active.id),
      created: false,
    };
  }

  const posts = await prisma.post.findMany({
    where: backfillPostWhere(tenantId, mode),
    select: {
      id: true,
    },
    orderBy: {
      createdAt: "asc",
    },
    ...(limit ? { take: limit } : {}),
  });

  const batch = await prisma.$transaction(async (tx) => {
    const created = await tx.aiBackfillBatch.create({
      data: {
        tenantId,
        actorId,
        status: posts.length === 0 ? "completed" : "queued",
        mode,
        totalCount: posts.length,
        queuedCount: posts.length,
        maxAttempts,
        ...(posts.length === 0 ? { startedAt: new Date(), finishedAt: new Date() } : {}),
      },
    });

    if (posts.length > 0) {
      await createManyDedup(
        tx.aiBackfillItem,
        posts.map((post) => ({
          tenantId,
          batchId: created.id,
          postId: post.id,
          status: "queued" as const,
          nextRunAt: new Date(),
        })),
        (row) => `${row.batchId}:${row.postId}`,
      );
    }

    await tx.aiBackfillLog.create({
      data: {
        tenantId,
        batchId: created.id,
        event: "batch.created",
        message: posts.length === 0 ? "没有需要补分析的稿件。" : `已创建批量分析任务，共 ${posts.length} 条稿件。`,
        detail: { mode, totalCount: posts.length, maxAttempts },
      },
    });

    return created;
  });

  if (posts.length > 0) {
    enqueueAiBackfillBatch(queue, tenantId, batch.id);
  }

  return {
    batch: await serializeBackfillBatch(batch.id),
    created: true,
  };
}

export async function retryAiBackfillBatch(queue: RuntimeQueue, tenantId: string, batchId: string) {
  const batch = await prisma.aiBackfillBatch.findFirst({
    where: { id: batchId, tenantId },
  });
  if (!batch) {
    throw new Error("批量分析任务不存在");
  }

  const retried = await prisma.aiBackfillItem.updateMany({
    where: {
      tenantId,
      batchId,
      status: "failed",
      attempts: {
        lt: batch.maxAttempts,
      },
    },
    data: {
      status: "queued",
      nextRunAt: new Date(),
      lastError: null,
      finishedAt: null,
    },
  });

  if (retried.count > 0) {
    await prisma.aiBackfillBatch.update({
      where: { id: batchId },
      data: {
        status: "queued",
        finishedAt: null,
        lastError: null,
      },
    });
    await appendBackfillLog(tenantId, batchId, "info", "batch.retry", `已重新排队 ${retried.count} 条失败稿件。`, { count: retried.count });
    enqueueAiBackfillBatch(queue, tenantId, batchId);
  }

  await updateBackfillBatchCounts(batchId);
  return serializeBackfillBatch(batchId);
}

export async function cancelAiBackfillBatch(tenantId: string, batchId: string) {
  const batch = await prisma.aiBackfillBatch.findFirst({
    where: {
      id: batchId,
      tenantId,
      status: {
        in: [...activeBackfillStatuses],
      },
    },
  });
  if (!batch) {
    throw new Error("没有可取消的批量分析任务");
  }

  await prisma.$transaction([
    prisma.aiBackfillItem.updateMany({
      where: {
        tenantId,
        batchId,
        status: {
          in: ["queued", "running"],
        },
      },
      data: {
        status: "cancelled",
        finishedAt: new Date(),
      },
    }),
    prisma.aiBackfillBatch.update({
      where: { id: batchId },
      data: {
        status: "cancelled",
        finishedAt: new Date(),
      },
    }),
    prisma.aiBackfillLog.create({
      data: {
        tenantId,
        batchId,
        level: "warn",
        event: "batch.cancelled",
        message: "批量分析任务已取消。",
      },
    }),
  ]);

  await updateBackfillBatchCounts(batchId);
  return serializeBackfillBatch(batchId);
}

export async function listAiBackfillBatches(tenantId: string) {
  const batches = await prisma.aiBackfillBatch.findMany({
    where: { tenantId },
    include: {
      logs: {
        orderBy: { createdAt: "desc" },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return batches.map(serializeBackfillBatchRecord);
}

async function handleAiAnalyzePost(job: RuntimeJob, logger: FastifyBaseLogger) {
  const postId = typeof job.payload.postId === "string" ? job.payload.postId : "";
  if (!postId) {
    return;
  }

  try {
    await analyzePostText(job.tenantId, postId);
  } catch (error) {
    logger.warn({ error, postId }, "ai post analysis failed");
    await prisma.postAiAnalysis.upsert({
      where: { postId },
      update: {
        status: "failed",
        error: error instanceof Error ? error.message : "AI 分析失败",
      },
      create: {
        tenantId: job.tenantId,
        postId,
        provider: "local",
        model: "text-rules",
        status: "failed",
        error: error instanceof Error ? error.message : "AI 分析失败",
      },
    }).catch(() => undefined);
  }
}

async function handleAiBackfillBatch(queue: RuntimeQueue, job: RuntimeJob, logger: FastifyBaseLogger) {
  const batchId = typeof job.payload.batchId === "string" ? job.payload.batchId : "";
  if (!batchId) {
    return;
  }

  const batch = await prisma.aiBackfillBatch.findFirst({
    where: {
      id: batchId,
      tenantId: job.tenantId,
    },
  });
  if (!batch || !activeBackfillStatuses.includes(batch.status as (typeof activeBackfillStatuses)[number])) {
    return;
  }

  if (batch.status === "queued") {
    await prisma.aiBackfillBatch.update({
      where: { id: batch.id },
      data: {
        status: "running",
        startedAt: batch.startedAt ?? new Date(),
      },
    });
    await appendBackfillLog(batch.tenantId, batch.id, "info", "batch.started", "批量分析任务开始执行。", {});
  }

  await updateBackfillBatchCounts(batch.id);

  const readyItems = await prisma.aiBackfillItem.findMany({
    where: {
      tenantId: batch.tenantId,
      batchId: batch.id,
      status: "queued",
      nextRunAt: {
        lte: new Date(),
      },
    },
    orderBy: [{ nextRunAt: "asc" }, { createdAt: "asc" }],
    take: backfillDispatchSize,
  });

  if (readyItems.length > 0) {
    for (const item of readyItems) {
      enqueueAiBackfillItem(queue, batch.tenantId, batch.id, item.id);
    }
    return;
  }

  const pendingRetry = await prisma.aiBackfillItem.findFirst({
    where: {
      tenantId: batch.tenantId,
      batchId: batch.id,
      status: "queued",
    },
    orderBy: {
      nextRunAt: "asc",
    },
  });
  if (pendingRetry) {
    enqueueAiBackfillBatch(queue, batch.tenantId, batch.id, pendingRetry.nextRunAt);
    return;
  }

  const runningCount = await prisma.aiBackfillItem.count({
    where: {
      tenantId: batch.tenantId,
      batchId: batch.id,
      status: "running",
    },
  });
  if (runningCount > 0) {
    enqueueAiBackfillBatch(queue, batch.tenantId, batch.id, new Date(Date.now() + 2_000));
    return;
  }

  const counts = await updateBackfillBatchCounts(batch.id);
  if (counts.finished >= counts.total) {
    const finalStatus = counts.failed > 0 ? "completed_with_errors" : "completed";
    await prisma.aiBackfillBatch.update({
      where: { id: batch.id },
      data: {
        status: finalStatus,
        finishedAt: new Date(),
        lastError: counts.failed > 0 ? `${counts.failed} 条稿件分析失败` : null,
      },
    });
    await refreshSchoolModelSnapshot(batch.tenantId);
    await appendBackfillLog(
      batch.tenantId,
      batch.id,
      counts.failed > 0 ? "warn" : "info",
      "batch.finished",
      counts.failed > 0 ? `批量分析完成，但有 ${counts.failed} 条失败。` : "批量分析已全部完成。",
      counts,
    );
    logger.info({ batchId: batch.id, tenantId: batch.tenantId, ...counts }, "ai backfill batch finished");
  }
}

async function handleAiBackfillItem(queue: RuntimeQueue, job: RuntimeJob, logger: FastifyBaseLogger) {
  const batchId = typeof job.payload.batchId === "string" ? job.payload.batchId : "";
  const itemId = typeof job.payload.itemId === "string" ? job.payload.itemId : "";
  if (!batchId || !itemId) {
    return;
  }

  const item = await prisma.aiBackfillItem.findFirst({
    where: {
      id: itemId,
      batchId,
      tenantId: job.tenantId,
    },
    include: {
      batch: true,
      post: {
        select: {
          displayId: true,
        },
      },
    },
  });
  if (!item || item.status !== "queued" || item.nextRunAt.getTime() > Date.now()) {
    return;
  }
  if (!activeBackfillStatuses.includes(item.batch.status as (typeof activeBackfillStatuses)[number])) {
    return;
  }

  const claimed = await prisma.aiBackfillItem.updateMany({
    where: {
      id: item.id,
      status: "queued",
      nextRunAt: {
        lte: new Date(),
      },
    },
    data: {
      status: "running",
      attempts: {
        increment: 1,
      },
      startedAt: new Date(),
      lastError: null,
    },
  });
  if (claimed.count !== 1) {
    return;
  }

  const attemptNumber = item.attempts + 1;
  try {
    const existingCompleted = await prisma.postAiAnalysis.findUnique({
      where: { postId: item.postId },
      select: { status: true },
    });
    if (item.batch.mode === "missing" && existingCompleted?.status === "completed") {
      await prisma.aiBackfillItem.update({
        where: { id: item.id },
        data: {
          status: "skipped",
          finishedAt: new Date(),
          lastError: null,
        },
      });
    } else {
      await analyzePostText(item.tenantId, item.postId, { refreshSnapshot: false });
      await prisma.aiBackfillItem.update({
        where: { id: item.id },
        data: {
          status: "succeeded",
          finishedAt: new Date(),
          lastError: null,
        },
      });
    }

    const counts = await updateBackfillBatchCounts(item.batchId);
    if (counts.processed > 0 && (counts.processed === counts.total || counts.processed % 25 === 0)) {
      await appendBackfillLog(item.tenantId, item.batchId, "info", "batch.progress", `已处理 ${counts.processed}/${counts.total} 条稿件。`, counts);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI 分析失败";
    const exhausted = attemptNumber >= item.batch.maxAttempts;
    const nextRunAt = new Date(Date.now() + retryDelayMs(attemptNumber));
    await prisma.aiBackfillItem.update({
      where: { id: item.id },
      data: {
        status: exhausted ? "failed" : "queued",
        nextRunAt: exhausted ? new Date() : nextRunAt,
        finishedAt: exhausted ? new Date() : null,
        lastError: message,
      },
    });
    await prisma.aiBackfillBatch.update({
      where: { id: item.batchId },
      data: {
        lastError: message,
      },
    });
    await appendBackfillLog(
      item.tenantId,
      item.batchId,
      exhausted ? "error" : "warn",
      exhausted ? "item.failed" : "item.retry",
      exhausted ? `#${item.post.displayId} 分析失败，已达到最大重试次数。` : `#${item.post.displayId} 分析失败，将稍后重试。`,
      {
        postId: item.postId,
        displayId: item.post.displayId,
        attempt: attemptNumber,
        maxAttempts: item.batch.maxAttempts,
        error: message,
        ...(exhausted ? {} : { nextRunAt: nextRunAt.toISOString() }),
      },
    );
    logger.warn({ error, batchId: item.batchId, itemId: item.id, postId: item.postId, attempt: attemptNumber }, "ai backfill item failed");
  } finally {
    enqueueAiBackfillBatch(queue, item.tenantId, item.batchId, new Date(Date.now() + 100));
  }
}

export async function analyzePostText(tenantId: string, postId: string, options: { refreshSnapshot?: boolean } = {}) {
  const [settings, post, snapshot] = await Promise.all([
    readTenantAiSettings(tenantId),
    prisma.post.findFirst({
      where: { tenantId, id: postId },
      include: {
        author: {
          select: {
            id: true,
            qqUin: true,
            displayName: true,
          },
        },
      },
    }),
    prisma.schoolModelSnapshot.findFirst({
      where: { tenantId, status: "active" },
      orderBy: { version: "desc" },
    }),
  ]);

  if (!post) {
    throw new Error("稿件不存在");
  }

  const provider = settings.mode === "llm" && settings.apiKeyConfigured ? settings.provider : "local";
  const model = settings.mode === "llm" && settings.apiKeyConfigured ? settings.model : "text-rules-v1";

  await prisma.postAiAnalysis.upsert({
    where: { postId },
    update: {
      status: settings.enabled ? "running" : "skipped",
      provider,
      model,
      modelSnapshotId: snapshot?.id ?? null,
      error: null,
    },
    create: {
      tenantId,
      postId,
      modelSnapshotId: snapshot?.id ?? null,
      provider,
      model,
      status: settings.enabled ? "running" : "skipped",
    },
  });

  if (!settings.enabled) {
    return prisma.postAiAnalysis.findUniqueOrThrow({ where: { postId } });
  }

  const baseResult = analyzeTextLocally(post.text, settings.rules);
  const result = settings.mode === "llm" && settings.apiKeyConfigured
    ? await analyzeTextWithLlm({
      tenantId,
      text: post.text,
      settings,
      localResult: baseResult,
      snapshot,
    }).catch((error) => ({
      ...baseResult,
      providerError: error instanceof Error ? error.message : "LLM 调用失败",
    } as AnalysisResult & { providerError: string }))
    : baseResult;

  const analysis = await prisma.postAiAnalysis.update({
    where: { postId },
    data: {
      status: "completed",
      provider: "providerError" in result ? "local_fallback" : provider,
      model: "providerError" in result ? "text-rules-v1" : model,
      confidence: result.confidence,
      categories: result.categories,
      entities: result.entities as unknown as Prisma.InputJsonValue,
      reasons: result.reasons,
      rawOutput: {
        raw: result.rawOutput ?? null,
        ...("providerError" in result ? { providerError: result.providerError } : {}),
        textOnly: true,
      } as Prisma.InputJsonValue,
      error: null,
    },
  });

  await upsertSchoolEntities(tenantId, analysis.id, postId, result.entities);
  if (options.refreshSnapshot !== false) {
    await refreshSchoolModelSnapshot(tenantId);
  }
  return analysis;
}

function analyzeTextLocally(text: string, rules: AiRules): AnalysisResult {
  const normalized = text.trim();
  const entities: ExtractedEntity[] = [];
  const categories = inferCategories(normalized, rules);

  collectPatternEntities(normalized, locationPattern, "location", 0.62, entities);
  collectPatternEntities(normalized, classPattern, "class", 0.82, entities);
  collectPatternEntities(normalized, personPattern, "person_alias", 0.7, entities);
  collectPatternEntities(normalized, phonePattern, "contact", 0.78, entities);
  collectPatternEntities(normalized, qqPattern, "contact", 0.76, entities);
  collectPatternEntities(normalized, wechatPattern, "contact", 0.76, entities);

  for (const phrase of campusTopicPhrases) {
    if (normalized.toLowerCase().includes(phrase.toLowerCase())) {
      entities.push({
        type: "topic",
        name: phrase,
        confidence: 0.72,
        evidence: phrase,
      });
    }
  }

  const uniqueEntities = dedupeEntities(entities);
  const reasons: string[] = [];

  if (uniqueEntities.length > 0) {
    const typeCounts = countBy(uniqueEntities.map((entity) => entity.type));
    reasons.push(`抽取 ${uniqueEntities.length} 个校园实体：${Object.entries(typeCounts).map(([type, count]) => `${entityTypeLabels[type] ?? type} ${count}`).join("、")}`);
  } else {
    reasons.push("未抽取到稳定校园实体，保留为普通文本样本。");
  }

  if (categories.length > 0) {
    reasons.push(`归入校园话题：${categories.join("、")}`);
  }

  return {
    confidence: uniqueEntities.length > 0 ? 0.78 : 0.58,
    categories,
    entities: uniqueEntities,
    reasons,
    rawOutput: {
      analyzer: "campus-modeling-local-v1",
      textLength: normalized.length,
    },
  };
}

async function analyzeTextWithLlm(options: {
  tenantId: string;
  text: string;
  settings: TenantAiSettingsPayload;
  localResult: AnalysisResult;
  snapshot: { summary: string; entities: Prisma.JsonValue; modelingMemory: Prisma.JsonValue; rules: Prisma.JsonValue } | null;
}): Promise<AnalysisResult> {
  const apiKey = await resolveTenantAiApiKey(options.tenantId, {});
  if (!apiKey) {
    throw new Error("未配置 LLM API Key");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.settings.timeoutSeconds * 1_000);
  try {
    const response = await fetch(`${normalizeBaseUrl(options.settings.baseUrl)}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: options.settings.model,
        temperature: options.settings.temperature,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "你是校园建模助手。只从文本中抽取校园空间、班级组织、人物称呼、服务入口、活动和话题等建模信息。输出严格 JSON，不要输出 Markdown。",
          },
          {
            role: "user",
            content: JSON.stringify({
              tenantRules: options.settings.rules,
              schoolModel: options.snapshot
                ? {
                  summary: options.snapshot.summary,
                  entities: options.snapshot.entities,
                  rules: options.snapshot.rules,
                }
                : null,
              post: {
                text: options.text,
              },
              localSignals: options.localResult,
              outputSchema: {
                confidence: "0-1",
                categories: ["string"],
                entities: [{ type: "location|class|person_alias|organization|topic|service|contact|event", name: "string", confidence: "0-1", evidence: "string" }],
                reasons: ["string describing why these entities/categories are useful for campus modeling"],
              },
            }),
          },
        ],
      }),
    });

    const data = await response.json().catch(() => null) as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } } | null;
    if (!response.ok) {
      throw new Error(data?.error?.message || `LLM 请求失败：${response.status}`);
    }
    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("LLM 未返回内容");
    }
    const parsed = JSON.parse(content) as Partial<AnalysisResult>;
    return normalizeAnalysisResult(parsed, options.localResult, data as unknown as Prisma.InputJsonValue);
  } finally {
    clearTimeout(timeout);
  }
}

export async function resolveTenantAiApiKey(tenantId: string, input: Pick<TenantAiSettingsUpdate, "apiKey" | "clearApiKey">) {
  if (input.apiKey && input.apiKey.trim().length > 0) {
    return input.apiKey.trim();
  }
  if (input.clearApiKey) {
    return "";
  }
  const settings = await prisma.tenantAiSettings.findUnique({ where: { tenantId } });
  const secret = settings?.apiKeySecret ? decryptJson(settings.apiKeySecret) : null;
  return secret && typeof secret === "object" && "apiKey" in secret ? String(secret.apiKey) : "";
}

function normalizeAnalysisResult(parsed: Partial<AnalysisResult>, fallback: AnalysisResult, rawOutput: Prisma.InputJsonValue): AnalysisResult {
  return {
    confidence: clampNumber(parsed.confidence, 0, 1, fallback.confidence),
    categories: normalizeStringArray(parsed.categories ?? fallback.categories),
    entities: Array.isArray(parsed.entities) ? parsed.entities.map(normalizeEntity).filter((entity): entity is ExtractedEntity => Boolean(entity)) : fallback.entities,
    reasons: normalizeStringArray(parsed.reasons ?? fallback.reasons),
    rawOutput,
  };
}

async function upsertSchoolEntities(tenantId: string, analysisId: string, postId: string, entities: ExtractedEntity[]) {
  for (const entity of entities) {
    const existing = await prisma.schoolEntity.findUnique({
      where: {
        tenantId_type_name: {
          tenantId,
          type: entity.type,
          name: entity.name,
        },
      },
    });
    const evidence = [
      ...normalizeEvidence(existing?.evidence),
      {
        postId,
        analysisId,
        text: entity.evidence,
        seenAt: new Date().toISOString(),
      },
    ];

    await prisma.schoolEntity.upsert({
      where: {
        tenantId_type_name: {
          tenantId,
          type: entity.type,
          name: entity.name,
        },
      },
      update: {
        confidence: Math.min(0.99, Math.max(existing?.confidence ?? 0.5, entity.confidence) + 0.03),
        source: existing?.source ?? "ai_extract",
        evidence: evidence as Prisma.InputJsonValue,
        lastSeenAt: new Date(),
      },
      create: {
        tenantId,
        type: entity.type,
        name: entity.name,
        aliases: [],
        confidence: entity.confidence,
        source: "ai_extract",
        evidence: evidence as Prisma.InputJsonValue,
      },
    });
  }
}

export async function refreshSchoolModelSnapshot(tenantId: string) {
  const [settings, entities, analyses, latest] = await Promise.all([
    readTenantAiSettings(tenantId),
    prisma.schoolEntity.findMany({
      where: { tenantId },
      orderBy: [{ confidence: "desc" }, { lastSeenAt: "desc" }],
    }),
    prisma.postAiAnalysis.findMany({
      where: { tenantId, status: "completed" },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.schoolModelSnapshot.findFirst({
      where: { tenantId },
      orderBy: { version: "desc" },
      select: { version: true },
    }),
  ]);

  const categoryCounts = countBy(analyses.flatMap((analysis) => normalizeStringArray(analysis.categories)));
  const entityTypeCounts = countBy(entities.map((entity) => entity.type));
  const topModelingSignals = topStrings(analyses.flatMap((analysis) => normalizeStringArray(analysis.reasons)));
  const summary = buildSnapshotSummary(entities.length, analyses.length, categoryCounts, entityTypeCounts);

  await prisma.schoolModelSnapshot.updateMany({
    where: {
      tenantId,
      status: "active",
    },
    data: {
      status: "superseded",
    },
  });

  return prisma.schoolModelSnapshot.create({
    data: {
      tenantId,
      version: (latest?.version ?? 0) + 1,
      status: "active",
      summary,
      entities: entities.map((entity) => ({
        id: entity.id,
        type: entity.type,
        name: entity.name,
        confidence: entity.confidence,
        source: entity.source,
        firstSeenAt: entity.firstSeenAt.toISOString(),
        lastSeenAt: entity.lastSeenAt.toISOString(),
      })) as Prisma.InputJsonValue,
      modelingMemory: {
        purpose: "campus_modeling",
        categoryCounts,
        entityTypeCounts,
        topModelingSignals,
        recentSamples: analyses
          .map((analysis) => ({
            postId: analysis.postId,
            categories: normalizeStringArray(analysis.categories),
            reasons: normalizeStringArray(analysis.reasons),
            updatedAt: analysis.updatedAt.toISOString(),
          })),
      } as Prisma.InputJsonValue,
      rules: settings.rules as Prisma.InputJsonValue,
      metrics: {
        totalEntities: entities.length,
        entityTypeCounts,
        categoryCounts,
        analyzedPostCount: analyses.length,
        completedAt: new Date().toISOString(),
      } as Prisma.InputJsonValue,
    },
  });
}

function collectPatternEntities(text: string, pattern: RegExp, type: string, confidence: number, entities: ExtractedEntity[]) {
  for (const match of text.matchAll(pattern)) {
    const name = match[0]?.trim();
    if (!name) {
      continue;
    }
    entities.push({
      type,
      name,
      confidence,
      evidence: name,
    });
  }
}

function inferCategories(text: string, rules: AiRules) {
  const categories: string[] = [];
  const tests: Array<[string, RegExp]> = [
    ["失物招领", /丢|捡|遗失|失物|钥匙|饭卡|校园卡|找.{0,4}东西/],
    ["表白", /喜欢|表白|crush|心动|暗恋/],
    ["二手", /出|收|转让|闲置|二手|价格|包邮/],
    ["活动宣传", /活动|报名|讲座|比赛|社团|招新/],
    ["树洞", /树洞|吐槽|匿名|压力|难过|焦虑/],
  ];
  for (const [name, regex] of tests) {
    if (regex.test(text)) categories.push(name);
  }
  const allowed = rules.allowedCategories?.length ? rules.allowedCategories : undefined;
  return allowed ? categories.filter((category) => allowed.includes(category)) : categories;
}

function dedupeEntities(entities: ExtractedEntity[]) {
  const seen = new Map<string, ExtractedEntity>();
  for (const entity of entities) {
    const key = `${entity.type}:${entity.name}`;
    const current = seen.get(key);
    if (!current || entity.confidence > current.confidence) {
      seen.set(key, entity);
    }
  }
  return [...seen.values()];
}

function normalizeEntity(value: unknown): ExtractedEntity | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
  const type = typeof candidate.type === "string" ? candidate.type.trim() : "";
  if (!name || !type) {
    return null;
  }
  return {
    type,
    name,
    confidence: clampNumber(candidate.confidence, 0, 1, 0.6),
    evidence: typeof candidate.evidence === "string" ? candidate.evidence : name,
  };
}

function normalizeRules(value: unknown): AiRules {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return defaultAiSettings.rules;
  }
  const candidate = value as Record<string, unknown>;
  return {
    tone: typeof candidate.tone === "string" ? candidate.tone : defaultAiSettings.rules.tone,
    strictPrivacy: typeof candidate.strictPrivacy === "boolean" ? candidate.strictPrivacy : defaultAiSettings.rules.strictPrivacy,
    allowedCategories: normalizeStringArray(candidate.allowedCategories ?? defaultAiSettings.rules.allowedCategories),
    modelingKeywords: normalizeStringArray(candidate.modelingKeywords ?? defaultAiSettings.rules.modelingKeywords),
    modelingNotes: typeof candidate.modelingNotes === "string" ? candidate.modelingNotes : defaultAiSettings.rules.modelingNotes,
    privatePostAiEnabled: typeof candidate.privatePostAiEnabled === "boolean" ? candidate.privatePostAiEnabled : defaultAiSettings.rules.privatePostAiEnabled,
    privatePostAggregateDelaySeconds: normalizeNumber(candidate.privatePostAggregateDelaySeconds, 0, 120, defaultAiSettings.rules.privatePostAggregateDelaySeconds ?? 8),
    postTriggerKeywords: normalizeStringArray(candidate.postTriggerKeywords ?? defaultAiSettings.rules.postTriggerKeywords),
    privatePostPrompt: typeof candidate.privatePostPrompt === "string" ? candidate.privatePostPrompt.trim().slice(0, PRIVATE_POST_PROMPT_MAX_LENGTH) : defaultAiSettings.rules.privatePostPrompt,
  };
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean) : [];
}

function normalizeNumber(value: unknown, min: number, max: number, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.trunc(value))) : fallback;
}

function normalizeBackfillMode(value: unknown): AiBackfillMode {
  return value === "failed" || value === "all" ? value : "missing";
}

function backfillPostWhere(tenantId: string, mode: AiBackfillMode): Prisma.PostWhereInput {
  const base: Prisma.PostWhereInput = {
    tenantId,
    text: {
      not: "",
    },
  };
  if (mode === "all") {
    return base;
  }
  if (mode === "failed") {
    return {
      ...base,
      aiAnalyses: {
        some: {
          status: "failed",
        },
      },
    };
  }
  return {
    ...base,
    OR: [
      {
        aiAnalyses: {
          none: {},
        },
      },
      {
        aiAnalyses: {
          some: {
            status: {
              not: "completed",
            },
          },
        },
      },
    ],
  };
}

function retryDelayMs(attempt: number) {
  return Math.min(5 * 60_000, 5_000 * 2 ** Math.max(0, attempt - 1));
}

async function appendBackfillLog(tenantId: string, batchId: string, level: "info" | "warn" | "error", event: string, message: string, detail: Prisma.InputJsonValue = {}) {
  await prisma.aiBackfillLog.create({
    data: {
      tenantId,
      batchId,
      level,
      event,
      message,
      detail,
    },
  });
}

async function updateBackfillBatchCounts(batchId: string) {
  const [batch, total, queued, running, succeeded, skipped, failed, cancelled] = await Promise.all([
    prisma.aiBackfillBatch.findUniqueOrThrow({ where: { id: batchId }, select: { id: true } }),
    prisma.aiBackfillItem.count({ where: { batchId } }),
    prisma.aiBackfillItem.count({ where: { batchId, status: "queued" } }),
    prisma.aiBackfillItem.count({ where: { batchId, status: "running" } }),
    prisma.aiBackfillItem.count({ where: { batchId, status: "succeeded" } }),
    prisma.aiBackfillItem.count({ where: { batchId, status: "skipped" } }),
    prisma.aiBackfillItem.count({ where: { batchId, status: "failed" } }),
    prisma.aiBackfillItem.count({ where: { batchId, status: "cancelled" } }),
  ]);
  void batch;
  await prisma.aiBackfillBatch.update({
    where: { id: batchId },
    data: {
      totalCount: total,
      queuedCount: queued,
      runningCount: running,
      succeededCount: succeeded,
      skippedCount: skipped,
      failedCount: failed,
    },
  });
  return {
    total,
    queued,
    running,
    succeeded,
    skipped,
    failed,
    cancelled,
    processed: succeeded + skipped + failed + cancelled,
    finished: succeeded + skipped + failed + cancelled,
  };
}

async function serializeBackfillBatch(batchId: string) {
  const batch = await prisma.aiBackfillBatch.findUniqueOrThrow({
    where: { id: batchId },
    include: {
      logs: {
        orderBy: { createdAt: "desc" },
      },
    },
  });
  return serializeBackfillBatchRecord(batch);
}

function serializeBackfillBatchRecord(batch: {
  id: string;
  tenantId: string;
  actorId: string | null;
  status: string;
  mode: string;
  totalCount: number;
  queuedCount: number;
  runningCount: number;
  succeededCount: number;
  skippedCount: number;
  failedCount: number;
  maxAttempts: number;
  lastError: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  logs?: Array<{
    id: string;
    level: string;
    event: string;
    message: string;
    detail: Prisma.JsonValue;
    createdAt: Date;
  }>;
}) {
  return {
    id: batch.id,
    tenantId: batch.tenantId,
    actorId: batch.actorId,
    status: batch.status,
    mode: batch.mode,
    totalCount: batch.totalCount,
    queuedCount: batch.queuedCount,
    runningCount: batch.runningCount,
    succeededCount: batch.succeededCount,
    skippedCount: batch.skippedCount,
    failedCount: batch.failedCount,
    maxAttempts: batch.maxAttempts,
    lastError: batch.lastError,
    startedAt: batch.startedAt?.toISOString() ?? null,
    finishedAt: batch.finishedAt?.toISOString() ?? null,
    createdAt: batch.createdAt.toISOString(),
    updatedAt: batch.updatedAt.toISOString(),
    logs: (batch.logs ?? []).map((log) => ({
      id: log.id,
      level: log.level,
      event: log.event,
      message: log.message,
      detail: log.detail,
      createdAt: log.createdAt.toISOString(),
    })),
  };
}

function normalizeEvidence(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
}

function normalizeMode(value: unknown): "local" | "llm" {
  return value === "llm" ? "llm" : "local";
}

export function normalizeBaseUrl(value: string) {
  return (value.trim() || defaultAiSettings.baseUrl).replace(/\/+$/, "");
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : fallback;
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, numeric));
}

function countBy(values: string[]) {
  return values.reduce<Record<string, number>>((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
}

function topStrings(values: string[]) {
  return Object.entries(countBy(values))
    .sort((left, right) => right[1] - left[1])
    .map(([text, count]) => ({ text, count }));
}

function buildSnapshotSummary(totalEntities: number, analyzedPostCount: number, categoryCounts: Record<string, number>, entityTypeCounts: Record<string, number>) {
  const topCategory = Object.entries(categoryCounts).sort((left, right) => right[1] - left[1])[0]?.[0];
  const topEntityType = Object.entries(entityTypeCounts).sort((left, right) => right[1] - left[1])[0]?.[0];
  return [
    `当前学校模型已沉淀 ${totalEntities} 个校园实体。`,
    `已完成 ${analyzedPostCount} 条文本建模样本。`,
    topCategory ? `近期最常见校园话题：${topCategory}。` : "",
    topEntityType ? `当前最丰富实体类型：${entityTypeLabels[topEntityType] ?? topEntityType}。` : "",
  ].filter(Boolean).join("");
}
