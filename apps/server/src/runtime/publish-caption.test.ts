import { describe, expect, test } from "bun:test";
import { renderPublishCaption, wrapBatchCaptionWithFixedText, extractQZoneMentions } from "./publishing";
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

describe("LLM 极短总结：位于 @原作者 之后、固定后缀之前", () => {
  const withMention = { ...template, includeAuthorMention: true };
  const namedPost = { text: "hi", anonymous: false, authorQq: "10001" };

  test("单稿：前缀 #号 @作者 总结 + 后缀（总结紧跟 @作者、在后缀前）", () => {
    expect(
      renderPublishCaption(withMention, { ...namedPost, postId: 6449, summary: "食堂今天免费加餐" }),
    ).toBe("【沙塘大遭墙】 #6449 @{uin:10001,nick:,who:1} 食堂今天免费加餐\n投稿请私聊本号");
  });

  test("匿名稿：无 @作者，总结仍在 #号之后、后缀之前", () => {
    expect(
      renderPublishCaption(withMention, { ...basePost, postId: 6449, summary: "寻物启事一则" }),
    ).toBe("【沙塘大遭墙】 #6449 寻物启事一则\n投稿请私聊本号");
  });

  test("批量：每条子稿件各自携带总结，固定后缀整条只一次", () => {
    const parts = [
      renderPublishCaption(withMention, { ...namedPost, postId: 1, summary: "甲总结", omitFixedText: true }),
      renderPublishCaption(withMention, { ...namedPost, postId: 2, summary: "乙总结", omitFixedText: true }),
    ];
    const full = wrapBatchCaptionWithFixedText(withMention, joinBatchCaptions(parts));
    expect(full).toBe(
      "【沙塘大遭墙】\n#1 @{uin:10001,nick:,who:1} 甲总结\n———\n#2 @{uin:10001,nick:,who:1} 乙总结\n投稿请私聊本号",
    );
    expect(full.match(/投稿请私聊本号/g)?.length).toBe(1);
    expect(full).toContain("甲总结");
    expect(full).toContain("乙总结");
  });

  test("无总结时行为与之前完全一致", () => {
    expect(renderPublishCaption(withMention, { ...namedPost, postId: 6449, summary: null })).toBe(
      "【沙塘大遭墙】 #6449 @{uin:10001,nick:,who:1}\n投稿请私聊本号",
    );
  });
});

describe("extractQZoneMentions", () => {
  test("从文本中提取 @QQ 号，转为 QZone @mention 格式", () => {
    expect(extractQZoneMentions("@123456789 你好")).toEqual([
      "@{uin:123456789,nick:,who:1}",
    ]);
  });

  test("多个提及去重", () => {
    expect(extractQZoneMentions("@123456789 @123456789 @987654321")).toEqual([
      "@{uin:123456789,nick:,who:1}",
      "@{uin:987654321,nick:,who:1}",
    ]);
  });

  test("无提及返回空数组", () => {
    expect(extractQZoneMentions("今天天气不错")).toEqual([]);
  });

  test("忽略少于 5 位数字", () => {
    expect(extractQZoneMentions("@1234")).toEqual([]);
  });
});

describe("稿件正文含 @QQ 提及时配文中加入 QZone @mention", () => {
  const withMention = { ...template, includeAuthorMention: false };
  const namedPost = { text: "找 @123456789 同学", anonymous: false, authorQq: "10001" };

  test("单稿：前缀 #号 + @QQ 提及 + 后缀", () => {
    expect(renderPublishCaption(withMention, { ...namedPost, postId: 6449 })).toBe(
      "【沙塘大遭墙】 #6449 @{uin:123456789,nick:,who:1}\n投稿请私聊本号",
    );
  });

  test("与 includeAuthorMention 共存时跳过重复 QQ", () => {
    const withAuthorMention = { ...withMention, includeAuthorMention: true };
    // post.text 中的 @10001 是作者自己，不应重复出现
    const post = { text: "找 @10001 同学", anonymous: false, authorQq: "10001" };
    const result = renderPublishCaption(withAuthorMention, { ...post, postId: 6449 });
    expect(result).toContain("@{uin:10001,nick:,who:1}");
    // 只出现一次
    expect(result.match(/@\{uin:10001,nick:,who:1\}/g)?.length).toBe(1);
  });

  test("匿名稿件不跳过作者 QQ 去重（因为没有 includeAuthorMention）", () => {
    const anonPost = { text: "捞 @987654321", anonymous: true, authorQq: "10001" };
    expect(renderPublishCaption(withMention, { ...anonPost, postId: 6449 })).toBe(
      "【沙塘大遭墙】 #6449 @{uin:987654321,nick:,who:1}\n投稿请私聊本号",
    );
  });

  test("批量模式：每条子稿件各自携带 @QQ 提及", () => {
    const parts = [
      renderPublishCaption(withMention, { text: "找 @111111", anonymous: true, authorQq: "10001", postId: 1, omitFixedText: true }),
      renderPublishCaption(withMention, { text: "捞 @222222", anonymous: true, authorQq: "10001", postId: 2, omitFixedText: true }),
    ];
    const full = wrapBatchCaptionWithFixedText(withMention, joinBatchCaptions(parts));
    expect(full).toBe(
      "【沙塘大遭墙】\n#1 @{uin:111111,nick:,who:1}\n———\n#2 @{uin:222222,nick:,who:1}\n投稿请私聊本号",
    );
    expect(full.match(/投稿请私聊本号/g)?.length).toBe(1);
  });
});
