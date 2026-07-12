import { describe, expect, test } from "bun:test";
import { buildPostRangeOverview } from "./stats-post-overview";

describe("stats post range overview", () => {
  test("summarizes only the posts supplied for the selected time range", () => {
    const overview = buildPostRangeOverview([
      {
        status: "published",
        anonymous: true,
        attachments: [{ url: "a" }, { url: "b" }],
        logs: [{ id: "private-1" }, { id: "duplicate-private-log" }],
      },
      { status: "rejected", anonymous: false, attachments: [], logs: [] },
      { status: "published", anonymous: true, attachments: [{ url: "c" }], logs: [] },
    ]);

    expect(overview).toEqual({
      totalPosts: 3,
      byStatus: {
        pending_approval: 0,
        approved: 0,
        rejected: 1,
        cancelled: 0,
        publishing: 0,
        partially_failed: 0,
        failed: 0,
        published: 2,
        pending_recall: 0,
        recalled: 0,
      },
      bySource: { private: 1, web: 2 },
      anonymousPosts: 2,
      anonymousRate: 66.7,
      postsWithImages: 2,
      imageRate: 66.7,
      imagesTotal: 3,
      avgImagesPerPost: 1,
    });
  });

  test("returns zero counts and empty rates for a range without posts", () => {
    const overview = buildPostRangeOverview([]);

    expect(overview.totalPosts).toBe(0);
    expect(Object.values(overview.byStatus).every((count) => count === 0)).toBe(true);
    expect(overview.bySource).toEqual({ private: 0, web: 0 });
    expect(overview.anonymousRate).toBeNull();
    expect(overview.imageRate).toBeNull();
    expect(overview.avgImagesPerPost).toBeNull();
  });
});
