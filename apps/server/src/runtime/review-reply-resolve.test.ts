import { describe, expect, test } from "bun:test";
import { extractDisplayIdFromReviewText, readQuotedReplyPayload } from "./review-reply-resolve";

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

describe("readQuotedReplyPayload", () => {
  test("从段数组提取发送者与文本，跳过 reply/at 段", () => {
    const payload = readQuotedReplyPayload({
      sender: { user_id: 20002 },
      message: [
        { type: "reply", data: { id: "1" } },
        { type: "at", data: { qq: 20002 } },
        { type: "text", data: { text: "📮 墙新稿件\n编号：#6810" } },
      ],
    });
    expect(payload).toEqual({ senderId: "20002", text: "📮 墙新稿件\n编号：#6810" });
  });

  test("message 为字符串时直接使用", () => {
    const payload = readQuotedReplyPayload({
      sender: { user_id: 20002 },
      message: "编号：#6810",
    });
    expect(payload).toEqual({ senderId: "20002", text: "编号：#6810" });
  });

  test("message 缺失时回退到 raw_message", () => {
    const payload = readQuotedReplyPayload({
      sender: { user_id: 20002 },
      raw_message: "编号：#42",
    });
    expect(payload).toEqual({ senderId: "20002", text: "编号：#42" });
  });

  test("sender 缺失时 senderId 为 null 仍返回文本", () => {
    const payload = readQuotedReplyPayload({
      message: [{ type: "text", data: { text: "编号：#7" } }],
    });
    expect(payload).toEqual({ senderId: null, text: "编号：#7" });
  });

  test("无效输入返回 null", () => {
    expect(readQuotedReplyPayload(null)).toBeNull();
    expect(readQuotedReplyPayload("not-an-object")).toBeNull();
  });
});
