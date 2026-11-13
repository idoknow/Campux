import { createHash, randomInt } from "node:crypto";
import type { CampuxConfig } from "@campux/config";

export function normalizeEmail(input: string) {
  return input.trim().toLowerCase();
}

export function generateEmailCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashEmailCode(email: string, code: string) {
  return createHash("sha256").update(`${normalizeEmail(email)}:${code}`).digest("hex");
}

/** Resend 请求的超时上限：避免网络/服务商卡住时把调用方的请求一起拖住。 */
export const EMAIL_REQUEST_TIMEOUT_MS = 10_000;

export async function sendEmail(config: CampuxConfig, options: { to: string; subject: string; html: string; text: string }) {
  if (!config.resend.apiKey) {
    // Without a configured mail provider we cannot deliver the message. Rather
    // than hard-fail (which used to lock self-hosters out of registration when
    // they had no Resend key), we skip sending and let the caller surface the
    // verification code directly in the API response. This keeps email-free
    // self-hosting usable; production deployments that DO want real email just
    // set RESEND_API_KEY.
    return { skipped: true as const };
  }

  let response: Response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.resend.apiKey}`,
        "Content-Type": "application/json",
        "User-Agent": "Campux/1.0",
      },
      body: JSON.stringify({
        from: config.resend.fromEmail,
        to: [options.to],
        subject: options.subject,
        html: options.html,
        text: options.text,
      }),
      signal: AbortSignal.timeout(EMAIL_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      throw new Error(`邮件发送超时（${EMAIL_REQUEST_TIMEOUT_MS / 1000} 秒）`);
    }
    throw error;
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`邮件发送失败：${response.status}${detail ? ` ${detail}` : ""}`);
  }

  return { skipped: false as const };
}

export async function sendVerificationEmail(config: CampuxConfig, options: { to: string; code: string }) {
  return sendEmail(config, {
    to: options.to,
    subject: "Campux 注册验证码",
    html: `<p>你的 Campux 注册验证码是：</p><p style="font-size:24px;font-weight:700;letter-spacing:4px">${options.code}</p><p>验证码 10 分钟内有效。如果不是你本人操作，可以忽略这封邮件。</p>`,
    text: `你的 Campux 注册验证码是：${options.code}\n验证码 10 分钟内有效。如果不是你本人操作，可以忽略这封邮件。`,
  });
}
