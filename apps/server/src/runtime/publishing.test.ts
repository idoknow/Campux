import { describe, expect, it } from "bun:test";
import { deriveAggregateStatus, republishFailureRetryDelayMs } from "./publishing";

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