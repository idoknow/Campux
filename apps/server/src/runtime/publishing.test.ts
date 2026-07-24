import { describe, expect, it } from "bun:test";
import {
  buildQZonePostUrl,
  deriveAggregateStatus,
  getOfficialQqForumQZoneLinkBotAccountId,
  isRecoverableOrphanPublishingPost,
  interruptedPublishAttemptRecoveryData,
  publishTargetIntervalSeconds,
  resolveEarliestPublishDispatchAt,
  shouldSkipBatchPublishFanout,
  renderOfficialQqForumCaption,
  renderOfficialQqForumThreadTitle,
  republishFailureRetryDelayMs,
  serializePublishErrorForLog,
  shouldAutomaticallyRequeueFailedAttempt,
  shouldAppendOfficialQqForumQZoneLink,
  shouldWaitForQZoneAttempt,
} from "./publishing";

describe("publishing recovery and error logging", () => {
  const now = new Date("2026-07-24T00:00:00.000Z").getTime();

  it("fails interrupted attempts without scheduling an ambiguous retry", () => {
    expect(interruptedPublishAttemptRecoveryData()).toEqual({
      status: "failed",
      lastError: "发布进程中断，远端结果不确定；为避免重复发布，系统未自动重试",
      nextRunAt: null,
    });
  });

  it("replays only batch fanouts whose durable completion marker is missing", () => {
    expect(shouldSkipBatchPublishFanout({
      ownerStatus: "publishing",
      flushedAt: null,
      attempts: [{ status: "queued" }],
    })).toBe(false);
    expect(shouldSkipBatchPublishFanout({
      ownerStatus: "publishing",
      flushedAt: new Date(now),
      attempts: [{ status: "queued" }],
    })).toBe(true);
    expect(shouldSkipBatchPublishFanout({
      ownerStatus: "published",
      flushedAt: null,
      attempts: [],
    })).toBe(true);
  });

  it("recovers only stale publishing posts with neither attempts nor a batch", () => {
    const stale = new Date(now - 10 * 60_000);
    expect(isRecoverableOrphanPublishingPost({ updatedAt: stale, publishAttemptCount: 0, batchItemId: null }, now)).toBe(true);
    expect(isRecoverableOrphanPublishingPost({ updatedAt: new Date(now - 60_000), publishAttemptCount: 0, batchItemId: null }, now)).toBe(false);
    expect(isRecoverableOrphanPublishingPost({ updatedAt: stale, publishAttemptCount: 1, batchItemId: null }, now)).toBe(false);
    expect(isRecoverableOrphanPublishingPost({ updatedAt: stale, publishAttemptCount: 0, batchItemId: "batch-item" }, now)).toBe(false);
  });

  it("keeps publish error logs useful while redacting credential-like values", () => {
    const cause = new Error("upstream authorization: Bearer cause-secret");
    cause.stack = "Error: upstream cookie=cause-cookie\n    at upstream";
    const error = new Error("upload failed p_skey=secret-value token: bearer-value", { cause });
    error.stack = "Error: upload failed p_skey=stack-secret\n    at publish";

    const serialized = serializePublishErrorForLog(error);
    expect(serialized.errorName).toBe("Error");
    expect(serialized.errorMessage).toBe("upload failed p_skey=[REDACTED] token: [REDACTED]");
    expect(serialized.errorStack).toBe("Error: upload failed p_skey=[REDACTED]\n    at publish");
    expect(serialized.errorCause).toContain("authorization: [REDACTED]");
    expect(serialized.errorCause).toContain("cookie=[REDACTED]");
    expect(JSON.stringify(serialized)).not.toContain("secret");

    const structured = serializePublishErrorForLog(new Error(
      '{"access_token":"access-secret","client_secret":"client-secret","authorization":"Basic dXNlcjpwYXNz"}',
    ));
    expect(structured.errorMessage).toContain('\"access_token\":\"[REDACTED]\"');
    expect(structured.errorMessage).toContain('\"client_secret\":\"[REDACTED]\"');
    expect(structured.errorMessage).toContain('\"authorization\":\"[REDACTED]\"');
    expect(structured.errorMessage).not.toContain("access-secret");
    expect(structured.errorMessage).not.toContain("client-secret");
    expect(structured.errorMessage).not.toContain("dXNlcjpwYXNz");
  });

  it("redacts cookie lines, custom error names, and encoded credential payloads", () => {
    const cookieError = new Error("Cookie: session=opaque-value; p_skey=cookie-value");
    cookieError.name = "Auth access_token=name-value";
    const cookieLog = serializePublishErrorForLog(cookieError);
    expect(cookieLog.errorName).toBe("Auth access_token=[REDACTED]");
    expect(cookieLog.errorMessage).toBe("Cookie: [REDACTED]");
    expect(JSON.stringify(cookieLog)).not.toContain("opaque-value");
    expect(JSON.stringify(cookieLog)).not.toContain("cookie-value");
    expect(JSON.stringify(cookieLog)).not.toContain("name-value");

    const encodedLog = serializePublishErrorForLog(new Error(
      "payload %7B%22access_token%22%3A%22encoded-value%22%7D",
    ));
    expect(encodedLog.errorMessage).toBe("[REDACTED encoded credential diagnostic]");
    expect(JSON.stringify(encodedLog)).not.toContain("encoded-value");

    const escapedJsonLog = serializePublishErrorForLog(new Error(
      String.raw`upstream {\"access_token\":\"escaped-secret\"}`,
    ));
    expect(escapedJsonLog.errorMessage).toBe("[REDACTED encoded credential diagnostic]");
    expect(JSON.stringify(escapedJsonLog)).not.toContain("escaped-secret");

    const malformedEncodedLog = serializePublishErrorForLog(new Error(
      "payload %70_skey%3Dencoded-secret%ZZ",
    ));
    expect(malformedEncodedLog.errorMessage).toBe("[REDACTED encoded credential diagnostic]");
    expect(JSON.stringify(malformedEncodedLog)).not.toContain("encoded-secret");
  });
});

