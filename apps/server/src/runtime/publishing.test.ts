import { describe, expect, it } from "bun:test";
import {
  buildQZonePostUrl,
  deriveAggregateStatus,
  renderOfficialQqForumCaption,
  renderOfficialQqForumThreadTitle,
  republishFailureRetryDelayMs,
  shouldWaitForQZoneAttempt,
} from "./publishing";

describe("republish failure timeout", () => {
  it("uses a 12 hour retry delay", () => {
    expect(republishFailureRetryDelayMs).toBe(12 * 60 * 60 * 1000);
  });
});

describe("deriveAggregateStatus", () => {
  it("keeps publishing while a failed attempt still has a scheduled retry", () => {
    const result = deriveAggregateStatus([
      {
        status: "failed",
        nextRunAt: new Date("2026-07-10T12:00:00.000Z"),
        publishTarget: { required: true },
      },
    ]);

    expect(result).toEqual({
      status: "publishing",
      comment: "发布任务仍在进行",
    });
  });

  it("marks failed when the required attempt has no retry scheduled", () => {
    const result = deriveAggregateStatus([
      {
        status: "failed",
        nextRunAt: null,
        publishTarget: { required: true },
      },
    ]);

    expect(result).toEqual({
      status: "failed",
      comment: "发布目标失败，请在管理页查看详情",
    });
  });
});

describe("renderOfficialQqForumCaption", () => {
  it("按频道配文模板渲染稿件编号、投稿人和正文链接", () => {
    expect(renderOfficialQqForumCaption({
      customText: "校园墙",
      suffixText: "欢迎互动",
      includePostId: true,
      includeAuthorMention: true,
      includeLinks: true,
    }, {
      postId: 10,
      text: "1111测试 https://example.com/activity",
      anonymous: false,
      authorQq: "2069528060",
    })).toBe("校园墙 #10 2069528060\nhttps://example.com/activity\n欢迎互动");
  });

  it("匿名稿不泄露 QQ，批量单稿片段不重复固定前后缀", () => {
    expect(renderOfficialQqForumCaption({
      customText: "校园墙",
      suffixText: "欢迎互动",
      includePostId: true,
      includeAuthorMention: true,
      includeLinks: false,
    }, {
      postId: 10,
      text: "1111测试",
      anonymous: true,
      authorQq: "2069528060",
      omitFixedText: true,
    })).toBe("#10");
  });
});

describe("renderOfficialQqForumThreadTitle", () => {
  it("将稿件 ID 和非匿名投稿人 QQ 放入单稿标题", () => {
    expect(renderOfficialQqForumThreadTitle([{ postId: 10, anonymous: false, authorQq: "2069528060" }]))
      .toBe("#10 2069528060");
  });

  it("匿名稿标题不泄露投稿人 QQ", () => {
    expect(renderOfficialQqForumThreadTitle([{ postId: 10, anonymous: true, authorQq: "2069528060" }])).toBe("#10");
  });

  it("批量稿件保留批量标题", () => {
    expect(renderOfficialQqForumThreadTitle([
      { postId: 10, anonymous: false, authorQq: "10000" },
      { postId: 11, anonymous: false, authorQq: "10001" },
    ])).toBe("#10 等 2 条稿件");
  });
});

describe("buildQZonePostUrl", () => {
  it("使用存储的 tid 拼出可点击的 QQ 空间说说链接", () => {
    expect(buildQZonePostUrl("123", "a/b c")).toBe("https://user.qzone.qq.com/123/mood/a%2Fb%20c");
  });
});

describe("shouldWaitForQZoneAttempt", () => {
  it("等待排队、执行中、等待登录态以及已安排重试的 QZone 任务", () => {
    expect(shouldWaitForQZoneAttempt({ status: "queued" })).toBe(true);
    expect(shouldWaitForQZoneAttempt({ status: "running" })).toBe(true);
    expect(shouldWaitForQZoneAttempt({ status: "waiting_cookies" })).toBe(true);
    expect(shouldWaitForQZoneAttempt({ status: "failed", nextRunAt: new Date() })).toBe(true);
  });

  it("不等待已经成功或不会再重试的终态任务", () => {
    expect(shouldWaitForQZoneAttempt({ status: "succeeded" })).toBe(false);
    expect(shouldWaitForQZoneAttempt({ status: "failed", nextRunAt: null })).toBe(false);
    expect(shouldWaitForQZoneAttempt({ status: "skipped" })).toBe(false);
  });
});
