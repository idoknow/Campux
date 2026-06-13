import { describe, expect, test } from "bun:test";
import { buildPublishedFeed, type BatchFeedInput, type RawFeedPost, type SingleFeedInput } from "./published-feed";
import type { PostQZoneMetric } from "./posts";

function makePost(overrides: Partial<RawFeedPost> & { id: string; displayId: number }): RawFeedPost {
  return {
    text: `稿件 ${overrides.displayId}`,
    attachments: [],
    anonymous: false,
    bgColor: null,
    textColor: null,
    author: { displayName: `用户${overrides.displayId}`, qqUin: BigInt(10000 + overrides.displayId) },
    createdAt: new Date("2026-06-08T00:00:00Z"),
    ...overrides,
  };
}

function makeMetric(overrides: Partial<PostQZoneMetric> & { qzoneTid: string }): PostQZoneMetric {
  return {
    visitorCount: 10,
    likeCount: 2,
    commentCount: 1,
    forwardCount: 0,
    comments: [],
    lastError: null,
    checkedAt: new Date("2026-06-08T01:00:00Z"),
    publishAttempt: {
      publishTarget: {
        displayName: "QZone 发布目标",
        botAccount: { displayName: "墙号A", qqUin: BigInt(20001) },
      },
    },
    ...overrides,
  };
}

describe("buildPublishedFeed", () => {
  test("实名 single 稿件返回完整作者", () => {
    const singles: SingleFeedInput[] = [
      {
        post: makePost({ id: "p1", displayId: 1 }),
        publishedAt: new Date("2026-06-08T02:00:00Z"),
        metrics: [makeMetric({ qzoneTid: "tid1" })],
      },
    ];
    const items = buildPublishedFeed({ singles, batches: [], viewerIsReviewer: false });
    expect(items).toHaveLength(1);
    expect(items[0]!.kind).toBe("single");
    expect(items[0]!.posts).toHaveLength(1);
    expect(items[0]!.posts[0]!.author).toEqual({ displayName: "用户1", qqUin: "10001" });
    expect(items[0]!.qzoneStats?.visitorCount).toBe(10);
  });

  test("匿名 single + 普通用户 → author 为 null", () => {
    const singles: SingleFeedInput[] = [
      {
        post: makePost({ id: "p1", displayId: 1, anonymous: true }),
        publishedAt: new Date("2026-06-08T02:00:00Z"),
        metrics: [makeMetric({ qzoneTid: "tid1" })],
      },
    ];
    const items = buildPublishedFeed({ singles, batches: [], viewerIsReviewer: false });
    expect(items[0]!.posts[0]!.author).toBeNull();
    expect(items[0]!.posts[0]!.anonymous).toBe(true);
  });

  test("匿名 single + 审核员 → 返回真实身份并保留 anonymous 标记", () => {
    const singles: SingleFeedInput[] = [
      {
        post: makePost({ id: "p1", displayId: 1, anonymous: true }),
        publishedAt: new Date("2026-06-08T02:00:00Z"),
        metrics: [makeMetric({ qzoneTid: "tid1" })],
      },
    ];
    const items = buildPublishedFeed({ singles, batches: [], viewerIsReviewer: true });
    expect(items[0]!.posts[0]!.author).toEqual({ displayName: "用户1", qqUin: "10001" });
    expect(items[0]!.posts[0]!.anonymous).toBe(true);
  });

  test("batch 3 稿（含 1 匿名）+ 普通用户 → 匿名那条 author null，其余有值，按传入顺序", () => {
    const batches: BatchFeedInput[] = [
      {
        batchId: "b1",
        publishedAt: new Date("2026-06-08T03:00:00Z"),
        posts: [
          makePost({ id: "p1", displayId: 1 }),
          makePost({ id: "p2", displayId: 2, anonymous: true }),
          makePost({ id: "p3", displayId: 3 }),
        ],
        metrics: [makeMetric({ qzoneTid: "tidB" })],
      },
    ];
    const items = buildPublishedFeed({ singles: [], batches, viewerIsReviewer: false });
    expect(items).toHaveLength(1);
    expect(items[0]!.kind).toBe("batch");
    expect(items[0]!.posts.map((p) => p.displayId)).toEqual([1, 2, 3]);
    expect(items[0]!.posts[0]!.author).not.toBeNull();
    expect(items[0]!.posts[1]!.author).toBeNull();
    expect(items[0]!.posts[2]!.author).not.toBeNull();
  });

  test("batch + single 混合 → 两个条目按 publishedAt 降序", () => {
    const singles: SingleFeedInput[] = [
      {
        post: makePost({ id: "ps", displayId: 9 }),
        publishedAt: new Date("2026-06-08T05:00:00Z"), // 更晚
        metrics: [makeMetric({ qzoneTid: "tidS" })],
      },
    ];
    const batches: BatchFeedInput[] = [
      {
        batchId: "b1",
        publishedAt: new Date("2026-06-08T03:00:00Z"), // 更早
        posts: [makePost({ id: "p1", displayId: 1 }), makePost({ id: "p2", displayId: 2 })],
        metrics: [makeMetric({ qzoneTid: "tidB" })],
      },
    ];
    const items = buildPublishedFeed({ singles, batches, viewerIsReviewer: false });
    expect(items).toHaveLength(2);
    expect(items[0]!.kind).toBe("single"); // 05:00 在前
    expect(items[1]!.kind).toBe("batch");
  });

  test("qzoneStats 跨两个墙号 metric → totals 求和", () => {
    const singles: SingleFeedInput[] = [
      {
        post: makePost({ id: "p1", displayId: 1 }),
        publishedAt: new Date("2026-06-08T02:00:00Z"),
        metrics: [
          makeMetric({ qzoneTid: "tidA", visitorCount: 10, likeCount: 2, commentCount: 1 }),
          makeMetric({
            qzoneTid: "tidB",
            visitorCount: 5,
            likeCount: 3,
            commentCount: 4,
            publishAttempt: { publishTarget: { displayName: "墙B", botAccount: { displayName: "墙号B", qqUin: BigInt(20002) } } },
          }),
        ],
      },
    ];
    const items = buildPublishedFeed({ singles, batches: [], viewerIsReviewer: false });
    expect(items[0]!.qzoneStats?.visitorCount).toBe(15);
    expect(items[0]!.qzoneStats?.likeCount).toBe(5);
    expect(items[0]!.qzoneStats?.commentCount).toBe(5);
    expect(items[0]!.qzoneStats?.targets).toHaveLength(2);
  });
});
