type PostQZoneComment = {
  uin: string;
  name: string;
  content: string;
  images: string[];
  createdAt: string | null;
  replies?: Array<{ uin: string; name: string; content: string; images: string[]; createdAt: string | null }>;
};

export type PostQZoneMetric = {
  visitorCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  forwardCount?: number | null;
  comments?: unknown;
  lastError: string | null;
  checkedAt: Date | null;
  qzoneTid: string;
  publishAttempt?: {
    publishTarget?: {
      displayName: string;
      botAccount?: {
        displayName: string;
        qqUin: bigint;
      };
    };
  };
};

/**
 * 从稿件日志中推断投稿来源渠道。
 * - 日志 comment 包含 "私聊" → 对话投稿（bot 私聊）
 * - 否则 → 网页投稿
 */
function inferSubmissionChannel(logs?: Array<{ comment: string }>): "private" | "web" {
  if (logs && logs.some((log) => log.comment.includes("私聊"))) {
    return "private";
  }
  return "web";
}

export function toPostListItem(post: {
  id: string;
  displayId: number;
  text: string;
  attachments: unknown;
  anonymous: boolean;
  anonymousAvatar?: string | null;
  bgColor?: string | null;
  textColor?: string | null;
  font?: string | null;
  status: string;
  recallIgnored?: boolean;
  recallIgnoredAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
  logs?: Array<{
    oldStatus: string | null;
    newStatus: string;
    comment: string;
    createdAt: Date;
  }>;
  qzonePostMetrics?: PostQZoneMetric[];
  follows?: Array<{ id: string }>;
  batchItem?: {
    batch: {
      status: string;
      items: Array<{ post: { displayId: number } }>;
    };
  } | null;
}) {
  const recallLog = post.logs
    ?.filter((log) => log.oldStatus === "published" && log.newStatus === "pending_recall")
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0];
  const recallReason = recallLog?.comment.startsWith("用户申请撤回：") ? recallLog.comment.slice("用户申请撤回：".length).trim() : null;

  return {
    id: post.id,
    displayId: post.displayId,
    title: post.text.length > 28 ? `${post.text.slice(0, 28)}...` : post.text,
    text: post.text,
    attachments: post.attachments,
    anonymous: post.anonymous,
    anonymousAvatar: post.anonymousAvatar ?? null,
    bgColor: post.bgColor ?? null,
    textColor: post.textColor ?? null,
    font: post.font ?? null,
    status: post.status,
    recallIgnored: Boolean(post.recallIgnored),
    recallIgnoredAt: post.recallIgnoredAt?.toISOString() ?? null,
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
    recallReason,
    following: Boolean(post.follows && post.follows.length > 0),
    submissionChannel: inferSubmissionChannel(post.logs),
    qzoneStats: toQZonePostStats(post.qzonePostMetrics ?? []),
    batch: toBatchSummary(post.batchItem, post.displayId),
  };
}

/**
 * 批量稿件的"同说说"提示：返回同批次其他稿件的 displayId 列表与总条数。
 * 非批量稿件返回 null。
 */
function toBatchSummary(
  batchItem: { batch: { status: string; items: Array<{ post: { displayId: number } }> } } | null | undefined,
  selfDisplayId: number,
) {
  if (!batchItem) {
    return null;
  }
  const displayIds = batchItem.batch.items.map((item) => item.post.displayId).sort((a, b) => a - b);
  return {
    postCount: displayIds.length,
    displayIds,
    otherDisplayIds: displayIds.filter((displayId) => displayId !== selfDisplayId),
    // 批次仍在批量收集中（尚未真正发布）。前端据此把"发布中"显示为"等待批次"。
    collecting: batchItem.batch.status === "collecting",
  };
}

export type PostTimelineActor = { displayName: string | null; qqUin: string | null };

/**
 * 将稿件状态变更日志整理成完整时间线（按时间升序）。
 * actorId 为 null = 系统自动操作；否则用传入的 actors 映射解析操作人。
 */
export function toPostTimeline(
  logs: Array<{ actorId: string | null; oldStatus: string | null; newStatus: string; comment: string; createdAt: Date }> | undefined,
  actors: Map<string, PostTimelineActor>,
) {
  if (!logs) {
    return [];
  }
  return [...logs]
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((log) => {
      const actor = log.actorId ? actors.get(log.actorId) ?? null : null;
      return {
        actorId: log.actorId,
        actorName: actor?.displayName ?? null,
        actorQq: actor?.qqUin ?? null,
        oldStatus: log.oldStatus,
        newStatus: log.newStatus,
        comment: log.comment,
        createdAt: log.createdAt.toISOString(),
      };
    });
}

