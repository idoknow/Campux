import { describe, expect, test } from "bun:test";
import { beijingParts, isBeijingPushHour, collectCommentPreviews, buildDigestMessage } from "./followed-post-comments";

describe("beijing push hour detection", () => {
  test("UTC 02:00 maps to Beijing 10:00 (a push slot)", () => {
    const date = new Date(Date.UTC(2026, 5, 5, 2, 0, 0));
    expect(beijingParts(date).hour).toBe(10);
    expect(isBeijingPushHour(date)).toBe(true);
  });

  test("UTC 14:00 maps to Beijing 22:00 (a push slot)", () => {
    const date = new Date(Date.UTC(2026, 5, 5, 14, 0, 0));
    expect(beijingParts(date).hour).toBe(22);
    expect(isBeijingPushHour(date)).toBe(true);
  });

  test("does not push during the Beijing sleeping window (03:00)", () => {
    // Beijing 03:00 == UTC 19:00 previous day
    const date = new Date(Date.UTC(2026, 5, 4, 19, 0, 0));
    expect(beijingParts(date).hour).toBe(3);
    expect(isBeijingPushHour(date)).toBe(false);
  });

  test("does not push at Beijing 14:00 (not a slot)", () => {
    const date = new Date(Date.UTC(2026, 5, 5, 6, 0, 0));
    expect(beijingParts(date).hour).toBe(14);
    expect(isBeijingPushHour(date)).toBe(false);
  });
});

describe("comment preview collection", () => {
  test("flattens multiple metric columns, newest first, truncates long content", () => {
    const colA = [
      { name: "小明", content: "枪是干嘛用的", createdAt: "2026-06-04T16:45:44.000Z" },
      { name: "阿萱", content: "这条评论非常非常非常非常非常非常长应该被截断掉", createdAt: "2026-06-04T18:00:40.000Z" },
    ];
    const colB = [
      { name: "四季", content: "可惜袋鼠过不了安检", createdAt: "2026-06-04T20:04:09.000Z" },
    ];
    const previews = collectCommentPreviews([colA, colB]);
    expect(previews.length).toBe(3);
    // newest first
    expect(previews[0]).toContain("四季");
    expect(previews[1]).toContain("阿萱");
    expect(previews[1]).toContain("…"); // truncated
    expect(previews[2]).toContain("小明");
  });

  test("handles empty/invalid columns and missing content", () => {
    const previews = collectCommentPreviews([null, "oops", [{ name: "无名" }]]);
    expect(previews.length).toBe(1);
    expect(previews[0]).toContain("无名");
    expect(previews[0]).toContain("（无文字内容）");
  });

  test("caps preview to 3 even with many comments", () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ name: `u${i}`, content: `c${i}`, createdAt: `2026-06-0${(i % 9) + 1}T00:00:00.000Z` }));
    expect(collectCommentPreviews([many]).length).toBe(3);
  });
});

describe("digest message", () => {
  test("is abbreviated: shows counts + previews + site pointer, no full dump", () => {
    const message = buildDigestMessage(123, 17, 5, ["四季：可惜袋鼠过不了安检", "阿萱：一只也打不过"]);
    expect(message).toContain("#123");
    expect(message).toContain("新增 5 条");
    expect(message).toContain("当前共 17 条");
    expect(message).toContain("最新几条");
    expect(message).toContain("完整评论请在稿件页查看");
  });

  test("omits preview section when no previews available", () => {
    const message = buildDigestMessage(7, 2, 2, []);
    expect(message).not.toContain("最新几条");
    expect(message).toContain("完整评论请在稿件页查看");
  });
});
