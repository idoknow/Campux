import { describe, expect, test } from "bun:test";

import { formatPrivatePostBodyStart } from "./bot-messages";

describe("bot private post messages", () => {
  test("keeps legacy command copy for non-AI intake", () => {
    const message = formatPrivatePostBodyStart(false, false);

    expect(message).toContain("以下是正文内容");
    expect(message).toContain("#结束");
  });

  test("uses edit-state copy for AI intake", () => {
    const message = formatPrivatePostBodyStart(false, true);

    expect(message).toContain("已进入投稿编辑");
    expect(message).toContain("可以提交/发出去");
    expect(message).not.toContain("以下是正文内容");
  });
});
