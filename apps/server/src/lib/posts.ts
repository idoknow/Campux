type PostQZoneMetric = {
  visitorCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  forwardCount?: number | null;
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

export function toPostListItem(post: {
  id: string;
  displayId: number;
  text: string;
  attachments: unknown;
  anonymous: boolean;
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
    status: post.status,
    recallIgnored: Boolean(post.recallIgnored),
    recallIgnoredAt: post.recallIgnoredAt?.toISOString() ?? null,
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
    recallReason,
    qzoneStats: toQZonePostStats(post.qzonePostMetrics ?? []),
  };
}

function toQZonePostStats(metrics: PostQZoneMetric[]) {
  if (metrics.length === 0) {
    return null;
  }

  const totals = {
    visitorCount: 0,
    likeCount: 0,
    commentCount: 0,
  };
  let hasCounts = false;
  let checkedAtTime: number | null = null;
  const targets = metrics.map((metric) => {
    if (metric.visitorCount !== null || metric.likeCount !== null || metric.commentCount !== null) {
      hasCounts = true;
    }
    totals.visitorCount += metric.visitorCount ?? 0;
    totals.likeCount += metric.likeCount ?? 0;
    totals.commentCount += metric.commentCount ?? 0;
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
      checkedAt: metric.checkedAt?.toISOString() ?? null,
      lastError: metric.lastError,
    };
  });

  return {
    visitorCount: hasCounts ? totals.visitorCount : null,
    likeCount: hasCounts ? totals.likeCount : null,
    commentCount: hasCounts ? totals.commentCount : null,
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
