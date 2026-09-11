import { describe, expect, test } from "bun:test";
import { extractDisplayIdFromReviewText, isAllowedReplySender } from "./review-reply-resolve";

describe("extractDisplayIdFromReviewText", () => {
  const reviewText = [
    "📮 中山中学校园墙新稿件",
    "编号：#6724",
    "投稿人：匿名（QQ 123）",
    "来源：网页投稿",
    "图片：0 张",
    "",
    "有没有人上过学…",
    "",
    "通过：#通过 6724",
    "拒绝：#拒绝 <理由> 6724",
  ].join("\n");

  test("从审核通知提取编号", () => {
    expect(extractDisplayIdFromReviewText(reviewText)).toBe(6724);
  });

  test("兼容半角冒号编号", () => {
    expect(extractDisplayIdFromReviewText("编号: #42\n通过：#通过 42")).toBe(42);
  });

  test("无编号时返回 null", () => {
    expect(extractDisplayIdFromReviewText("随便聊聊")).toBeNull();
  });
});

describe("isAllowedReplySender", () => {
  test("sender 缺失时允许继续解析", () => {
    expect(isAllowedReplySender(null, "10001")).toBe(true);
  });

  test("sender 是本 bot 时允许", () => {
    expect(isAllowedReplySender("10001", "10001")).toBe(true);
  });

  test("sender 是其他用户时拒绝", () => {
    expect(isAllowedReplySender("20002", "10001")).toBe(false);
  });
});
