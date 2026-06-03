import type { FastifyInstance } from "fastify";
import { requireReadyTenant } from "../lib/auth";
import { prisma } from "../lib/prisma";
import { buildQZoneVisitorDailySeries, buildQZoneVisitorTargetSeries } from "../lib/qzone-visitor-stats";

const dayMs = 24 * 60 * 60 * 1000;
const postStatuses = ["pending_approval", "approved", "rejected", "cancelled", "publishing", "partially_failed", "failed", "published", "pending_recall", "recalled"];
const publishAttemptStatuses = ["queued", "running", "succeeded", "failed", "skipped"];

export function registerStatsRoutes(app: FastifyInstance) {
  app.get("/api/stats/tenant", async (request, reply) => {
    const context = await requireReadyTenant(request, reply, "reviewer");
    const tenantId = context.selectedTenant.id;
    const rangeDays = parseRangeDays(request.query);
    const now = new Date();
    const since7 = new Date(now.getTime() - 7 * dayMs);
    const since30 = new Date(now.getTime() - 30 * dayMs);
    const sinceRange = startOfDay(new Date(now.getTime() - (rangeDays - 1) * dayMs));

    const [
      posts,
      recentPosts30d,
      rangePosts,
      postStatusGroups,
      memberRoleGroups,
      activeBanCount,
      totalBanCount,
      bots,
      publishTargets,
      publishAttemptGroups,
      publishAttemptsByTarget,
      recentFailedAttempts,
      reviewLogs,
      auditGroups,
      memberships,
      qzoneVisitorSnapshots,
    ] = await Promise.all([
      prisma.post.findMany({
        where: { tenantId },
        select: {
          id: true,
          authorId: true,
          status: true,
          anonymous: true,
          attachments: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.post.findMany({
        where: {
          tenantId,
          createdAt: { gte: since30 },
        },
        select: {
          id: true,
          authorId: true,
          status: true,
          anonymous: true,
          attachments: true,
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
      }),
      prisma.post.findMany({
        where: {
          tenantId,
          createdAt: { gte: sinceRange },
        },
        select: {
          id: true,
          authorId: true,
          status: true,
          anonymous: true,
          attachments: true,
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
      }),
      prisma.post.groupBy({
        by: ["status"],
        where: { tenantId },
        _count: { _all: true },
      }),
      prisma.tenantMembership.groupBy({
        by: ["role"],
        where: { tenantId },
        _count: { _all: true },
      }),
      prisma.banRecord.count({
        where: {
          tenantId,
          endsAt: { gt: now },
        },
      }),
      prisma.banRecord.count({ where: { tenantId } }),
      prisma.botAccount.findMany({
        where: { tenantId },
        include: {
          sessions: {
            where: { type: "qzone" },
            orderBy: { refreshedAt: "desc" },
            take: 1,
          },
          publishTargets: true,
        },
        orderBy: { createdAt: "asc" },
      }),
      prisma.publishTarget.findMany({
        where: { tenantId },
        include: { botAccount: true },
        orderBy: { displayName: "asc" },
      }),
      prisma.publishAttempt.groupBy({
        by: ["status"],
        where: { tenantId },
        _count: { _all: true },
      }),
      prisma.publishAttempt.groupBy({
        by: ["publishTargetId", "status"],
        where: { tenantId },
        _count: { _all: true },
      }),
      prisma.publishAttempt.findMany({
        where: {
          tenantId,
          status: "failed",
        },
        include: {
          post: {
            select: {
              displayId: true,
              text: true,
              status: true,
            },
          },
          publishTarget: {
            select: {
              displayName: true,
              botAccount: {
                select: {
                  qqUin: true,
                  displayName: true,
                },
              },
            },
          },
        },
        orderBy: { updatedAt: "desc" },
        take: 8,
      }),
      prisma.postLog.findMany({
        where: {
          tenantId,
          newStatus: { in: ["approved", "rejected"] },
          createdAt: { gte: sinceRange },
        },
        select: {
          postId: true,
          newStatus: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.auditLog.groupBy({
        by: ["action"],
        where: {
          tenantId,
          createdAt: { gte: sinceRange },
        },
        _count: { _all: true },
      }),
      prisma.tenantMembership.findMany({
        where: { tenantId },
        select: {
          id: true,
          role: true,
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
      }),
      prisma.qZoneVisitorSnapshot.findMany({
        where: {
          tenantId,
          date: { gte: sinceRange },
        },
        select: {
          botAccountId: true,
          date: true,
          todayCount: true,
          totalCount: true,
        },
        orderBy: { date: "asc" },
      }),
    ]);

    const postById = new Map(posts.map((post) => [post.id, post]));
    const statusCounts = Object.fromEntries(postStatuses.map((status) => [status, 0]));
    for (const group of postStatusGroups) {
      statusCounts[group.status] = group._count._all;
    }

    const totalPosts = posts.length;
    const recent7Posts = recentPosts30d.filter((post) => post.createdAt >= since7);
    const reviewedLogs = reviewLogs.filter((log) => postById.has(log.postId));
    const reviewDurations = reviewedLogs
      .map((log) => {
        const post = postById.get(log.postId);
        return post ? log.createdAt.getTime() - post.createdAt.getTime() : null;
      })
      .filter((value): value is number => typeof value === "number" && value >= 0);
    const avgReviewMinutes = reviewDurations.length > 0 ? Math.round(reviewDurations.reduce((sum, value) => sum + value, 0) / reviewDurations.length / 60_000) : null;

    const imagesTotal = posts.reduce((sum, post) => sum + getAttachmentCount(post.attachments), 0);
    const postsWithImages = posts.filter((post) => getAttachmentCount(post.attachments) > 0).length;
    const anonymousPosts = posts.filter((post) => post.anonymous).length;
    const uniqueAuthors = new Set(posts.map((post) => post.authorId)).size;
    const activeAuthors30d = new Set(recentPosts30d.map((post) => post.authorId)).size;

    const publishStatusCounts = Object.fromEntries(publishAttemptStatuses.map((status) => [status, 0]));
    for (const group of publishAttemptGroups) {
      publishStatusCounts[group.status] = group._count._all;
    }
    const publishTotal = Object.values(publishStatusCounts).reduce((sum, value) => sum + value, 0);
    const publishSucceeded = publishStatusCounts.succeeded ?? 0;
    const publishFailed = publishStatusCounts.failed ?? 0;
    const publishSuccessRate = publishTotal > 0 ? Math.round((publishSucceeded / publishTotal) * 1000) / 10 : null;

    const targetStats = publishTargets.map((target) => {
      const groups = publishAttemptsByTarget.filter((group) => group.publishTargetId === target.id);
      const counts = Object.fromEntries(publishAttemptStatuses.map((status) => [status, 0]));
      for (const group of groups) {
        counts[group.status] = group._count._all;
      }
      const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
      return {
        id: target.id,
        displayName: target.displayName,
        enabled: target.enabled,
        required: target.required,
        delaySeconds: target.publishDelaySeconds,
        bot: {
          qqUin: target.botAccount.qqUin.toString(),
          displayName: target.botAccount.displayName,
        },
        counts,
        successRate: total > 0 ? Math.round(((counts.succeeded ?? 0) / total) * 1000) / 10 : null,
      };
    });

    const roleCounts = Object.fromEntries(["submitter", "reviewer", "admin"].map((role) => [role, 0]));
    for (const group of memberRoleGroups) {
      roleCounts[group.role] = group._count._all;
    }

    const topAuthorIds = [...new Set(rangePosts.map((post) => post.authorId))];
    const topAuthorUsers = await prisma.user.findMany({
      where: {
        id: { in: topAuthorIds },
        memberships: {
          some: {
            tenantId,
          },
        },
      },
      select: {
        id: true,
        qqUin: true,
        displayName: true,
      },
    });
    const topAuthorUserById = new Map(topAuthorUsers.map((user) => [user.id, user]));

    return {
      generatedAt: now.toISOString(),
      range: {
        days: rangeDays,
        since: sinceRange.toISOString(),
        until: now.toISOString(),
      },
      overview: {
        totalPosts,
        recent7Posts: recent7Posts.length,
        recent30Posts: recentPosts30d.length,
        uniqueAuthors,
        activeAuthors30d,
        anonymousPosts,
        anonymousRate: totalPosts > 0 ? Math.round((anonymousPosts / totalPosts) * 1000) / 10 : null,
        postsWithImages,
        imageRate: totalPosts > 0 ? Math.round((postsWithImages / totalPosts) * 1000) / 10 : null,
        imagesTotal,
        avgImagesPerPost: totalPosts > 0 ? Math.round((imagesTotal / totalPosts) * 100) / 100 : null,
        avgReviewMinutes,
      },
      posts: {
        byStatus: statusCounts,
        daily: buildDailySeries(rangePosts, sinceRange, now),
        userDaily: buildUserDailySeries(memberships, sinceRange, now),
        hourly: buildHourlySeries(rangePosts),
        topAuthors30d: buildTopAuthors(rangePosts, topAuthorUserById),
      },
      review: {
        reviewed30d: reviewedLogs.length,
        approved30d: reviewedLogs.filter((log) => log.newStatus === "approved").length,
        rejected30d: reviewedLogs.filter((log) => log.newStatus === "rejected").length,
        avgReviewMinutes,
      },
      publishing: {
        byStatus: publishStatusCounts,
        successRate: publishSuccessRate,
        targets: targetStats,
        recentFailures: recentFailedAttempts.map((attempt) => ({
          id: attempt.id,
          postDisplayId: attempt.post.displayId,
          postText: attempt.post.text,
          postStatus: attempt.post.status,
          targetName: attempt.publishTarget.displayName,
          botName: attempt.publishTarget.botAccount.displayName,
          botQqUin: attempt.publishTarget.botAccount.qqUin.toString(),
          lastError: attempt.lastError,
          updatedAt: attempt.updatedAt.toISOString(),
        })),
      },
      members: {
        byRole: roleCounts,
        total: Object.values(roleCounts).reduce((sum, value) => sum + value, 0),
        activeBans: activeBanCount,
        totalBans: totalBanCount,
      },
      qzoneVisitors: {
        daily: buildQZoneVisitorDailySeries(qzoneVisitorSnapshots, sinceRange, now),
        targets: buildQZoneVisitorTargetSeries(
          qzoneVisitorSnapshots,
          publishTargets.map((target) => ({
            id: target.id,
            displayName: target.displayName,
            botAccountId: target.botAccountId,
            botDisplayName: target.botAccount.displayName,
            botQqUin: target.botAccount.qqUin.toString(),
          })),
          sinceRange,
          now,
        ),
      },
      bots: bots.map((bot) => {
        const qzoneSession = bot.sessions[0] ?? null;
        return {
          id: bot.id,
          qqUin: bot.qqUin.toString(),
          displayName: bot.displayName,
          enabled: bot.enabled,
          reviewGroupId: bot.reviewGroupId,
          publishTargetCount: bot.publishTargets.length,
          lastSeenAt: bot.lastSeenAt?.toISOString() ?? null,
          qzoneSession: qzoneSession
            ? {
                status: qzoneSession.healthStatus,
                checkedAt: qzoneSession.healthCheckedAt?.toISOString() ?? null,
                message: qzoneSession.healthMessage,
                refreshedAt: qzoneSession.refreshedAt.toISOString(),
              }
            : null,
        };
      }),
      audit: {
        actions30d: auditGroups
          .map((group) => ({
            action: group.action,
            count: group._count._all,
          }))
          .sort((a, b) => b.count - a.count),
      },
    };
  });
}

function getAttachmentCount(attachments: unknown) {
  return Array.isArray(attachments) ? attachments.length : 0;
}

function parseRangeDays(query: unknown) {
  const rawValue = query && typeof query === "object" && "days" in query ? (query as { days?: unknown }).days : undefined;
  const value = typeof rawValue === "string" ? Number(rawValue) : typeof rawValue === "number" ? rawValue : 14;
  return [7, 14, 30, 90].includes(value) ? value : 14;
}

function buildDailySeries(posts: Array<{ createdAt: Date; status: string }>, start: Date, end: Date) {
  const startDay = startOfDay(start);
  const endDay = startOfDay(end);
  const days = [];
  for (let time = startDay.getTime(); time <= endDay.getTime(); time += dayMs) {
    const date = new Date(time);
    days.push({
      date: formatDayKey(date),
      total: 0,
      approved: 0,
      rejected: 0,
      published: 0,
    });
  }
  const byDate = new Map(days.map((day) => [day.date, day]));
  for (const post of posts) {
    const day = byDate.get(formatDayKey(post.createdAt));
    if (!day) continue;
    day.total += 1;
    if (post.status === "approved") day.approved += 1;
    if (post.status === "rejected") day.rejected += 1;
    if (post.status === "published") day.published += 1;
  }
  return days;
}

function buildUserDailySeries(memberships: Array<{ createdAt: Date }>, start: Date, end: Date) {
  const startDay = startOfDay(start);
  const endDay = startOfDay(end);
  const days = [];
  let runningTotal = memberships.filter((membership) => membership.createdAt < startDay).length;
  for (let time = startDay.getTime(); time <= endDay.getTime(); time += dayMs) {
    const date = new Date(time);
    const key = formatDayKey(date);
    const nextDay = new Date(time + dayMs);
    const newMembers = memberships.filter((membership) => membership.createdAt >= date && membership.createdAt < nextDay).length;
    runningTotal += newMembers;
    days.push({
      date: key,
      newMembers,
      totalMembers: runningTotal,
    });
  }
  return days;
}

function buildHourlySeries(posts: Array<{ createdAt: Date }>) {
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, total: 0 }));
  for (const post of posts) {
    const bucket = hours[post.createdAt.getHours()];
    if (bucket) {
      bucket.total += 1;
    }
  }
  return hours;
}

function buildTopAuthors(
  posts: Array<{ authorId: string }>,
  usersById: Map<string, { id: string; qqUin: bigint; displayName: string | null }>,
) {
  const counts = new Map<string, number>();
  for (const post of posts) {
    counts.set(post.authorId, (counts.get(post.authorId) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([authorId, count]) => {
      const user = usersById.get(authorId);
      return {
        authorId,
        count,
        user: user
          ? {
              id: user.id,
              qqUin: user.qqUin.toString(),
              displayName: user.displayName,
            }
          : null,
      };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatDayKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
