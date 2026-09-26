import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { hasTenantRole, requireReadyTenant } from "../lib/auth";
import { readTenantPluginConfig } from "../lib/tenant-plugin-config";
import { serializeAssignedPostTags } from "../lib/post-tags";
import type { SerializedAssignedPostTag } from "../lib/post-tags";
import { prisma } from "../lib/prisma";
import type { BatchFeedInput, PublishedFeedItem, SingleFeedInput } from "../lib/published-feed";
import { buildPublishedFeed } from "../lib/published-feed";

const tz = "Asia/Shanghai";

function localDateParts(date: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day") };
}

function localStartOfDay(date: Date, year: number, month: number, day: number): Date {
  // 先在墙上时钟上构造本地日期，再回读其 UTC 毫秒，避开时区往返歧义。
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const now = new Date();
  const base = new Date(now);
  base.setUTCFullYear(get("year"), 0, 1);
  base.setUTCHours(0, 0, 0, 0);
  return new Date(
    new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" })
      .format(base.setUTCFullYear(year, month - 1, day)),
  );
}

function isoLocalDateParts(date: Date): string {
  const { year, month, day } = localDateParts(date);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const querySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式必须是 YYYY-MM-DD")
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).default(120),
});

type MetricInclude = {
  include: {
    publishAttempt: {
      select: {
        publishTarget: {
          select: {
            displayName: true,
            botAccount: { select: { displayName: true; qqUin: true } };
          };
        };
      };
    };
  };
};

/**
 * GET /api/posts/today-in-history?date=YYYY-MM-DD&limit=N
 *
 * 返回「历史上同一月同一日」的已发布稿件，跨年收集后按年份倒序、年内按发布时间倒序。
 * 只读已发布稿件，不做任何写入；插件未启用时返回 404，前端据此隐藏入口。
 */
