import { describe, expect, test } from "bun:test";
import { renderPublishCaption, wrapBatchCaptionWithFixedText } from "./publishing";
import { joinBatchCaptions } from "./publish-batching";

const template = {
  customText: "【沙塘大遭墙】",
  suffixText: "投稿请私聊本号",
  includePostId: true,
  includeAuthorMention: false,
  includeLinks: false,
};

const basePost = { text: "hi", anonymous: true, authorQq: "10001" };

describe("renderPublishCaption single-post (omitFixedText off)", () => {
  test("含固定前缀 + #号 + 固定后缀", () => {
    expect(renderPublishCaption(template, { ...basePost, postId: 6449 })).toBe(
      "【沙塘大遭墙】 #6449\n投稿请私聊本号",
    );
  });

  test("无模板时兜底 #号", () => {
    expect(renderPublishCaption(null, { ...basePost, postId: 12 })).toBe("#12");
  });
});

describe("renderPublishCaption batch member (omitFixedText on)", () => {
  test("只保留可变部分 #号，不含固定前后缀", () => {
    expect(renderPublishCaption(template, { ...basePost, postId: 6449, omitFixedText: true })).toBe("#6449");
  });

  test("includePostId 关闭时可变部分可为空字符串（不兜底 #号）", () => {
    const noId = { ...template, includePostId: false };
    expect(renderPublishCaption(noId, { ...basePost, postId: 6449, omitFixedText: true })).toBe("");
  });
});

describe("批量整条说说：固定前后缀各只出现一次", () => {
  test("两条批量稿件 → 前缀一次 + 两条 #号 + 后缀一次", () => {
    const parts = [6449, 6450].map((postId) =>
      renderPublishCaption(template, { ...basePost, postId, omitFixedText: true }),
    );
    const body = joinBatchCaptions(parts);
    const full = wrapBatchCaptionWithFixedText(template, body);
    expect(full).toBe("【沙塘大遭墙】\n#6449\n———\n#6450\n投稿请私聊本号");
    // 关键断言：前缀/后缀全文各只出现一次
    expect(full.match(/【沙塘大遭墙】/g)?.length).toBe(1);
    expect(full.match(/投稿请私聊本号/g)?.length).toBe(1);
  });

  test("空前后缀模板：只剩各稿可变部分", () => {
    const bare = { ...template, customText: "", suffixText: "" };
    const parts = [1, 2].map((postId) => renderPublishCaption(bare, { ...basePost, postId, omitFixedText: true }));
    const full = wrapBatchCaptionWithFixedText(bare, joinBatchCaptions(parts));
    expect(full).toBe("#1\n———\n#2");
  });
});
