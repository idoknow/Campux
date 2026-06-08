import { toQZonePostStats, type PostQZoneMetric } from "./posts";

/**
 * 「已发布」聚合 feed 的整形逻辑（纯函数，无 DB 访问，便于单测）。
 *
 * 聚合单位 = 一条 QQ 空间说说：
 * - 独立发布：1 稿 → 1 个 single 条目。
 * - 批量发布：N 稿合并发一条说说 → 1 个 batch 条目（含 N 条稿件）。
 *
 * 互动数据（浏览/点赞/评论/转发 + 评论列表）按说说聚合（跨墙号求和），
 * 复用 toQZonePostStats。
 *
 * 匿名脱敏在服务端完成：普通用户（非审核员）看匿名稿件时拿不到任何作者信息；
 * 审核员/管理员能看到真实身份（带 anonymous 标记）。实名稿件对所有成员显示昵称 + QQ。
 */

export type RawFeedAuthor = {
  displayName: string;
  qqUin: bigint;
} | null;

export type RawFeedPost = {
  id: string;
  displayId: number;
  text: string;
  attachments: unknown;
  anonymous: boolean;
  author: RawFeedAuthor;
  createdAt: Date;
};

export type PublishedFeedAuthor = {
  displayName: string;
  qqUin: string;
} | null;

export type PublishedFeedPost = {
  id: string;
  displayId: number;
  text: string;
  attachments: unknown;
  anonymous: boolean;
  author: PublishedFeedAuthor;
  createdAt: string;
};

export type PublishedFeedItem = {
  kind: "single" | "batch";
  key: string;
  publishedAt: string;
  posts: PublishedFeedPost[];
  qzoneStats: ReturnType<typeof toQZonePostStats>;
};

/**
 * 作者脱敏：
 * - 匿名稿件 + 非审核员 → null（前端显示「匿名」）。
 * - 匿名稿件 + 审核员/管理员 → 返回真实身份（前端可显示「匿名（实名：…）」）。
 * - 实名稿件 → 所有成员可见昵称 + QQ。
 */
function redactAuthor(post: RawFeedPost, viewerIsReviewer: boolean): PublishedFeedAuthor {
  if (post.anonymous && !viewerIsReviewer) {
    return null;
  }
  if (!post.author) {
    return null;
  }
  return {
    displayName: post.author.displayName,
    qqUin: post.author.qqUin.toString(),
  };
}

function toFeedPost(post: RawFeedPost, viewerIsReviewer: boolean): PublishedFeedPost {
  return {
    id: post.id,
    displayId: post.displayId,
    text: post.text,
    attachments: post.attachments,
    anonymous: post.anonymous,
    author: redactAuthor(post, viewerIsReviewer),
    createdAt: post.createdAt.toISOString(),
  };
}

export type SingleFeedInput = {
  post: RawFeedPost;
  publishedAt: Date | null;
  metrics: PostQZoneMetric[];
};

export type BatchFeedInput = {
  batchId: string;
  publishedAt: Date | null;
  posts: RawFeedPost[]; // 已按 position 升序
  metrics: PostQZoneMetric[];
};

export function buildPublishedFeed(input: {
  singles: SingleFeedInput[];
  batches: BatchFeedInput[];
  viewerIsReviewer: boolean;
}): PublishedFeedItem[] {
  const { viewerIsReviewer } = input;

  const singleItems: PublishedFeedItem[] = input.singles.map((single) => {
    const publishedAt = single.publishedAt ?? single.post.createdAt;
    return {
      kind: "single" as const,
      key: single.post.id,
      publishedAt: publishedAt.toISOString(),
      posts: [toFeedPost(single.post, viewerIsReviewer)],
      qzoneStats: toQZonePostStats(single.metrics),
    };
  });

  const batchItems: PublishedFeedItem[] = input.batches.map((batch) => {
    // 兜底发布时间：批次发布时间为空时取首稿创建时间。
    const fallback = batch.posts[0]?.createdAt ?? new Date(0);
    const publishedAt = batch.publishedAt ?? fallback;
    return {
      kind: "batch" as const,
      key: batch.batchId,
      publishedAt: publishedAt.toISOString(),
      posts: batch.posts.map((post) => toFeedPost(post, viewerIsReviewer)),
      qzoneStats: toQZonePostStats(batch.metrics),
    };
  });

  return [...singleItems, ...batchItems].sort(
    (left, right) => new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime(),
  );
}
