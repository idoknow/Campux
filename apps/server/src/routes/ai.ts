import type { FastifyInstance } from "fastify";
import { PRIVATE_POST_PROMPT_MAX_LENGTH } from "@campux/domain";
import { z } from "zod";
import { requireTenantRole } from "../lib/auth";
import { prisma } from "../lib/prisma";
import { writeAuditLog } from "../lib/audit";
import { analyzePostText, cancelAiBackfillBatch, createAiBackfillBatch, listAiBackfillBatches, readTenantAiSettings, refreshSchoolModelSnapshot, retryAiBackfillBatch, testTenantAiSettings, updateTenantAiSettings } from "../runtime/campus-modeling";
import type { RuntimeQueue } from "../runtime/queue";

export const aiSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  mode: z.enum(["local", "llm"]).optional(),
  provider: z.string().trim().min(1).max(80).optional(),
  baseUrl: z.string().trim().url().optional(),
  model: z.string().trim().min(1).max(120).optional(),
  apiKey: z.string().optional(),
  clearApiKey: z.boolean().optional(),
  temperature: z.number().min(0).max(1).optional(),
  timeoutSeconds: z.number().int().min(5).max(120).optional(),
  rules: z.object({
    tone: z.string().max(200).optional(),
    strictPrivacy: z.boolean().optional(),
    allowedCategories: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
    modelingKeywords: z.array(z.string().trim().min(1).max(60)).max(80).optional(),
    modelingNotes: z.string().max(300).optional(),
    privatePostAiEnabled: z.boolean().optional(),
    privatePostAggregateDelaySeconds: z.number().int().min(0).max(120).optional(),
    postTriggerKeywords: z.array(z.string().trim().min(1).max(30)).max(20).optional(),
    privatePostPrompt: z.string().trim().max(PRIVATE_POST_PROMPT_MAX_LENGTH).optional(),
  }).optional(),
});

const postParamsSchema = z.object({
  id: z.string().min(1),
});

const backfillCreateSchema = z.object({
  mode: z.enum(["missing", "failed", "all"]).default("missing"),
  maxAttempts: z.number().int().min(1).max(8).default(3),
  limit: z.number().int().min(1).optional(),
});

const backfillParamsSchema = z.object({
  id: z.string().min(1),
});

const entityParamsSchema = z.object({
  id: z.string().min(1),
});

const graphOverviewEdgeLimit = 6_000;

