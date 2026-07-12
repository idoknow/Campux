import { describe, expect, test } from "bun:test";

import { buildReviewQueueReminderMessages } from "../runtime/review-queue";
import {
  formatFirstPrivateMessageRegistrationNotice,
  formatPrivateHelp,
  formatPrivatePostBodyStart,
  formatPrivatePostConfirmPrompt,
  formatPrivatePostDraftPrompt,
  formatRegisterAlready,
  formatRegisterExtended,
  formatRegisterSuccess,
  formatReviewQueue,
  formatReviewQueueMessages,
  formatReviewQueueReminder,
  formatReviewQueueReminderMessages,
  type ReviewQueueItem,
} from "./bot-messages";

const loginUrl = "https://wall.campux.top/login";

function expectLoginAndForgotPasswordGuidance(message: string) {
  expect(message).toContain(`登录链接：${loginUrl}`);
  expect(message).toContain("忘记密码时");
  expect(message).toContain("#重置密码");
}

describe("bot registration messages", () => {
  test("new-account notice always includes initial password, login link, and forgotten-password reset instructions", () => {
    const originalRandom = Math.random;
    try {
      for (const stylishEnabled of [false, true]) {
        for (const randomValue of [0, 0.4, 0.8]) {
          Math.random = () => randomValue;
          const message = formatRegisterSuccess("InitPass9", loginUrl, stylishEnabled);

          expect(message).toContain("InitPass9");
          expectLoginAndForgotPasswordGuidance(message);
        }
      }
    } finally {
      Math.random = originalRandom;
    }
  });

  test("existing account extended to this wall gets the login link without a new password", () => {
    const message = formatRegisterExtended(loginUrl, false);

    expect(message).toContain("沿用原账号");
    expectLoginAndForgotPasswordGuidance(message);
  });

  test("explicit registration command for an existing member still gives the login link", () => {
    expectLoginAndForgotPasswordGuidance(formatRegisterAlready(loginUrl, false));
  });

  test("default help explains automatic registration and reserves password reset for forgotten passwords", () => {
    const originalRandom = Math.random;
    try {
      for (const stylishEnabled of [false, true]) {
        for (const randomValue of [0, 0.5, 0.9]) {
          Math.random = () => randomValue;
          const message = formatPrivateHelp(stylishEnabled);

          expect(message).toContain("自动注册");
          expect(message).toContain("忘记密码时");
          expect(message).toContain("#重置密码");
          expect(message).not.toContain("#注册账号");
        }
      }
    } finally {
      Math.random = originalRandom;
    }
  });

  test("first private message only announces registration when access was created", () => {
    expect(formatFirstPrivateMessageRegistrationNotice({ password: "InitPass9", alreadyHadTenantAccess: false }, loginUrl, false))
      .toContain("InitPass9");
    expect(formatFirstPrivateMessageRegistrationNotice({ password: null, alreadyHadTenantAccess: false }, loginUrl, false))
      .toContain("沿用原账号");
    expect(formatFirstPrivateMessageRegistrationNotice({ password: null, alreadyHadTenantAccess: true }, loginUrl, false))
      .toBeNull();
  });
});

describe("bot private post messages", () => {
  test("keeps legacy command copy for non-AI intake", () => {
    const message = formatPrivatePostBodyStart(false, false);

    expect(message).toContain("以下是正文内容");
    expect(message).toContain("#结束");
  });

  test("uses semantic edit-state copy for AI intake", () => {
    const message = formatPrivatePostBodyStart(false, true);

    expect(message).toBe("内容都准备好了吗？接下来你可以继续发图文补充，如果确认没问题，直接告诉我发布即可，也可以随时撤回或取消！");
    expect(message).not.toContain("可以提交/发出去");
    expect(message).not.toContain("以下是正文内容");
  });

  test("uses semantic stylish edit-state copy for AI intake", () => {
    const originalRandom = Math.random;
    try {
      for (const value of [0, 0.3, 0.6, 0.9]) {
        Math.random = () => value;
        const message = formatPrivatePostBodyStart(true, true);

        expect(message).not.toContain("可以提交/发出去");
        expect(message).not.toContain("可以发出去");
        expect(message).not.toContain("可以提交");
      }
    } finally {
      Math.random = originalRandom;
    }
  });

  test("uses semantic draft copy for AI intake", () => {
    const message = formatPrivatePostDraftPrompt(false, true);

    expect(message).toContain("直接说清楚想继续补充、发布、撤回或取消");
    expect(message).not.toContain("可以提交/发出去");
    expect(message).not.toContain("#结束");
  });

  test("uses semantic stylish draft copy for AI intake", () => {
    const originalRandom = Math.random;
    try {
      for (const value of [0, 0.45, 0.9]) {
        Math.random = () => value;
        const message = formatPrivatePostDraftPrompt(true, true);

        expect(message).not.toContain("可以提交/发出去");
        expect(message).not.toContain("可以提交");
        expect(message).not.toContain("发出去即可");
        expect(message).not.toContain("#结束");
      }
    } finally {
      Math.random = originalRandom;
    }
  });

  test("uses semantic confirmation copy for AI intake", () => {
    const message = formatPrivatePostConfirmPrompt("正文", 0, true);

    expect(message).toBe("请确认投稿内容：\n\n正文\n\n检查一下没问题的话，直接跟我说发布就行；要是想取消，也请随时告诉我。");
    expect(message).not.toContain("如果内容无误，就用自然语言告诉我可以发布");
    expect(message).not.toContain("确认提交/可以发布");
    expect(message).not.toContain("#确认");
  });
});

