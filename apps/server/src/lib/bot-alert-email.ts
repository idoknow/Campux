import nodemailer from "nodemailer";

export type BotAlertEmailConfig = {
  enabled: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
  fromEmail: string;
  toEmails: string[];
};

export async function sendBotAlertEmail(
  config: BotAlertEmailConfig,
  options: { subject: string; text: string; html: string },
): Promise<{ ok: boolean; error?: string }> {
  if (!config.enabled) {
    return { ok: false, error: "插件未启用" };
  }
  if (!config.smtpHost || !config.fromEmail || config.toEmails.length === 0) {
    return { ok: false, error: "邮件配置不完整" };
  }

  try {
    const secure = config.smtpPort === 465;
    const transporter = nodemailer.createTransport({
      host: config.smtpHost.trim(),
      port: config.smtpPort,
      secure,
      // 587 走 STARTTLS，465 走 SSL
      requireTLS: !secure,
      auth: {
        user: config.smtpUser.trim(),
        pass: config.smtpPass,
      },
      greetingTimeout: 10_000,
      connectionTimeout: 15_000,
      socketTimeout: 30_000,
    });

    // 验证连接
    await transporter.verify();

    await transporter.sendMail({
      // from 必须与认证账号一致，否则部分 SMTP 会拒绝
      from: `"Campux Bot" <${config.fromEmail.trim()}>`,
      to: config.toEmails.map((e) => e.trim()).filter(Boolean),
      subject: options.subject,
      text: options.text,
      html: options.html,
    });

    return { ok: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    // 给出更友好的中文提示
    if (msg.includes("535") || msg.includes("authentication failed") || msg.includes("Invalid login")) {
      return { ok: false, error: "SMTP 认证失败：请检查邮箱账号和密码/授权码（QQ/163 邮箱需使用授权码，不是登录密码）" };
    }
    if (msg.includes("ECONNREFUSED") || msg.includes("ETIMEDOUT") || msg.includes("getaddrinfo")) {
      return { ok: false, error: `无法连接 SMTP 服务器 ${config.smtpHost}:${config.smtpPort}，请检查服务器地址和端口` };
    }
    return { ok: false, error: msg };
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function formatBotAlertEmail(input: {
  tenantName: string;
  botName: string;
  botQqUin: string;
  reason: string;
  error: string;
}): { subject: string; text: string; html: string } {
  const subject = `Campux 校园墙 Bot 异常通知 - ${input.tenantName}`;
  const text = [
    `校园墙：${input.tenantName}`,
    `墙号：${input.botName}（QQ ${input.botQqUin}）`,
    `触发原因：${input.reason}`,
    `错误信息：${input.error}`,
    "",
    "请尽快登录墙号重新扫码或手动刷新 QZone cookies。",
  ].join("\n");
  const html = `
    <h2>Campux Bot 异常通知</h2>
    <table style="border-collapse:collapse">
      <tr><td style="padding:4px 12px;font-weight:bold">校园墙</td><td>${escapeHtml(input.tenantName)}</td></tr>
      <tr><td style="padding:4px 12px;font-weight:bold">墙号</td><td>${escapeHtml(input.botName)}（QQ ${escapeHtml(input.botQqUin)}）</td></tr>
      <tr><td style="padding:4px 12px;font-weight:bold">触发原因</td><td>${escapeHtml(input.reason)}</td></tr>
      <tr><td style="padding:4px 12px;font-weight:bold">错误信息</td><td><pre style="white-space:pre-wrap">${escapeHtml(input.error)}</pre></td></tr>
    </table>
    <p>请尽快登录墙号重新扫码或手动刷新 QZone cookies。</p>
  `;
  return { subject, text, html };
}