export function registerAiRoutes(app: FastifyInstance, queue: RuntimeQueue) {
  app.get("/api/ai/overview", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "reviewer");
    const tenantId = context.selectedTenant.id;
    const [settings, snapshot, entities, analyses, recentAnalyses, backfills] = await Promise.all([
      readTenantAiSettings(tenantId),
      prisma.schoolModelSnapshot.findFirst({
        where: { tenantId, status: "active" },
        orderBy: { version: "desc" },
      }),
      prisma.schoolEntity.findMany({
        where: { tenantId },
        orderBy: [{ confidence: "desc" }, { lastSeenAt: "desc" }],
      }),
      prisma.postAiAnalysis.findMany({
        where: { tenantId },
        select: {
          id: true,
          postId: true,
          provider: true,
          model: true,
          status: true,
          confidence: true,
          categories: true,
          entities: true,
          reasons: true,
          error: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: "desc" },
      }),
      prisma.postAiAnalysis.findMany({
        where: { tenantId },
        include: {
          post: {
            select: {
              id: true,
              displayId: true,
              text: true,
              status: true,
              createdAt: true,
            },
          },
        },
        orderBy: { updatedAt: "desc" },
        take: 80,
      }),
      listAiBackfillBatches(tenantId),
    ]);

    const serializedEntities = entities.map((entity) => ({
      id: entity.id,
      type: entity.type,
      name: entity.name,
      aliases: entity.aliases,
      confidence: entity.confidence,
      source: entity.source,
      evidence: [],
      firstSeenAt: entity.firstSeenAt.toISOString(),
      lastSeenAt: entity.lastSeenAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
    }));
    const serializedAnalyses = recentAnalyses.map((analysis) => ({
      id: analysis.id,
      postId: analysis.postId,
      displayId: analysis.post.displayId,
      postText: truncateText(analysis.post.text, 180),
      postStatus: analysis.post.status,
      postCreatedAt: analysis.post.createdAt.toISOString(),
      provider: analysis.provider,
      model: analysis.model,
      status: analysis.status,
      confidence: analysis.confidence,
      categories: analysis.categories,
      entities: analysis.entities,
      reasons: analysis.reasons,
      error: analysis.error,
      createdAt: analysis.createdAt.toISOString(),
      updatedAt: analysis.updatedAt.toISOString(),
    }));

    return {
      settings,
      snapshot: snapshot
        ? {
          id: snapshot.id,
          version: snapshot.version,
          status: snapshot.status,
          summary: snapshot.summary,
          metrics: snapshot.metrics,
          createdAt: snapshot.createdAt.toISOString(),
        }
        : null,
      entities: [],
      analyses: serializedAnalyses,
      metrics: buildMetrics(serializedEntities, analyses),
      graph: buildGraph(context.selectedTenant.name, serializedEntities, analyses),
      backfills,
    };
  });

  app.get("/api/ai/entities/:id", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "reviewer");
    const tenantId = context.selectedTenant.id;
    const params = entityParamsSchema.parse(request.params);
    const entity = await prisma.schoolEntity.findFirst({
      where: {
        tenantId,
        id: params.id,
      },
    });

    if (!entity) {
      return reply.code(404).send({ message: "实体不存在" });
    }

    const evidencePostIds = [...new Set(normalizeEvidenceRecords(entity.evidence).map((item) => item.postId).filter((postId): postId is string => Boolean(postId)))];
    const evidencePosts = evidencePostIds.length > 0
      ? await prisma.post.findMany({
        where: {
          tenantId,
          id: { in: evidencePostIds },
        },
        select: {
          id: true,
          displayId: true,
          legacyTenantSlug: true,
          legacyDisplayId: true,
          legacyUuid: true,
          text: true,
          attachments: true,
          anonymous: true,
          status: true,
          recallIgnored: true,
          recallIgnoredAt: true,
          createdAt: true,
          updatedAt: true,
          author: {
            select: {
              id: true,
              qqUin: true,
              displayName: true,
              email: true,
            },
          },
        },
      })
      : [];
    const evidencePostById = new Map(evidencePosts.map((post) => [post.id, serializeEvidencePost(post)]));

    return {
      entity: {
        id: entity.id,
        type: entity.type,
        name: entity.name,
        aliases: entity.aliases,
        confidence: entity.confidence,
        source: entity.source,
        evidence: enrichEvidenceWithPosts(entity.evidence, evidencePostById),
        firstSeenAt: entity.firstSeenAt.toISOString(),
        lastSeenAt: entity.lastSeenAt.toISOString(),
        updatedAt: entity.updatedAt.toISOString(),
      },
    };
  });

  app.patch("/api/admin/ai/settings", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    const body = aiSettingsSchema.parse(request.body ?? {});
    const settings = await updateTenantAiSettings(context.selectedTenant.id, body);

    await writeAuditLog({
      tenantId: context.selectedTenant.id,
      actorId: context.user.id,
      action: "tenant.ai.settings.update",
      targetType: "tenant",
      targetId: context.selectedTenant.id,
      detail: {
        fields: Object.keys(body).filter((key) => key !== "apiKey"),
        apiKeyUpdated: Boolean(body.apiKey || body.clearApiKey),
      },
    });

    return { settings };
  });

  app.post("/api/admin/ai/settings/test", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    const body = aiSettingsSchema.parse(request.body ?? {});
    const result = await testTenantAiSettings(context.selectedTenant.id, body);

    await writeAuditLog({
      tenantId: context.selectedTenant.id,
      actorId: context.user.id,
      action: "tenant.ai.settings.test",
      targetType: "tenant",
      targetId: context.selectedTenant.id,
      detail: {
        ok: result.ok,
        mode: result.mode,
        provider: result.provider,
        model: result.model,
        baseUrl: result.baseUrl,
        latencyMs: result.latencyMs,
      },
    });

    return { result };
  });

  app.post("/api/admin/ai/graph/clear", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    const tenantId = context.selectedTenant.id;

    const result = await prisma.$transaction(async (tx) => {
      const activeBatches = await tx.aiBackfillBatch.findMany({
        where: {
          tenantId,
          status: {
            in: ["queued", "running"],
          },
        },
        select: {
          id: true,
        },
      });
      const activeBatchIds = activeBatches.map((batch) => batch.id);
      const cancelledItems = activeBatchIds.length > 0
        ? await tx.aiBackfillItem.updateMany({
          where: {
            tenantId,
            batchId: { in: activeBatchIds },
            status: { in: ["queued", "running"] },
          },
          data: {
            status: "cancelled",
            finishedAt: new Date(),
          },
        })
        : { count: 0 };
      const cancelledBatches = activeBatchIds.length > 0
        ? await tx.aiBackfillBatch.updateMany({
          where: {
            tenantId,
            id: { in: activeBatchIds },
          },
          data: {
            status: "cancelled",
            finishedAt: new Date(),
            lastError: "图谱已被管理员清空，存量分析任务已取消。",
          },
        })
        : { count: 0 };

      if (activeBatchIds.length > 0) {
        await tx.aiBackfillLog.createMany({
          data: activeBatchIds.map((batchId) => ({
            tenantId,
            batchId,
            level: "warn",
            event: "graph.cleared",
            message: "图谱已被管理员清空，当前批量分析任务已取消。",
          })),
        });
      }

      const analyses = await tx.postAiAnalysis.deleteMany({ where: { tenantId } });
      const snapshots = await tx.schoolModelSnapshot.deleteMany({ where: { tenantId } });
      const entities = await tx.schoolEntity.deleteMany({ where: { tenantId } });

      return {
        cancelledBatches: cancelledBatches.count,
        cancelledItems: cancelledItems.count,
        analyses: analyses.count,
        snapshots: snapshots.count,
        entities: entities.count,
      };
    });

    await writeAuditLog({
      tenantId,
      actorId: context.user.id,
      action: "tenant.ai.graph.clear",
      targetType: "tenant",
      targetId: tenantId,
      detail: result,
    });

    return { result };
  });

  app.post("/api/ai/posts/:id/analyze", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "reviewer");
    const params = postParamsSchema.parse(request.params);
    const post = await prisma.post.findFirst({
      where: {
        tenantId: context.selectedTenant.id,
        id: params.id,
      },
      select: { id: true, displayId: true },
    });
    if (!post) {
      return reply.code(404).send({ message: "稿件不存在" });
    }
    const analysis = await analyzePostText(context.selectedTenant.id, post.id);
    await writeAuditLog({
      tenantId: context.selectedTenant.id,
      actorId: context.user.id,
      action: "tenant.ai.post.analyze",
      targetType: "post",
      targetId: post.id,
      detail: { displayId: post.displayId },
    });
    return {
      analysis: {
        id: analysis.id,
        status: analysis.status,
        updatedAt: analysis.updatedAt.toISOString(),
      },
    };
  });

  app.post("/api/ai/snapshot/refresh", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "reviewer");
    const snapshot = await refreshSchoolModelSnapshot(context.selectedTenant.id);
    return {
      snapshot: {
        id: snapshot.id,
        version: snapshot.version,
        summary: snapshot.summary,
        createdAt: snapshot.createdAt.toISOString(),
      },
    };
  });

  app.post("/api/admin/ai/backfills", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    const body = backfillCreateSchema.parse(request.body ?? {});
    const result = await createAiBackfillBatch(queue, context.selectedTenant.id, context.user.id, body);
    await writeAuditLog({
      tenantId: context.selectedTenant.id,
      actorId: context.user.id,
      action: "tenant.ai.backfill.create",
      targetType: "ai_backfill_batch",
      targetId: result.batch.id,
      detail: {
        mode: body.mode,
        totalCount: result.batch.totalCount,
        created: result.created,
      },
    });
    return result;
  });

  app.post("/api/admin/ai/backfills/:id/retry", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    const params = backfillParamsSchema.parse(request.params);
    const batch = await retryAiBackfillBatch(queue, context.selectedTenant.id, params.id);
    await writeAuditLog({
      tenantId: context.selectedTenant.id,
      actorId: context.user.id,
      action: "tenant.ai.backfill.retry",
      targetType: "ai_backfill_batch",
      targetId: batch.id,
      detail: {
        failedCount: batch.failedCount,
      },
    });
    return { batch };
  });

  app.post("/api/admin/ai/backfills/:id/cancel", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    const params = backfillParamsSchema.parse(request.params);
    const batch = await cancelAiBackfillBatch(context.selectedTenant.id, params.id);
    await writeAuditLog({
      tenantId: context.selectedTenant.id,
      actorId: context.user.id,
      action: "tenant.ai.backfill.cancel",
      targetType: "ai_backfill_batch",
      targetId: batch.id,
      detail: {},
    });
    return { batch };
  });

}

