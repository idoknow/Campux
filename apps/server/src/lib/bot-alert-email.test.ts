import { describe, expect, test } from "bun:test";
import { formatBotAlertEmail } from "./bot-alert-email";

const base = {
  tenantName: "中山中学校园墙",
  botName: "墙号 A",
  botQqUin: "459447320",
  reason: "QZone 登录态失效",
  error: "cookies expired",
};

describe("formatBotAlertEmail", () => {
  test("默认建议是重新扫码 / 刷新 cookies", () => {
    const email = formatBotAlertEmail(base);
    expect(email.text).toContain("请尽快登录墙号重新扫码或手动刷新 QZone cookies。");
    expect(email.html).toContain("请尽快登录墙号重新扫码或手动刷新 QZone cookies。");
  });

  test("连接断开时使用自定义处理建议，不再误导去扫码", () => {
    const hint = "请检查 NapCat / QQ 进程是否存活。";
    const email = formatBotAlertEmail({ ...base, reason: "Bot 连接断开", hint });
    expect(email.text).toContain(hint);
    expect(email.html).toContain(hint);
    expect(email.text).not.toContain("刷新 QZone cookies");
    expect(email.html).not.toContain("刷新 QZone cookies");
  });

  test("自定义建议做 HTML 转义", () => {
    const email = formatBotAlertEmail({ ...base, hint: "<script>alert(1)</script>" });
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
  });

  test("标题带校园墙名", () => {
    expect(formatBotAlertEmail(base).subject).toBe("Campux 校园墙 Bot 异常通知 - 中山中学校园墙");
  });
});
