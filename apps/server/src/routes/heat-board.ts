import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { hasTenantRole, requireReadyTenant } from "../lib/auth";
import { prisma } from "../lib/prisma";
import { readTenantPluginConfig } from "../lib/tenant-plugin-config";
import { normalizeTagName, serializeAssignedPostTags, tagColorForName, type SerializedAssignedPostTag } from "../lib/post-tags";
import { toQZonePostStats, type PostQZoneMetric } from "../lib/posts";

const MAX_TAGS_PER_POST = 5;
const HEAT_BOARD_TOP_N = 100;

type PublishedHeatPost = {
  id: string;
  displayId: number;
  text: string;
  attachments: unknown;
  anonymous: boolean;
  authorId: string;
  bgColor: string | null;
  textColor: string | null;
  font: string | null;
  createdAt: Date;
  updatedAt: Date;
  author: { displayName: string | null; qqUin: bigint } | null;
  tagAssignments?: Array<{ source: string; confidence: number | null; tag: any }>;
  qzonePostMetrics?: PostQZoneMetric[];
};

type PublishedHeatBatch = {
  id: string;
  flushedAt: Date | null;
  updatedAt: Date;
  items: Array<{ post: PublishedHeatPost }>;
  attempts: Array<{ qzonePostMetrics: PostQZoneMetric[] }>;
};

type HeatStats = {
  visitorCount: number;
  likeCount: number;
  commentCount: number;
  forwardCount: number;
  checkedAt: string | null;
  targetCount: number;
  targets: NonNullable<ReturnType<typeof toQZonePostStats>>["targets"];
};

type PublishedHeatItem = {
  kind: "single" | "batch";
  key: string;
  postId: string | null;
  displayId: number | null;
  title: string;
  text: string;
  attachments: unknown;
  hasImages: boolean;
  anonymous: boolean;
  bgColor: string | null;
  textColor: string | null;
  font: string | null;
  publishedAt: Date;
  createdAt: string;
  tags: SerializedAssignedPostTag[];
  author: { displayName: string; qqUin: string } | null;
  stats: HeatStats;
  heat: number;
};

export type SerializedHeatPost = Omit<PublishedHeatItem, "heat"> & { heat: number; rank?: number; badge?: "boiling" | "hot" | null };
export type SerializedHeatTopic = {
  id: string;
  name: string;
  color: string;
  postCount: number;
  heat: number;
  badge: "boiling" | "hot" | null;
  posts: SerializedHeatPost[];
};

const topicParamsSchema = z.object({ topicId: z.string().min(1) });

function clampNumber(value: unknown, fallback = 0): number {
  return Number.isFinite(Number(value)) ? Math.max(0, Math.round(Number(value))) : fallback;
}

function activeWallCount(stats: PublishedHeatItem["stats"]): number {
  return Math.max(1, stats.targetCount);
}

function qualityWeight(stats: PublishedHeatItem["stats"]): number {
  const total = clampNumber(stats.visitorCount) + clampNumber(stats.likeCount) + clampNumber(stats.commentCount) + clampNumber(stats.forwardCount);
  return 0.85 + Math.min(0.3, Math.log10(total + 1) * 0.05);
}

function antiCheatingFactor(stats: PublishedHeatItem["stats"]): number {
  const visitorCount = stats.visitorCount ?? 0;
  const likeCount = stats.likeCount ?? 0;
  const commentCount = stats.commentCount ?? 0;
  if (visitorCount > 0 && commentCount > visitorCount) return 0.25;
  if (visitorCount > 0 && likeCount > visitorCount) return 0.65;
  if (commentCount > 0 && likeCount > commentCount * 40) return 0.75;
  return 1;
}

const DEFAULT_HALF_LIFE_HOURS = 24;
const HALF_LIFE_FLOOR = 0.12;

function halfLifeDecayFactor(hoursSincePublished: number): number {
  const hours = Math.max(0, hoursSincePublished);
  return Math.max(HALF_LIFE_FLOOR, Math.pow(0.5, hours / DEFAULT_HALF_LIFE_HOURS));
}

function heatScore(hoursSincePublished: number, stats: PublishedHeatItem["stats"]): number {
  const wallCount = activeWallCount(stats);
  const base =
    0.1 * Math.log(1 + clampNumber(stats.visitorCount) / wallCount) +
    1.0 * Math.log(1 + clampNumber(stats.likeCount) / wallCount) +
    3.0 * Math.log(1 + clampNumber(stats.commentCount) / wallCount) +
    4.0 * Math.log(1 + clampNumber(stats.forwardCount) / wallCount);
  return base * qualityWeight(stats) * antiCheatingFactor(stats) * halfLifeDecayFactor(hoursSincePublished);
}