function buildMetrics(
  entities: Array<{ type: string }>,
  analyses: Array<{ status: string; categories: unknown }>,
) {
  const completed = analyses.filter((analysis) => analysis.status === "completed");
  const categoryCounts = countBy(completed.flatMap((analysis) => normalizeStringArray(analysis.categories)));
  return {
    totalEntities: entities.length,
    entityTypeCounts: countBy(entities.map((entity) => entity.type)),
    analyzedPosts: completed.length,
    runningPosts: analyses.filter((analysis) => analysis.status === "running" || analysis.status === "pending").length,
    failedPosts: analyses.filter((analysis) => analysis.status === "failed").length,
    categoryCounts,
  };
}

function buildGraph(
  tenantName: string,
  entities: Array<{ id: string; type: string; name: string; confidence: number }>,
  analyses: Array<{ status: string; categories: unknown; entities: unknown }>,
) {
  type GraphNode = {
    id: string;
    label: string;
    kind: string;
    weight: number;
    score: number;
    radius: number;
    degree: number;
    community: string;
    entityId?: string;
    entityType?: string;
    confidence?: number;
    occurrenceCount?: number;
    description?: string | null;
  };
  type GraphEdge = {
    source: string;
    target: string;
    label: string;
    type: string;
    weight: number;
    confidence: number;
    signalCount: number;
    directed?: boolean;
  };
  type EntitySignal = {
    id: string;
    type: string;
    name: string;
    nodeId: string;
    confidence: number;
  };

  const completed = analyses.filter((analysis) => analysis.status === "completed");
  const entityByKey = new Map(entities.map((entity) => [entityKey(entity.type, entity.name), entity]));
  const entityStats = new Map<string, {
    occurrenceCount: number;
    categoryCounts: Record<string, number>;
  }>();
  const cooccurrence = new Map<string, {
    source: string;
    target: string;
    signalCount: number;
    confidenceTotal: number;
    categories: Record<string, number>;
  }>();

  for (const analysis of completed) {
    const signals = normalizeGraphEntities(analysis.entities)
      .map((item): EntitySignal | null => {
        const entity = entityByKey.get(entityKey(item.type, item.name));
        if (!entity) return null;
        return {
          id: entity.id,
          type: entity.type,
          name: entity.name,
          nodeId: `entity:${entity.id}`,
          confidence: Math.max(entity.confidence, item.confidence ?? 0),
        };
      })
      .filter((item): item is EntitySignal => Boolean(item))
      .filter(uniqueBy((item) => item.nodeId));
    if (signals.length === 0) continue;

    const categories = normalizeStringArray(analysis.categories);
    for (const signal of signals) {
      const stats = entityStats.get(signal.nodeId) ?? {
        occurrenceCount: 0,
        categoryCounts: {},
      };
      stats.occurrenceCount += 1;
      for (const category of categories) {
        stats.categoryCounts[category] = (stats.categoryCounts[category] ?? 0) + 1;
      }
      entityStats.set(signal.nodeId, stats);
    }

    for (let leftIndex = 0; leftIndex < signals.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < signals.length; rightIndex += 1) {
        const left = signals[leftIndex]!;
        const right = signals[rightIndex]!;
        const [source, target] = left.nodeId < right.nodeId ? [left, right] : [right, left];
        const key = `${source.nodeId}::${target.nodeId}`;
        const current = cooccurrence.get(key) ?? {
          source: source.nodeId,
          target: target.nodeId,
          signalCount: 0,
          confidenceTotal: 0,
          categories: {},
        };
        current.signalCount += 1;
        current.confidenceTotal += (source.confidence + target.confidence) / 2;
        for (const category of categories) {
          current.categories[category] = (current.categories[category] ?? 0) + 1;
        }
        cooccurrence.set(key, current);
      }
    }
  }

  const selectedEntities = entities
    .map((entity) => {
      const nodeId = `entity:${entity.id}`;
      const stats = entityStats.get(nodeId);
      return {
        entity,
        nodeId,
        occurrenceCount: stats?.occurrenceCount ?? 0,
        score: (stats?.occurrenceCount ?? 0) * 2 + entity.confidence * 10,
      };
    })
    .sort((left, right) => right.score - left.score || right.entity.confidence - left.entity.confidence);
  const selectedEntityIds = new Set(selectedEntities.map((item) => item.nodeId));
  const selectedEdges = [...cooccurrence.values()]
    .filter((edge) => selectedEntityIds.has(edge.source) && selectedEntityIds.has(edge.target))
    .map((edge) => ({
      ...edge,
      confidence: edge.signalCount > 0 ? edge.confidenceTotal / edge.signalCount : 0.5,
      weight: edge.signalCount * (edge.signalCount > 0 ? edge.confidenceTotal / edge.signalCount : 0.5),
    }))
    .sort((left, right) => right.weight - left.weight);
  const communities = detectGraphCommunities(selectedEntities.map((item) => item.nodeId), selectedEdges);

  const nodes: GraphNode[] = [
    {
      id: "tenant",
      label: tenantName,
      kind: "tenant",
      weight: Math.max(10, selectedEntities.length),
      score: selectedEntities.length,
      radius: 34,
      degree: 0,
      community: "tenant",
    },
  ];
  const edges: GraphEdge[] = [];
  const degree = new Map<string, number>();
  const addEdge = (edge: GraphEdge) => {
    edges.push(edge);
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  };

  const typeCounts = countBy(selectedEntities.map(({ entity }) => entity.type));
  for (const [type, count] of Object.entries(typeCounts).sort((left, right) => right[1] - left[1])) {
    const typeId = `type:${type}`;
    nodes.push({
      id: typeId,
      label: entityTypeLabels[type] ?? type,
      kind: "type",
      weight: count,
      score: count,
      radius: Math.max(13, Math.min(22, 10 + Math.sqrt(count) * 3)),
      degree: 0,
      community: `type:${type}`,
    });
    addEdge({ source: "tenant", target: typeId, label: "类型", type: "TYPE_GROUP", weight: count, confidence: 1, signalCount: count });
  }

  const categoryCounts = countBy(completed.flatMap((analysis) => normalizeStringArray(analysis.categories)));
  for (const [category, count] of Object.entries(categoryCounts).sort((left, right) => right[1] - left[1])) {
    const categoryId = `category:${category}`;
    nodes.push({
      id: categoryId,
      label: category,
      kind: "category",
      weight: count,
      score: count,
      radius: Math.max(12, Math.min(22, 9 + Math.sqrt(count) * 2.2)),
      degree: 0,
      community: "category",
    });
    addEdge({ source: "tenant", target: categoryId, label: "分类", type: "CATEGORY_GROUP", weight: count, confidence: 1, signalCount: count });
  }

  for (const item of selectedEntities) {
    const { entity, nodeId, occurrenceCount, score } = item;
    const stats = entityStats.get(nodeId);
    const community = communities.get(nodeId) ?? `type:${entity.type}`;
    nodes.push({
      id: nodeId,
      label: entity.name,
      kind: "entity",
      weight: Math.max(1, occurrenceCount || Math.round(entity.confidence * 10)),
      score,
      radius: Math.max(9, Math.min(24, 8 + Math.sqrt(Math.max(1, occurrenceCount)) * 4)),
      degree: 0,
      community,
      entityId: entity.id,
      entityType: entity.type,
      confidence: entity.confidence,
      occurrenceCount,
    });
    addEdge({
      source: `type:${entity.type}`,
      target: nodeId,
      label: "属于",
      type: "TYPE_MEMBER",
      weight: Math.max(1, occurrenceCount),
      confidence: entity.confidence,
      signalCount: Math.max(1, occurrenceCount),
    });

    for (const [category, count] of Object.entries(stats?.categoryCounts ?? {}).sort((left, right) => right[1] - left[1])) {
      const categoryId = `category:${category}`;
      if (count > 0) {
        addEdge({ source: nodeId, target: categoryId, label: category, type: "CATEGORY_SIGNAL", weight: count, confidence: Math.min(0.99, entity.confidence), signalCount: count });
      }
    }
  }

  for (const edge of selectedEdges) {
    const relationLabel = buildRelationLabel(edge.categories, edge.signalCount);
    addEdge({
      source: edge.source,
      target: edge.target,
      label: relationLabel,
      type: "CO_OCCURS",
      weight: Math.max(1, edge.weight),
      confidence: Math.min(0.99, edge.confidence),
      signalCount: edge.signalCount,
    });
  }

  const displayEdges = prioritizeGraphEdges(edges).slice(0, graphOverviewEdgeLimit);
  return {
    nodes: nodes.map((node) => ({
      ...node,
      degree: degree.get(node.id) ?? 0,
    })),
    edges: displayEdges,
    stats: {
      entityNodes: selectedEntities.length,
      relationEdges: edges.length,
      cooccurrenceEdges: selectedEdges.length,
      communities: new Set([...communities.values()]).size,
    },
  };
}