describe("review queue messages", () => {
  const now = new Date("2026-07-05T12:00:00.000Z");
  const item = (overrides: Partial<ReviewQueueItem> = {}): ReviewQueueItem => ({
    displayId: 123,
    authorName: "张三",
    authorQqUin: "10001",
    anonymous: true,
    text: "今天食堂的番茄炒蛋很好吃，想问问大家还有什么推荐窗口",
    imageCount: 2,
    createdAt: new Date("2026-07-05T09:45:00.000Z"),
    ...overrides,
  });

  test("shows empty review queue", () => {
    expect(formatReviewQueue([], now)).toEqual(["当前没有待审核稿件"]);
  });

  test("formats review queue summary without truncating post content", () => {
    const longText = "第一行很长很长很长很长很长很长很长很长很长很长，第二行也必须完整展示，不能被省略或截断。";
    const lines = formatReviewQueue([item({ text: longText })], now, 3);

    expect(lines[0]).toBe("当前待审核队列：4 条");
    expect(lines[1]).toContain("#123 等待 2小时15分");
    expect(lines[1]).toContain("张三(10001)");
    expect(lines[1]).toContain("匿名");
    expect(lines[1]).toContain("图 2");
    expect(lines[1]).toContain(longText);
    expect(lines[1]).not.toContain("...");
    expect(lines).toContain("还有 3 条未展示，请到后台审核页查看完整队列。");
    expect(lines.at(-1)).toBe("操作：#通过 <稿件id> / #拒绝 <理由> <稿件id>");
  });

  test("splits long review queue messages", () => {
    const messages = formatReviewQueueMessages(
      [item({ displayId: 1 }), item({ displayId: 2 }), item({ displayId: 3 })],
      now,
      0,
      90,
    );

    expect(messages.length).toBeGreaterThan(1);
    expect(messages[0]).toContain("（1/");
    expect(messages.join("\n")).toContain("#1");
    expect(messages.join("\n")).toContain("#3");
  });

  test("formats overdue review queue reminder", () => {
    const lines = formatReviewQueueReminder([item({ displayId: 456, anonymous: false, imageCount: 0 })], 6, now);

    expect(lines[0]).toBe("审核队列提醒：有 1 条稿件已等待超过 6 小时，请尽快处理。");
    expect(lines[1]).toContain("#456");
    expect(lines[1]).toContain("实名");
    expect(lines[1]).toContain("无图");
    expect(lines.at(-1)).toBe("操作：#审核队列 查看全部待审核稿件。");
  });

  test("formats hidden overdue reminder count", () => {
    const lines = formatReviewQueueReminder([item()], 6, now, 5);

    expect(lines[0]).toBe("审核队列提醒：有 6 条稿件已等待超过 6 小时，请尽快处理。");
    expect(lines).toContain("还有 5 条未展示，请到后台审核页查看完整队列。");
  });

  test("splits overdue reminder messages", () => {
    const messages = formatReviewQueueReminderMessages(
      [item({ displayId: 1 }), item({ displayId: 2 }), item({ displayId: 3 })],
      6,
      now,
      2,
      100,
    );

    expect(messages.length).toBeGreaterThan(1);
    expect(messages[0]).toContain("审核队列提醒：有 5 条稿件已等待超过 6 小时");
    expect(messages.join("\n")).toContain("还有 2 条未展示，请到后台审核页查看完整队列。");
  });

  test("mentions all only in the first overdue reminder chunk", () => {
    const messages = buildReviewQueueReminderMessages(
      [item({ displayId: 1 }), item({ displayId: 2 }), item({ displayId: 3 })],
      6,
      now,
      2,
      100,
    );

    expect(messages.length).toBeGreaterThan(1);
    expect(messages[0]).toEqual(expect.arrayContaining([{ type: "at", data: { qq: "all" } }]));
    expect(messages.slice(1).every((message) => typeof message === "string")).toBe(true);
  });
});
