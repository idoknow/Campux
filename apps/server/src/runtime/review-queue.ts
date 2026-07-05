import { formatReviewQueueReminderMessages, reviewQueueDefaultDisplayLimit, type ReviewQueueItem } from "../lib/bot-messages";
import type { prisma as prismaClient } from "../lib/prisma";

export const reviewQueueDisplayLimit = reviewQueueDefaultDisplayLimit;
export const reviewQueueReminderIntervalMs = 5 * 60 * 1000;

export type ReviewQueueBot = {
  id: string;
  tenantId: string;
  qqUin: bigint;
  reviewGroupId: string | null;
  reviewQueueReminderThresholdHours: number;
};

export type ReviewQueueReminder = {
  bot: ReviewQueueBot;
  items: Array<ReviewQueueItem & { id: string }>;
  hiddenCount: number;
  messageChunks: unknown[];
};

type PostForReviewQueue = {
  id: string;
  displayId: number;
  text: string;
  attachments: unknown;
  anonymous: boolean;
  createdAt: Date;
  author: {
    displayName: string | null;
    qqUin: bigint;
  };
};

export function toReviewQueueItem(post: PostForReviewQueue): ReviewQueueItem & { id: string } {
  return {
    id: post.id,
    displayId: post.displayId,
    authorName: post.author.displayName ?? "未命名",
    authorQqUin: post.author.qqUin.toString(),
    anonymous: post.anonymous,
    text: post.text,
    imageCount: countImageAttachments(post.attachments),
    createdAt: post.createdAt,
  };
}

export async function listPendingReviewQueue(prisma: typeof prismaClient, tenantId: string, limit = reviewQueueDisplayLimit) {
  const [posts, total] = await Promise.all([
    prisma.post.findMany({
      where: {
        tenantId,
        status: "pending_approval",
      },
      include: {
        author: true,
      },
      orderBy: {
        createdAt: "asc",
      },
      take: limit,
    }),
    prisma.post.count({
      where: {
        tenantId,
        status: "pending_approval",
      },
    }),
  ]);

  return {
    items: posts.map(toReviewQueueItem),
    total,
    hiddenCount: Math.max(0, total - posts.length),
  };
}

export async function collectOverdueReviewReminders(
  prisma: typeof prismaClient,
  now = new Date(),
  limit = reviewQueueDisplayLimit,
): Promise<ReviewQueueReminder[]> {
  const bots = await prisma.botAccount.findMany({
    where: {
      enabled: true,
      reviewQueueAutoReminderEnabled: true,
      reviewQueueReminderThresholdHours: {
        gt: 0,
      },
      reviewGroupId: {
        not: null,
      },
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  const reminders: ReviewQueueReminder[] = [];
  const seenTenantIds = new Set<string>();
  for (const bot of bots) {
    if (seenTenantIds.has(bot.tenantId)) {
      continue;
    }
    seenTenantIds.add(bot.tenantId);

    const thresholdHours = bot.reviewQueueReminderThresholdHours;
    const overdueBefore = new Date(now.getTime() - thresholdHours * 60 * 60 * 1000);
    const candidates = await prisma.post.findMany({
      where: {
        tenantId: bot.tenantId,
        status: "pending_approval",
        reviewQueueReminderSentAt: null,
        createdAt: {
          lte: overdueBefore,
        },
      },
      select: {
        id: true,
      },
      orderBy: {
        createdAt: "asc",
      },
    });
    if (candidates.length === 0) {
      continue;
    }

    const candidateIds = candidates.map((post) => post.id);
    const claimedIds: string[] = [];
    for (const postId of candidateIds) {
      const result = await markReviewQueueReminderSent(prisma, [postId], now);
      if (result.count === 1) {
        claimedIds.push(postId);
      }
    }
    if (claimedIds.length === 0) {
      continue;
    }
    const posts = await prisma.post.findMany({
      where: {
        id: {
          in: claimedIds,
        },
        tenantId: bot.tenantId,
        status: "pending_approval",
        reviewQueueReminderSentAt: now,
      },
      include: {
        author: true,
      },
      orderBy: {
        createdAt: "asc",
      },
    });
    if (posts.length === 0) {
      continue;
    }

    const items = posts.slice(0, limit).map(toReviewQueueItem);
    const hiddenCount = Math.max(0, posts.length - items.length);
    reminders.push({
      bot: {
        id: bot.id,
        tenantId: bot.tenantId,
        qqUin: bot.qqUin,
        reviewGroupId: bot.reviewGroupId,
        reviewQueueReminderThresholdHours: thresholdHours,
      },
      items,
      hiddenCount,
      messageChunks: buildReviewQueueReminderMessages(items, thresholdHours, now, hiddenCount),
    });
  }
  return reminders;
}

export async function markReviewQueueReminderSent(prisma: typeof prismaClient, postIds: string[], sentAt = new Date()) {
  if (postIds.length === 0) {
    return { count: 0 };
  }
  return prisma.post.updateMany({
    where: {
      id: {
        in: postIds,
      },
      status: "pending_approval",
      reviewQueueReminderSentAt: null,
    },
    data: {
      reviewQueueReminderSentAt: sentAt,
    },
  });
}

export function buildReviewQueueReminderMessages(items: ReviewQueueItem[], thresholdHours: number, now = new Date(), hiddenCount = 0, maxChars?: number) {
  return formatReviewQueueReminderMessages(items, thresholdHours, now, hiddenCount, maxChars).map((text, index) => {
    if (index > 0) {
      return text;
    }
    return [
      {
        type: "at",
        data: {
          qq: "all",
        },
      },
      {
        type: "text",
        data: {
          text: `\n${text}`,
        },
      },
    ];
  });
}

function countImageAttachments(attachments: unknown) {
  if (!Array.isArray(attachments)) {
    return 0;
  }
  return attachments.filter((attachment) => {
    if (!attachment || typeof attachment !== "object") {
      return false;
    }
    return (attachment as { kind?: unknown }).kind === "image";
  }).length;
}