function prioritizeGraphEdges(edges: Array<{ type: string; weight: number; signalCount: number; source: string; target: string }>) {
  return edges
    .map((edge, index) => ({ edge, index, score: graphEdgePriority(edge) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((item) => item.edge);
}

function graphEdgePriority(edge: { type: string; weight: number; signalCount: number; source: string; target: string }) {
  const typeBoost = edge.type === "CO_OCCURS" ? 1_000_000 : edge.type === "CATEGORY_SIGNAL" ? 120_000 : edge.type === "TYPE_MEMBER" ? 60_000 : 20_000;
  const hubBoost = edge.source === "tenant" || edge.target === "tenant" ? 30_000 : 0;
  return typeBoost + hubBoost + edge.weight * 10 + edge.signalCount;
}

const entityTypeLabels: Record<string, string> = {
  location: "地点",
  class: "班级",
  person_alias: "人物称呼",
  organization: "组织",
  topic: "话题",
  service: "服务入口",
  contact: "联系方式",
};

function countBy(values: string[]) {
  return values.reduce<Record<string, number>>((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean) : [];
}

function truncateText(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function buildRelationLabel(categories: Record<string, number>, signalCount: number) {
  const topCategories = Object.entries(categories)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 2)
    .map(([category]) => category);
  const topicLabel = topCategories.length > 0 ? topCategories.join("/") : "共现";
  return signalCount > 1 ? `${topicLabel} · ${signalCount}次` : topicLabel;
}

function normalizeEvidenceRecords(value: unknown): Array<{ text: string; postId: string | null; analysisId: string | null; seenAt: string | null }> {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (typeof item === "string") {
      return { text: item, postId: null, analysisId: null, seenAt: null };
    }
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return null;
    }
    const record = item as Record<string, unknown>;
    return {
      text: typeof record.text === "string" ? record.text : "",
      postId: typeof record.postId === "string" ? record.postId : null,
      analysisId: typeof record.analysisId === "string" ? record.analysisId : null,
      seenAt: typeof record.seenAt === "string" ? record.seenAt : null,
    };
  }).filter((item): item is { text: string; postId: string | null; analysisId: string | null; seenAt: string | null } => Boolean(item));
}

function enrichEvidenceWithPosts(value: unknown, posts: Map<string, ReturnType<typeof serializeEvidencePost>>) {
  return normalizeEvidenceRecords(value).map((item) => ({
    ...item,
    post: item.postId ? posts.get(item.postId) ?? null : null,
  }));
}

function serializeEvidencePost(post: {
  id: string;
  displayId: number;
  legacyTenantSlug: string | null;
  legacyDisplayId: number | null;
  legacyUuid: string | null;
  text: string;
  attachments: unknown;
  anonymous: boolean;
  status: string;
  recallIgnored: boolean;
  recallIgnoredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  author: {
    id: string;
    qqUin: bigint;
    displayName: string | null;
    email: string | null;
  };
}) {
  return {
    id: post.id,
    displayId: post.displayId,
    legacyTenantSlug: post.legacyTenantSlug,
    legacyDisplayId: post.legacyDisplayId,
    legacyUuid: post.legacyUuid,
    text: post.text,
    attachments: post.attachments,
    anonymous: post.anonymous,
    status: post.status,
    recallIgnored: post.recallIgnored,
    recallIgnoredAt: post.recallIgnoredAt?.toISOString() ?? null,
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
    author: {
      id: post.author.id,
      qqUin: post.author.qqUin.toString(),
      displayName: post.author.displayName,
      email: post.author.email,
    },
  };
}

function entityKey(type: string, name: string) {
  return `${type.trim().toLowerCase()}:${name.trim().toLowerCase()}`;
}

function normalizeGraphEntities(value: unknown): Array<{ type: string; name: string; confidence?: number }> {
  if (!Array.isArray(value)) return [];
  return value.reduce<Array<{ type: string; name: string; confidence?: number }>>((items, item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return items;
      const record = item as Record<string, unknown>;
      const type = typeof record.type === "string" ? record.type.trim() : "";
      const name = typeof record.name === "string" ? record.name.trim() : "";
      if (!type || !name) return items;
      const confidence = typeof record.confidence === "number" ? record.confidence : undefined;
      items.push({ type, name, ...(confidence === undefined ? {} : { confidence }) });
      return items;
    }, []);
}

function uniqueBy<T>(keyOf: (item: T) => string) {
  const seen = new Set<string>();
  return (item: T) => {
    const key = keyOf(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };
}

function detectGraphCommunities(nodeIds: string[], edges: Array<{ source: string; target: string; weight: number }>) {
  const adjacency = new Map<string, Array<{ id: string; weight: number }>>();
  for (const id of nodeIds) {
    adjacency.set(id, []);
  }
  for (const edge of edges) {
    adjacency.get(edge.source)?.push({ id: edge.target, weight: edge.weight });
    adjacency.get(edge.target)?.push({ id: edge.source, weight: edge.weight });
  }
  const labels = new Map(nodeIds.map((id) => [id, id]));
  for (let iteration = 0; iteration < 12; iteration += 1) {
    let changed = false;
    for (const nodeId of nodeIds) {
      const votes = new Map<string, number>();
      for (const neighbor of adjacency.get(nodeId) ?? []) {
        const label = labels.get(neighbor.id) ?? neighbor.id;
        votes.set(label, (votes.get(label) ?? 0) + neighbor.weight);
      }
      const best = [...votes.entries()].sort((left, right) => right[1] - left[1])[0]?.[0];
      if (best && best !== labels.get(nodeId)) {
        labels.set(nodeId, best);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return labels;
}
