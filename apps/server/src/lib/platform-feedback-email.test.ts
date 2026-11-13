import { describe, expect, test } from "bun:test";
import type { CampuxConfig } from "@campux/config";
import {
  formatPlatformFeedbackEmail,
  resolvePlatformFeedbackRecipients,
  sendPlatformFeedbackNotice,
} from "./platform-feedback-email";

const baseEmail = {
  tenantName: "广府校园墙",
  tenantSlug: "canton-wall",
  authorName: "墙主",
  authorQqUin: "1623746337",
  authorEmail: null,
  content: "希望支持按标签批量撤回。",
  createdAt: new Date("2026-11-13T13:48:00.000Z"),
};

const config = { resend: { apiKey: "", fromEmail: "Campux <noreply@campux.top>" } } as unknown as CampuxConfig;

describe("resolvePlatformFeedbackRecipients", () => {
  test("优先用账号绑定的邮箱，没有邮箱时用 QQ 号@qq.com", () => {
    const recipients = resolvePlatformFeedbackRecipients([
      { id: "a", qqUin: 123456n, email: "ops@campux.top", isTestAccount: false },
      { id: "b", qqUin: 81785916562976880n, email: null, isTestAccount: false },
    ]);
    expect(recipients).toEqual([
      { userId: "a", address: "ops@campux.top" },
      { userId: "b", address: "81785916562976880@qq.com" },
    ]);
  });

  test("空白邮箱按未绑定处理，回落到 QQ 邮箱", () => {
    const recipients = resolvePlatformFeedbackRecipients([
      { id: "blank", qqUin: 1623746337n, email: "   ", isTestAccount: false },
    ]);
    expect(recipients).toEqual([{ userId: "blank", address: "1623746337@qq.com" }]);
  });

  test("跳过测试账号，避免 example.com 退信", () => {
    const recipients = resolvePlatformFeedbackRecipients([
      { id: "seed", qqUin: 40000n, email: "operator@example.com", isTestAccount: true },
      { id: "real", qqUin: 1623746337n, email: null, isTestAccount: false },
    ]);
    expect(recipients).toEqual([{ userId: "real", address: "1623746337@qq.com" }]);
  });

  test("同一地址只投递一次", () => {
    const recipients = resolvePlatformFeedbackRecipients([
      { id: "a", qqUin: 1n, email: "Ops@Campux.top", isTestAccount: false },
      { id: "b", qqUin: 2n, email: "ops@campux.top", isTestAccount: false },
    ]);
    expect(recipients).toEqual([{ userId: "a", address: "ops@campux.top" }]);
  });
});

describe("formatPlatformFeedbackEmail", () => {
  test("标题与正文包含校园墙、提交人与意见内容", () => {
    const email = formatPlatformFeedbackEmail(baseEmail);
    expect(email.subject).toBe("Campux 开发意见 - 广府校园墙");
    expect(email.text).toContain("广府校园墙（canton-wall）");
    expect(email.text).toContain("QQ 1623746337");
    expect(email.text).toContain("希望支持按标签批量撤回。");
    expect(email.text).toContain("运维面板「开发意见」");
  });

  test("意见内容与提交人信息做 HTML 转义", () => {
    const email = formatPlatformFeedbackEmail({
      ...baseEmail,
      authorName: "<b>墙主</b>",
      content: "<script>alert(1)</script>",
    });
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
    expect(email.html).toContain("&lt;b&gt;墙主&lt;/b&gt;");
  });
});

describe("sendPlatformFeedbackNotice", () => {
  const email = formatPlatformFeedbackEmail(baseEmail);

  test("没有收件人时返回明确错误，而不是静默成功", async () => {
    const result = await sendPlatformFeedbackNotice({ config, recipients: [], email });
    expect(result.delivered).toEqual([]);
    expect(result.error).toContain("没有可用的运维管理员收件邮箱");
  });

  test("用注册验证码同一套发件配置发送（Resend + RESEND_FROM_EMAIL）", async () => {
    let usedConfig: unknown = null;
    const result = await sendPlatformFeedbackNotice({
      config,
      recipients: [{ userId: "a", address: "ops@campux.top" }],
      email,
      send: async (passedConfig) => {
        usedConfig = passedConfig;
        return { skipped: false as const };
      },
    });
    expect(result.delivered).toEqual(["ops@campux.top"]);
    expect(usedConfig).toBe(config);
    expect((usedConfig as CampuxConfig).resend.fromEmail).toBe("Campux <noreply@campux.top>");
  });

  test("未配置邮件服务时标记 skipped", async () => {
    const result = await sendPlatformFeedbackNotice({
      config,
      recipients: [{ userId: "a", address: "ops@campux.top" }],
      email,
      send: async () => ({ skipped: true as const }),
    });
    expect(result).toEqual({ delivered: [], skipped: true, error: null });
  });

  test("单个收件人失败不影响其他人，失败原因被记录", async () => {
    const result = await sendPlatformFeedbackNotice({
      config,
      recipients: [
        { userId: "a", address: "bad@campux.top" },
        { userId: "b", address: "ops@campux.top" },
      ],
      email,
      send: async (_config, options) => {
        if (options.to === "bad@campux.top") throw new Error("邮件发送失败：422");
        return { skipped: false as const };
      },
    });
    expect(result.delivered).toEqual(["ops@campux.top"]);
    expect(result.error).toContain("bad@campux.top");
    expect(result.error).toContain("422");
  });

  test("默认发送路径真的调用 Resend，并沿用注册验证码的发件人", async () => {
    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; init: RequestInit }> = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ id: "email-1" }), { status: 200 });
    }) as unknown as typeof fetch;

    try {
      const result = await sendPlatformFeedbackNotice({
        config: { resend: { apiKey: "re_test", fromEmail: "Campux <noreply@campux.top>" } } as unknown as CampuxConfig,
        recipients: [{ userId: "a", address: "ops@campux.top" }],
        email,
      });
      expect(result).toEqual({ delivered: ["ops@campux.top"], skipped: false, error: null });
      expect(calls).toHaveLength(1);
      expect(calls[0]!.url).toBe("https://api.resend.com/emails");
      const body = JSON.parse(String(calls[0]!.init.body)) as { from: string; to: string[]; subject: string };
      expect(body.from).toBe("Campux <noreply@campux.top>");
      expect(body.to).toEqual(["ops@campux.top"]);
      expect(body.subject).toBe("Campux 开发意见 - 广府校园墙");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("默认发送路径在未配置 API key 时跳过，不发起请求", async () => {
    const originalFetch = globalThis.fetch;
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    try {
      const result = await sendPlatformFeedbackNotice({
        config,
        recipients: [{ userId: "a", address: "ops@campux.top" }],
        email,
      });
      expect(result).toEqual({ delivered: [], skipped: true, error: null });
      expect(called).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