function toStats(metrics: PostQZoneMetric[]): HeatStats {
  const totals = {
    visitorCount: metrics.reduce((sum, m) => sum + clampNumber(m.visitorCount), 0),
    likeCount: metrics.reduce((sum, m) => sum + clampNumber(m.likeCount), 0),
    commentCount: metrics.reduce((sum, m) => sum + clampNumber(m.commentCount), 0),
    forwardCount: metrics.reduce((sum, m) => sum + clampNumber(m.forwardCount), 0),
  };
  const qzoneStats = toQZonePostStats(metrics);
  const targets = qzoneStats?.targets ?? [];
  const targetCount = new Set(targets.map((target) => target.qzoneTid).filter((value) => value.length > 0)).size;
  return {
    visitorCount: totals.visitorCount,
    likeCount: totals.likeCount,
    commentCount: totals.commentCount,
    forwardCount: totals.forwardCount,
    checkedAt: qzoneStats?.checkedAt ?? null,
    targetCount: Math.max(1, targetCount),
    targets,
  };
}

function badgeFor(rank: number): "boiling" | "hot" | null {
  if (rank <= 3) return "boiling";
  if (rank <= 10) return "hot";
  return null;
}

function toItem(input: { kind: "single" | "batch"; key: string; post: PublishedHeatPost; postId?: string; publishedAt: Date; metrics: PostQZoneMetric[] }): PublishedHeatItem {
  const stats = toStats(input.metrics);
  const publishedAt = input.publishedAt;
  return {
    kind: input.kind,
    key: input.key,
    postId: input.postId ?? input.post.id,
    displayId: input.post.displayId,
    title: input.post.text.length > 28 ? `${input.post.text.slice(0, 28)}...` : input.post.text,
    text: input.post.text,
    attachments: input.post.attachments,
    anonymous: input.post.anonymous,
    bgColor: input.post.bgColor,
    textColor: input.post.textColor,
    font: input.post.font,
    publishedAt,
    createdAt: publishedAt.toISOString(),
    tags: serializeAssignedPostTags(input.post.tagAssignments),
    author: input.post.author ? { displayName: input.post.author.displayName ?? "", qqUin: input.post.author.qqUin.toString() } : null,
    stats,
    hasImages: Array.isArray(input.post.attachments) && input.post.attachments.some((attachment) => attachment && typeof attachment === "object" && (attachment as { contentType?: string }).contentType?.startsWith("image/")),
    heat: heatScore((Date.now() - publishedAt.getTime()) / 3600000, stats),
  };
}

