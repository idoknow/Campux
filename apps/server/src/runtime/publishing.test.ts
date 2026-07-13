import { describe, expect, it } from "bun:test";
import {
  buildQZonePostUrl,
  deriveAggregateStatus,
  renderOfficialQqForumPostText,
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

describe("renderOfficialQqForumPostText", () => {
  it("将非匿名发稿人、内容和对应的 QQ 空间链接依次放入正文", () => {
    expect(renderOfficialQqForumPostText({
      postId: 10,
      text: "1111测试",
      anonymous: false,
      authorQq: "2069528060",
      qzoneUrls: ["https://user.qzone.qq.com/123/mood/abc"],
    })).toBe("2069528060\n1111测试\nhttps://user.qzone.qq.com/123/mood/abc");
  });

  it("匿名稿不泄露 QQ，并在没有 tid 时省略链接", () => {
    expect(renderOfficialQqForumPostText({
      postId: 10,
      text: "1111测试",
      anonymous: true,
      authorQq: "2069528060",
    })).toBe("匿名\n1111测试");
  });
});

describe("renderOfficialQqForumThreadTitle", () => {
  it("将稿件 ID 和 AI 总结放入单稿标题", () => {
    expect(renderOfficialQqForumThreadTitle([{ postId: 10, summary: "校园里的夏日碎片" }]))
      .toBe("#10 校园里的夏日碎片");
  });

  it("没有总结时只显示稿件 ID", () => {
    expect(renderOfficialQqForumThreadTitle([{ postId: 10, summary: "  " }])).toBe("#10");
  });

  it("批量稿件保留批量标题，避免把首稿总结误标成整批总结", () => {
    expect(renderOfficialQqForumThreadTitle([
      { postId: 10, summary: "第一条总结" },
      { postId: 11, summary: "第二条总结" },
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
