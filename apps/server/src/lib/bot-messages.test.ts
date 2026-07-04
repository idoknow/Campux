import { describe, expect, test } from "bun:test";

import { formatPrivatePostBodyStart, formatPrivatePostConfirmPrompt, formatPrivatePostDraftPrompt } from "./bot-messages";

describe("bot private post messages", () => {
  test("keeps legacy command copy for non-AI intake", () => {
    const message = formatPrivatePostBodyStart(false, false);

    expect(message).toContain("以下是正文内容");
    expect(message).toContain("#结束");
  });

  test("uses semantic edit-state copy for AI intake", () => {
    const message = formatPrivatePostBodyStart(false, true);

    expect(message).toContain("已进入投稿编辑");
    expect(message).toContain("直接说清楚想继续补充、发布、撤回或取消");
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

    expect(message).toContain("请确认投稿内容");
    expect(message).toContain("如果内容无误，就用自然语言告诉我可以发布");
    expect(message).not.toContain("确认提交/可以发布");
    expect(message).not.toContain("#确认");
  });
});