export function registerHeatBoardRoutes(app: FastifyInstance) {
  app.get("/api/heat-board", async (request, reply) => {
    const context = await requireReadyTenant(request, reply, "submitter");
    const pluginConfig = await readTenantPluginConfig(prisma, context.selectedTenant.id);
    if (!pluginConfig.heatBoard.enabled) {
      return reply.code(404).send({ message: "该插件未启用" });
    }
    const viewerIsReviewer = hasTenantRole(context.selectedMembership.role, "reviewer");
    const tenantId = context.selectedTenant.id;

    const posts = await prisma.post.findMany({
      where: { tenantId, status: "published", batchItem: { is: null } },
      include: { author: { select: { displayName: true, qqUin: true } }, tagAssignments: { include: { tag: true }, orderBy: { createdAt: "asc" } }, qzonePostMetrics: true },
      orderBy: { updatedAt: "desc" },
    });
    const batches = await prisma.publishBatch.findMany({
      where: { tenantId, status: "published" },
      include: {
        items: { orderBy: { position: "asc" }, include: { post: { include: { author: { select: { displayName: true, qqUin: true } }, tagAssignments: { include: { tag: true }, orderBy: { createdAt: "asc" } } } } } },
        attempts: { include: { qzonePostMetrics: true } },
      },
      orderBy: { flushedAt: "desc" },
    });

    const rawItems: PublishedHeatItem[] = [
      ...posts.map((post) => toItem({ kind: "single", key: post.id, post, publishedAt: post.updatedAt, metrics: post.qzonePostMetrics ?? [] })),
      ...batches.flatMap((batch) => batch.items.map((item, index) => toItem({
        kind: "batch",
        key: `${batch.id}:${item.post.id}`,
        postId: item.post.id,
        post: item.post,
        publishedAt: batch.flushedAt ?? batch.updatedAt,
        metrics: batch.attempts.flatMap((attempt) => attempt.qzonePostMetrics ?? []),
      }))),
    ].filter((item) => viewerIsReviewer || item.displayId !== null);

    const rankedPosts = rawItems.sort((a, b) => b.heat - a.heat);
    const articleCount = Math.floor((posts.length + batches.reduce((sum, batch) => sum + batch.items.length, 0)) * 0.078);
    const articleList = rankedPosts.slice(0, Math.min(HEAT_BOARD_TOP_N, Math.max(articleCount, 0))).map((post, index) => ({ ...post, rank: index + 1, badge: badgeFor(index + 1) }));

    const topicMap = new Map<string, { tag: any; posts: PublishedHeatItem[] }>();
    for (const post of rankedPosts) {
      for (const tag of post.tags) {
        const bucket = topicMap.get(tag.id) ?? { tag, posts: [] };
        bucket.posts.push(post);
        topicMap.set(tag.id, bucket);
      }
    }
    const topics = [...topicMap.values()].map(({ tag, posts: topicPosts }) => {
      const topN = topicPosts.slice(0, HEAT_BOARD_TOP_N);
      return {
        id: tag.id,
        name: tag.name,
        color: tag.color,
        postCount: topicPosts.length,
        heat: topN.reduce((sum, post) => sum + post.heat, 0) + 0.2 * Math.log(1 + topicPosts.length),
      };
    }).sort((a, b) => b.heat - a.heat).map((topic, index) => ({ ...topic, badge: badgeFor(index + 1) }));

    return {
      updatedAt: new Date().toISOString(),
      articles: articleList,
      topics,
    };
  });

  app.get("/api/heat-board/topic", async (request, reply) => {
    const context = await requireReadyTenant(request, reply, "submitter");
    const pluginConfig = await readTenantPluginConfig(prisma, context.selectedTenant.id);
    if (!pluginConfig.heatBoard.enabled) {
      return reply.code(404).send({ message: "该插件未启用" });
    }
    const params = topicParamsSchema.parse(request.query);
    const topic = await prisma.postTag.findFirst({ where: { id: params.topicId, tenantId: context.selectedTenant.id, status: "active" }, include: { _count: { select: { assignments: true } } } });
    if (!topic) return reply.code(404).send({ message: "话题不存在" });
    const posts = await prisma.post.findMany({
      where: { tenantId: context.selectedTenant.id, status: "published", tagAssignments: { some: { tagId: topic.id } } },
      include: { author: { select: { displayName: true, qqUin: true } }, tagAssignments: { include: { tag: true }, orderBy: { createdAt: "asc" } }, qzonePostMetrics: true, batchItem: { select: { batch: { select: { id: true, flushedAt: true, updatedAt: true } } } } },
      orderBy: { updatedAt: "desc" },
    });
    const articles = posts.map((post) => toItem({
      kind: post.batchItem?.batch ? "batch" : "single",
      key: post.batchItem?.batch?.id ? `${post.batchItem.batch.id}:${post.id}` : post.id,
      post,
      publishedAt: post.batchItem?.batch?.flushedAt ?? post.batchItem?.batch?.updatedAt ?? post.updatedAt,
      metrics: post.qzonePostMetrics ?? [],
    })).sort((a, b) => b.heat - a.heat).map((post, index) => ({ ...post, rank: index + 1, badge: badgeFor(index + 1) }));
    return { updatedAt: new Date().toISOString(), topic: { id: topic.id, name: topic.name, color: topic.color, postCount: topic._count.assignments, heat: articles.slice(0, HEAT_BOARD_TOP_N).reduce((sum, post) => sum + post.heat, 0) + 0.2 * Math.log(1 + topic._count.assignments) }, articles };
  });

  app.get("/api/post-tags/search", async (request, reply) => {
    const context = await requireReadyTenant(request, reply, "submitter");
    const query = z.object({ q: z.string().max(40).optional() }).parse(request.query);
    const name = normalizeTagName(query.q);
    const orderBy = name ? [{ lastUsedAt: "desc" as const }, { name: "asc" as const }] : [{ lastUsedAt: "desc" as const }, { name: "asc" as const }];
    const tags = await prisma.postTag.findMany({
      where: { tenantId: context.selectedTenant.id, status: "active", ...(name ? { name: { contains: name, mode: "insensitive" } } : {}) },
      include: { _count: { select: { assignments: true } } },
      orderBy,
      take: 100,
    });
    return { tags: tags.map((tag) => ({ id: tag.id, name: tag.name, color: tag.color, postCount: tag._count.assignments, lastUsedAt: tag.lastUsedAt?.toISOString() ?? null })) };
  });

  app.post("/api/post-tags", async (request, reply) => {
    const context = await requireReadyTenant(request, reply, "submitter");
    const pluginConfig = await readTenantPluginConfig(prisma, context.selectedTenant.id);
    if (!pluginConfig.heatBoard.enabled) return reply.code(404).send({ message: "话题功能未启用" });
    const body = z.object({ name: z.string().min(1).max(16).trim() }).parse(request.body ?? {});
    const name = normalizeTagName(body.name);
    if (!name) return reply.code(400).send({ message: "话题名称无效" });
    const existing = await prisma.postTag.findFirst({ where: { tenantId: context.selectedTenant.id, name } });
    if (existing) {
      return { tag: { id: existing.id, name: existing.name, color: existing.color } };
    }
    const tag = await prisma.postTag.create({ data: { tenantId: context.selectedTenant.id, name, color: tagColorForName(name), status: "active", source: "user", lastUsedAt: new Date() } });
    return { tag: { id: tag.id, name: tag.name, color: tag.color } };
  });
}
