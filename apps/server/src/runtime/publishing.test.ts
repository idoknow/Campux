import { describe, expect, it } from "bun:test";
import { deriveAggregateStatus, renderOfficialQqForumPostText, republishFailureRetryDelayMs } from "./publishing";

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
  it("将稿件 ID 和非匿名发稿人放在首行，内容从下一行开始", () => {
    expect(renderOfficialQqForumPostText({
      postId: 10,
      text: "1111测试",
      anonymous: false,
      authorQq: "2069528060",
    })).toBe("#10 2069528060\n1111测试");
  });

  it("匿名稿在首行明确显示匿名", () => {
    expect(renderOfficialQqForumPostText({
      postId: 10,
      text: "1111测试",
      anonymous: true,
      authorQq: "2069528060",
    })).toBe("#10 匿名\n1111测试");
  });
});
