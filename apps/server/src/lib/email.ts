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

export async function sendVerificationEmail(config: CampuxConfig, options: { to: string; code: string }) {
  if (!config.resend.apiKey) {
    if (config.nodeEnv === "development") {
      return { skipped: true as const };
    }
    throw new Error("RESEND_API_KEY 未配置，无法发送验证码邮件");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.resend.apiKey}`,
      "Content-Type": "application/json",
      "User-Agent": "Campux/1.0",
    },
    body: JSON.stringify({
      from: config.resend.fromEmail,
      to: [options.to],
      subject: "Campux 注册验证码",
      html: `<p>你的 Campux 注册验证码是：</p><p style="font-size:24px;font-weight:700;letter-spacing:4px">${options.code}</p><p>验证码 10 分钟内有效。如果不是你本人操作，可以忽略这封邮件。</p>`,
      text: `你的 Campux 注册验证码是：${options.code}\n验证码 10 分钟内有效。如果不是你本人操作，可以忽略这封邮件。`,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`验证码邮件发送失败：${response.status}${detail ? ` ${detail}` : ""}`);
  }

  return { skipped: false as const };
}