export function registerTodayInHistoryRoutes(app: FastifyInstance) {
  app.get("/api/posts/today-in-history", async (request, reply) => {
    const context = await requireReadyTenant(request, reply, "submitter");
    if (!(await (await readTenantPluginConfig(prisma, context.selectedTenant.id)).todayInHistory.enabled)) {
      return reply.code(404).send({ message: "该插件未启用" });
    }
    const query = querySchema.parse(request.query);
    const tenantId = context.selectedTenant.id;
    const viewerIsReviewer = hasTenantRole(context.selectedMembership.role, "reviewer");

    const today = new Date();
    const nowParts = localDateParts(today);
    const target = query.date
      ? (() => {
          const [y, m, d] = query.date!.split("-").map(Number);
          return { year: y ?? nowParts.year, month: m ?? nowParts.month, day: d ?? nowParts.day };
        })()
      : nowParts;

    // 年份从当前年往前推，最多回看 40 年；仅收集不晚于当前年份的年份。
    const years: number[] = [];
    for (let year = nowParts.year; year >= nowParts.year - 39 && years.length < 40; year--) {
      years.push(year);
    }

    const metricInclude = {
      include: {
        publishAttempt: {
          select: {
            publishTarget: {
              select: {
                displayName: true,
                botAccount: { select: { displayName: true, qqUin: true } },
              },
            },
          },
        },
      },
    } as const;

    const authorSelect = { select: { displayName: true, qqUin: true } } as const;
    const tagInclude = {
      include: { tag: true },
      orderBy: { createdAt: "asc" },
    } as const;

    const windowStart = new Date(Date.UTC(years[years.length - 1] ?? nowParts.year, target.month - 1, target.day));
    const windowEnd = new Date(Date.UTC(nowParts.year + 1, target.month - 1, target.day));
    const singles = await prisma.post.findMany({
      where: {
        tenantId,
        status: "published",
        batchItem: { is: null },
        updatedAt: { gte: windowStart, lt: windowEnd },
      },
      include: { author: authorSelect, tagAssignments: tagInclude, qzonePostMetrics: metricInclude },
      orderBy: { updatedAt: "desc" },
    });

    const batches = await prisma.publishBatch.findMany({
      where: {
        tenantId,
        status: "published",
        flushedAt: {
          gte: new Date(Date.UTC(target.year, target.month - 1, target.day)),
          lt: new Date(Date.UTC(target.year + 1, target.month - 1, target.day)),
        },
      },
      include: {
        items: {
          orderBy: { position: "asc" },
          include: { post: { include: { author: authorSelect, tagAssignments: tagInclude } } },
        },
        attempts: { include: { qzonePostMetrics: metricInclude } },
      },
      orderBy: { flushedAt: "desc" },
    });

    const matchesLocalDate = (date: Date | null, want: number, month: number, day: number) => {
      if (!date) return false;
      const parts = localDateParts(date);
      return parts.year === want && parts.month === month && parts.day === day;
    };

    const singlesPerYear = new Map<number, SingleFeedInput[]>();
    for (const year of years) {
      const list: SingleFeedInput[] = [];
      for (const post of singles) {
        if (!matchesLocalDate(post.updatedAt, year, target.month, target.day)) continue;
        list.push({
          post: {
            id: post.id,
            displayId: post.displayId,
            text: post.text,
            attachments: post.attachments,
            anonymous: post.anonymous,
            bgColor: post.bgColor,
            textColor: post.textColor,
            font: post.font,
            createdAt: post.createdAt,
            author: post.author
              ? { displayName: post.author.displayName ?? "", qqUin: post.author.qqUin }
              : null,
            tags: serializeAssignedPostTags(post.tagAssignments),
          },
          publishedAt: post.updatedAt,
          metrics: post.qzonePostMetrics,
        });
      }
      if (list.length > 0) singlesPerYear.set(year, list);
    }

    // 批次按每个稿件的发布时间归入对应年份，保证跨年批次不整批错位。
    const batchesPerYear = new Map<number, BatchFeedInput[]>();
    for (const year of years) {
      const postsForYear: BatchFeedInput[] = [];
      for (const batch of batches) {
        if (!batch.flushedAt || !matchesLocalDate(batch.flushedAt, year, target.month, target.day)) continue;
        const yearPosts = batch.items.map((item: { post: typeof batch.items[number]["post"] }) => item.post);
        if (yearPosts.length === 0) continue;
        postsForYear.push({
          batchId: batch.id,
          publishedAt: batch.flushedAt,
          posts: yearPosts.map((post: typeof yearPosts[number]) => ({
            id: post.id,
            displayId: post.displayId,
            text: post.text,
            attachments: post.attachments,
            anonymous: post.anonymous,
            bgColor: post.bgColor,
            textColor: post.textColor,
            font: post.font,
            createdAt: post.createdAt,
            author: post.author
              ? { displayName: post.author.displayName ?? "", qqUin: post.author.qqUin }
              : null,
            tags: serializeAssignedPostTags(post.tagAssignments),
          })),
          metrics: batch.attempts.flatMap((attempt: { qzonePostMetrics: typeof batch.attempts[number]["qzonePostMetrics"] }) => attempt.qzonePostMetrics),
        });
      }
      if (postsForYear.length > 0) batchesPerYear.set(year, postsForYear);
    }

    const groups: Array<{ year: number; items: PublishedFeedItem[] }> = [];
    let total = 0;
    for (const year of years) {
      // 「那年今日」只回看往年，不把当年同日的新稿算进历史。
      if (year === nowParts.year) continue;
      const singles = singlesPerYear.get(year) ?? [];
      const batches = batchesPerYear.get(year) ?? [];
      if (singles.length === 0 && batches.length === 0) continue;
      const items = buildPublishedFeed({ singles, batches, viewerIsReviewer });
      groups.push({ year, items });
      total += items.length;
    }

    // 单页返回上限：超出后保留最早的年份，丢弃最旧年份之外的剩余项。
    let remaining = query.limit;
    const capped = groups.filter((group) => {
      if (remaining <= 0) return false;
      const take = Math.min(group.items.length, remaining);
      remaining -= take;
      if (take < group.items.length) group.items = group.items.slice(0, take);
      return true;
    });

    return {
      date: isoLocalDateParts(today),
      targetMonth: target.month,
      targetDay: target.day,
      total,
      groups: capped,
    };
  });
}