describe("publishTargetIntervalSeconds", () => {
  it("QQ 官方机器人发布目标也使用配置的风控间隔", () => {
    expect(publishTargetIntervalSeconds({ publishDelaySeconds: 30 })).toBe(30);
  });

  it("未配置时交给调度器使用默认风控间隔", () => {
    expect(publishTargetIntervalSeconds({ publishDelaySeconds: null })).toBeNull();
  });
});

describe("resolveEarliestPublishDispatchAt", () => {
  const now = new Date("2026-07-24T00:00:00.000Z");

  it("allows an already-scheduled attempt immediately when the bot has no recent activity", () => {
    expect(resolveEarliestPublishDispatchAt({ now, intervalSeconds: 30 })).toEqual(now);
  });

  it("defers from persisted bot activity so an overdue backlog cannot burst", () => {
    expect(resolveEarliestPublishDispatchAt({
      now,
      intervalSeconds: 30,
      latestActivityAt: new Date(now.getTime() - 5_000),
    })).toEqual(new Date(now.getTime() + 25_000));
  });

  it("does not add delay when the configured interval is zero", () => {
    expect(resolveEarliestPublishDispatchAt({
      now,
      intervalSeconds: 0,
      latestActivityAt: new Date(now.getTime() - 1_000),
    })).toEqual(now);
  });
});

describe("republish failure timeout", () => {
  it("uses a 12 hour retry delay", () => {
    expect(republishFailureRetryDelayMs).toBe(12 * 60 * 60 * 1000);
  });

  it("never automatically requeues ambiguous or interrupted non-idempotent failures", () => {
    expect(shouldAutomaticallyRequeueFailedAttempt(
      "QZone 发布请求超时（远端可能已接收，为避免重复发布未自动重试）",
    )).toBe(false);
    expect(shouldAutomaticallyRequeueFailedAttempt(
      interruptedPublishAttemptRecoveryData().lastError,
    )).toBe(false);
    expect(shouldAutomaticallyRequeueFailedAttempt("普通可重试发布失败")).toBe(true);
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
  it("频道正文不重复标题里的稿件编号和投稿人", () => {
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
    })).toBe("校园墙\nhttps://example.com/activity\n欢迎互动");
  });

  it("批量单稿片段不再输出标题信息，避免出现重复的 #编号 投稿人", () => {
    expect(renderOfficialQqForumCaption({
      customText: "校园墙",
      suffixText: "欢迎互动",
      includePostId: true,
      includeAuthorMention: true,
      includeLinks: false,
    }, {
      postId: 10,
      text: "1111测试",
      anonymous: false,
      authorQq: "2069528060",
      omitFixedText: true,
    })).toBe("");
  });

  it("频道正文空间链接由独立开关控制并可指定首选 QQ 机器人", () => {
    const template = {
      includeQZoneLink: true,
      qzoneLinkBotAccountId: "bot-1",
    };

    expect(shouldAppendOfficialQqForumQZoneLink(template)).toBe(true);
    expect(getOfficialQqForumQZoneLinkBotAccountId(template)).toBe("bot-1");
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
