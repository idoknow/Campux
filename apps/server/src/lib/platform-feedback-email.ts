import type { CampuxConfig } from "@campux/config";
import { sendEmail } from "./email";

/**
 * 平台意见（租户管理员 → Campux 开发/运维）的邮件通知。
 *
 * 发件人：与「注册邮箱验证码」完全同一套发信配置 —— 复用 `sendEmail` 与 `config.resend`
 * （`RESEND_API_KEY` / `RESEND_FROM_EMAIL`，默认 `Campux <noreply@campux.top>`），
 * 不另起 SMTP 或独立发件账号，因此收件箱里它和验证码邮件来自同一个发件地址。
 *
 * 收件人：平台运维管理员（system_operator）账号上绑定的 QQ / 邮箱。
 *   1. 优先账号绑定的邮箱（通常是注册时收验证码的地址）；
 *   2. 没有绑定邮箱时用 QQ 邮箱，即 `QQ号@qq.com`。
 * 同一地址只投一次；测试账号（isTestAccount）是 example.com 占位邮箱，跳过以免退信。
 */

export type PlatformFeedbackAdmin = {
  id: string;
  qqUin: bigint;
  email: string | null;
  isTestAccount: boolean;
};

export type PlatformFeedbackRecipient = {
  userId: string;
  address: string;
};

export function resolvePlatformFeedbackRecipients(
  admins: readonly PlatformFeedbackAdmin[],
): PlatformFeedbackRecipient[] {
  const seen = new Set<string>();
  const recipients: PlatformFeedbackRecipient[] = [];
  for (const admin of admins) {
    if (admin.isTestAccount) continue;
    const boundEmail = admin.email?.trim().toLowerCase() ?? "";
    // 没有绑定邮箱时回落到 QQ 邮箱：纯数字 QQ 号 + @qq.com。
    const address = boundEmail || `${admin.qqUin.toString()}@qq.com`;
    if (seen.has(address)) continue;
    seen.add(address);
    recipients.push({ userId: admin.id, address });
  }
  return recipients;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type PlatformFeedbackEmailInput = {
  tenantName: string;
  tenantSlug: string;
  authorName: string;
  authorQqUin: string;
  authorEmail: string | null;
  content: string;
  createdAt: Date;
};

export function formatPlatformFeedbackEmail(input: PlatformFeedbackEmailInput): {
  subject: string;
  text: string;
  html: string;
} {
  const submittedAt = input.createdAt.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
  const subject = `Campux 开发意见 - ${input.tenantName}`;
  const contact = input.authorEmail
    ? `QQ ${input.authorQqUin} / ${input.authorEmail}`
    : `QQ ${input.authorQqUin}`;
  const text = [
    `校园墙：${input.tenantName}（${input.tenantSlug}）`,
    `提交人：${input.authorName}（${contact}）`,
    `提交时间：${submittedAt}`,
    "",
    input.content,
    "",
    "—— 可在 Campux 运维面板「开发意见」查看并跟进。",
  ].join("\n");
  const html = `
    <h2>Campux 开发意见</h2>
    <table style="border-collapse:collapse">
      <tr><td style="padding:4px 12px;font-weight:bold">校园墙</td><td>${escapeHtml(input.tenantName)}（${escapeHtml(input.tenantSlug)}）</td></tr>
      <tr><td style="padding:4px 12px;font-weight:bold">提交人</td><td>${escapeHtml(input.authorName)}（${escapeHtml(contact)}）</td></tr>
      <tr><td style="padding:4px 12px;font-weight:bold">提交时间</td><td>${escapeHtml(submittedAt)}</td></tr>
    </table>
    <pre style="white-space:pre-wrap;font-family:inherit;margin-top:12px">${escapeHtml(input.content)}</pre>
    <p style="color:#64748b">可在 Campux 运维面板「开发意见」查看并跟进。</p>
  `;
  return { subject, text, html };
}

export type PlatformFeedbackNotifyResult = {
  /** 实际投递成功的收件地址。 */
  delivered: string[];
  /** 未配置邮件服务（例如自托管没有 RESEND_API_KEY）时为 true。 */
  skipped: boolean;
  /** 第一条错误信息，便于运维核实漏收原因。 */
  error: string | null;
};

export async function sendPlatformFeedbackNotice(input: {
  config: CampuxConfig;
  recipients: readonly PlatformFeedbackRecipient[];
  email: { subject: string; text: string; html: string };
  send?: typeof sendEmail;
}): Promise<PlatformFeedbackNotifyResult> {
  if (input.recipients.length === 0) {
    return { delivered: [], skipped: false, error: "没有可用的运维管理员收件邮箱" };
  }

  const send = input.send ?? sendEmail;
  const delivered: string[] = [];
  const errors: string[] = [];
  let skipped = false;

  for (const recipient of input.recipients) {
    try {
      const result = await send(input.config, { to: recipient.address, ...input.email });
      if (result.skipped) {
        skipped = true;
      } else {
        delivered.push(recipient.address);
      }
    } catch (error) {
      errors.push(`${recipient.address}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    delivered,
    skipped,
    error: errors.length > 0 ? errors.join("；") : null,
  };
}
