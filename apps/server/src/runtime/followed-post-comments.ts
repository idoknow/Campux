import type { FastifyBaseLogger } from "fastify";
import { prisma } from "../lib/prisma";

/**
 * Pushes an abbreviated "new comments" digest to users who followed their own
 * published posts. Fires twice a day at Beijing 10:00 and 22:00 (12h apart),
 * both well clear of the UTC+8 sleeping window. Content is intentionally
 * truncated — we only tell the user how many new comments arrived plus a short
 * preview, not the full comment text, and point them to the site for details.
 *
 * The scheduler ticks every 10 minutes and only acts when the current Beijing
 * hour matches a push slot and that slot has not already run today (tracked via
 * each follow's lastPushedAt). "New" is measured against lastPushedCommentCount,
 * which is seeded at follow time so a user is never spammed with comments that
 * predate their follow.
 */

const tickIntervalMs = 10 * 60 * 1000;
const beijingPushHours = [10, 22];
const beijingOffsetMs = 8 * 60 * 60 * 1000;
const perUserSpacingMs = 800;
const maxPreviewComments = 3;
const previewContentMax = 18;

type CommentDigestSender = {
  sendPrivateMessageViaTenantBots(tenantId: string, userQqUin: string | bigint, message: string): Promise<boolean>;
};

type StoredComment = {
  uin?: unknown;
  name?: unknown;
  content?: unknown;
  createdAt?: unknown;
};

export function registerFollowedPostCommentScheduler({ caller, logger }: { caller: CommentDigestSender; logger: FastifyBaseLogger }) {
  async function tick() {
    const now = new Date();
    if (!isBeijingPushHour(now)) {
      return;
    }
    const pushed = await pushFollowedPostCommentDigests(caller, logger, now);
    if (pushed > 0) {
      logger.info({ count: pushed }, "followed post comment digest pushed");
    }
  }

  const timer = setInterval(() => {
    void tick().catch((error) => logger.warn({ error }, "followed post comment digest tick failed"));
  }, tickIntervalMs);
  return () => clearInterval(timer);
}

export function beijingParts(date: Date) {
  const shifted = new Date(date.getTime() + beijingOffsetMs);
  return {
    hour: shifted.getUTCHours(),
    // YYYY-MM-DD in Beijing time, used to detect "already pushed in this slot today".
    dayKey: `${shifted.getUTCFullYear()}-${shifted.getUTCMonth() + 1}-${shifted.getUTCDate()}`,
  };
}

export function isBeijingPushHour(date: Date) {
  return beijingPushHours.includes(beijingParts(date).hour);
}

/**
 * Returns the start of the current push slot (the most recent Beijing push-hour
 * boundary) as a UTC Date. A follow whose lastPushedAt is at/after this instant
 * has already been handled in this slot.
 */
function currentSlotStart(now: Date): Date {
  const shifted = new Date(now.getTime() + beijingOffsetMs);
  shifted.setUTCMinutes(0, 0, 0);
  return new Date(shifted.getTime() - beijingOffsetMs);
}

export async function pushFollowedPostCommentDigests(caller: CommentDigestSender, logger: FastifyBaseLogger, now: Date = new Date()) {
  const slotStart = currentSlotStart(now);
  const follows = await prisma.postFollow.findMany({
    where: {
      OR: [{ lastPushedAt: null }, { lastPushedAt: { lt: slotStart } }],
      post: {
        status: "published",
      },
    },
    include: {
      user: {
        select: {
          qqUin: true,
        },
      },
      post: {
        select: {
          id: true,
          displayId: true,
          tenantId: true,
          qzonePostMetrics: {
            select: {
              commentCount: true,
              comments: true,
            },
          },
        },
      },
    },
  });

  let pushed = 0;
  let spacingIndex = 0;
  for (const follow of follows) {
    const metrics = follow.post.qzonePostMetrics;
    const totalCommentCount = metrics.reduce((sum, metric) => sum + (metric.commentCount ?? 0), 0);
    const previous = follow.lastPushedCommentCount;
    const newCount = totalCommentCount - previous;

    // Nothing new since last push (or comments were deleted): just advance the
    // slot marker without messaging, so we don't recheck this follow until the
    // next slot.
    if (newCount <= 0) {
      await prisma.postFollow.update({
        where: { id: follow.id },
        data: { lastPushedAt: now, lastPushedCommentCount: Math.max(totalCommentCount, 0) },
      }).catch((error) => logger.warn({ error, followId: follow.id }, "failed to advance follow slot marker"));
      continue;
    }

    const previews = collectCommentPreviews(metrics.map((metric) => metric.comments));
    const message = buildDigestMessage(follow.post.displayId, totalCommentCount, newCount, previews);

    if (spacingIndex > 0) {
      await delay(perUserSpacingMs);
    }
    spacingIndex += 1;

    try {
      const delivered = await caller.sendPrivateMessageViaTenantBots(follow.post.tenantId, follow.user.qqUin, message);
      if (delivered) {
        await prisma.postFollow.update({
          where: { id: follow.id },
          data: { lastPushedAt: now, lastPushedCommentCount: totalCommentCount },
        });
        pushed += 1;
      } else {
        logger.debug({ followId: follow.id, postId: follow.post.id }, "followed post comment digest not delivered, no online bot");
      }
    } catch (error) {
      logger.warn({ error, followId: follow.id, postId: follow.post.id }, "followed post comment digest send failed");
    }
  }

  return pushed;
}

export function collectCommentPreviews(rawColumns: unknown[]): string[] {
  const all: { createdAt: number; text: string }[] = [];
  for (const column of rawColumns) {
    if (!Array.isArray(column)) {
      continue;
    }
    for (const raw of column as StoredComment[]) {
      if (!raw || typeof raw !== "object") {
        continue;
      }
      const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : "匿名";
      const content = typeof raw.content === "string" ? raw.content.trim() : "";
      const createdAt = typeof raw.createdAt === "string" ? Date.parse(raw.createdAt) : NaN;
      all.push({
        createdAt: Number.isNaN(createdAt) ? 0 : createdAt,
        text: `${name}：${truncate(content || "（无文字内容）", previewContentMax)}`,
      });
    }
  }
  // Newest first so the preview shows the latest activity.
  all.sort((left, right) => right.createdAt - left.createdAt);
  return all.slice(0, maxPreviewComments).map((entry) => entry.text);
}

export function buildDigestMessage(displayId: number, totalCount: number, newCount: number, previews: string[]): string {
  const lines = [
    `你关注的稿件 #${displayId} 有新评论`,
    `新增 ${newCount} 条，当前共 ${totalCount} 条`,
  ];
  if (previews.length > 0) {
    lines.push("", "最新几条：");
    for (const preview of previews) {
      lines.push(`· ${preview}`);
    }
  }
  lines.push("", "完整评论请在稿件页查看。");
  return lines.join("\n");
}

function truncate(value: string, max: number): string {
  const oneLine = value.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) {
    return oneLine;
  }
  return `${oneLine.slice(0, max)}…`;
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