export function toQZonePostStats(metrics: PostQZoneMetric[]) {
  if (metrics.length === 0) {
    return null;
  }

  const totals = {
    visitorCount: 0,
    likeCount: 0,
    commentCount: 0,
    forwardCount: 0,
  };
  let hasCounts = false;
  let checkedAtTime: number | null = null;
  const targets = metrics.map((metric) => {
    if (metric.visitorCount !== null || metric.likeCount !== null || metric.commentCount !== null || (metric.forwardCount ?? null) !== null) {
      hasCounts = true;
    }
    totals.visitorCount += metric.visitorCount ?? 0;
    totals.likeCount += metric.likeCount ?? 0;
    totals.commentCount += metric.commentCount ?? 0;
    totals.forwardCount += metric.forwardCount ?? 0;
    if (metric.checkedAt && (checkedAtTime === null || metric.checkedAt.getTime() > checkedAtTime)) {
      checkedAtTime = metric.checkedAt.getTime();
    }
    return {
      targetName: metric.publishAttempt?.publishTarget?.displayName ?? "QZone 发布目标",
      botName: metric.publishAttempt?.publishTarget?.botAccount?.displayName ?? null,
      botQqUin: metric.publishAttempt?.publishTarget?.botAccount?.qqUin.toString() ?? null,
      qzoneTid: metric.qzoneTid,
      visitorCount: metric.visitorCount,
      likeCount: metric.likeCount,
      commentCount: metric.commentCount,
      forwardCount: metric.forwardCount ?? null,
      checkedAt: metric.checkedAt?.toISOString() ?? null,
      lastError: metric.lastError,
      comments: normalizeQZoneComments(metric.comments),
    };
  });

  // 多墙号时保证稳定且一致的展示顺序：按机器人 QQ 号（墙号）升序，
  // 再回退到墙名 / qzoneTid，避免不同稿件里「一墙」时前时后。
  targets.sort((left, right) => {
    const leftQq = left.botQqUin ?? "";
    const rightQq = right.botQqUin ?? "";
    if (leftQq !== rightQq) {
      if (leftQq && rightQq) {
        return leftQq.localeCompare(rightQq, undefined, { numeric: true });
      }
      return leftQq ? -1 : 1;
    }
    const byName = left.targetName.localeCompare(right.targetName, "zh-Hans-CN");
    if (byName !== 0) {
      return byName;
    }
    return left.qzoneTid.localeCompare(right.qzoneTid);
  });

  return {
    visitorCount: hasCounts ? totals.visitorCount : null,
    likeCount: hasCounts ? totals.likeCount : null,
    commentCount: hasCounts ? totals.commentCount : null,
    forwardCount: hasCounts ? totals.forwardCount : null,
    checkedAt: checkedAtTime === null ? null : new Date(checkedAtTime).toISOString(),
    targets,
    logs: targets
      .filter((target) => target.lastError)
      .map((target) => ({
        targetName: target.targetName,
        botName: target.botName,
        botQqUin: target.botQqUin,
        qzoneTid: target.qzoneTid,
        message: target.lastError ?? "QZone 单条数据获取失败",
        checkedAt: target.checkedAt,
      })),
  };
}

function normalizeQZoneComments(value: unknown): PostQZoneComment[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const comments: PostQZoneComment[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const c = raw as Record<string, unknown>;
    const replies = Array.isArray(c.replies)
      ? c.replies.flatMap((rawReply) => {
          if (!rawReply || typeof rawReply !== "object") {
            return [];
          }
          const r = rawReply as Record<string, unknown>;
          return [
            {
              uin: typeof r.uin === "string" ? r.uin : String(r.uin ?? ""),
              name: typeof r.name === "string" ? r.name : "",
              content: typeof r.content === "string" ? r.content : "",
              images: normalizeQZoneCommentImages(r.images),
              createdAt: typeof r.createdAt === "string" ? r.createdAt : null,
            },
          ];
        })
      : [];
    comments.push({
      uin: typeof c.uin === "string" ? c.uin : String(c.uin ?? ""),
      name: typeof c.name === "string" ? c.name : "",
      content: typeof c.content === "string" ? c.content : "",
      images: normalizeQZoneCommentImages(c.images),
      createdAt: typeof c.createdAt === "string" ? c.createdAt : null,
      replies,
    });
  }
  return comments;
}

function normalizeQZoneCommentImages(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const images: string[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      const trimmed = item.trim();
      if (trimmed && !images.includes(trimmed)) {
        images.push(trimmed);
      }
    }
  }
  return images;
}
