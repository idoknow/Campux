import type { Prisma } from "@campux/db";
import type { CampuxConfig } from "@campux/config";
import nodemailer from "nodemailer";
import { prisma } from "./prisma";
import { sendEmail } from "./email";

/**
 * 租户级发件配置。
 *
 * - `official`：走平台自带的官方发件（Resend，`RESEND_API_KEY` + `RESEND_FROM_EMAIL`）。
 *   这是官方托管服务上的默认值，运营着不用自己配 SMTP。
 * - `smtp`：运营者自备 SMTP（QQ 邮箱授权码、163、自建 Postfix 等），适合自托管部署。
 *
 * 凭证处理与「Bot 异常通知」一致：读取方向返回掩码，保存方向若收到掩码则沿用库中原值。
 */
export type MailSenderMode = "official" | "smtp";

export type TenantMailSenderConfig = {
  mode: MailSenderMode;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
  /** 发件人地址；SMTP 模式下通常与 smtpUser 相同。 */
  fromEmail: string;
  fromName: string;
};

export const tenantMailSenderKey = "registration_mail_sender";

export const SMTP_PASS_MASK = "••••••••";

export const tenantMailSenderDefaults: TenantMailSenderConfig = {
  mode: "official",
  smtpHost: "",
  smtpPort: 465,
  smtpUser: "",
  smtpPass: "",
  fromEmail: "",
  fromName: "Campux 校园墙",
};

export function normalizeMailSenderMode(value: unknown): MailSenderMode {
  return value === "smtp" ? "smtp" : "official";
}

export function normalizeMailSenderConfig(value: unknown): TenantMailSenderConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...tenantMailSenderDefaults };
  }
  const record = value as Record<string, unknown>;
  const port = typeof record.smtpPort === "number" ? record.smtpPort : Number(record.smtpPort);
  return {
    mode: normalizeMailSenderMode(record.mode),
    smtpHost: typeof record.smtpHost === "string" ? record.smtpHost.trim().slice(0, 255) : "",
    smtpPort: Number.isInteger(port) && port >= 1 && port <= 65535 ? port : 465,
    smtpUser: typeof record.smtpUser === "string" ? record.smtpUser.trim().slice(0, 255) : "",
    smtpPass: typeof record.smtpPass === "string" ? record.smtpPass.slice(0, 255) : "",
    fromEmail: typeof record.fromEmail === "string" ? record.fromEmail.trim().slice(0, 255) : "",
    fromName: typeof record.fromName === "string" && record.fromName.trim() ? record.fromName.trim().slice(0, 80) : tenantMailSenderDefaults.fromName,
  };
}

export async function readTenantMailSenderConfig(
  client: typeof prisma | Prisma.TransactionClient,
  tenantId: string,
): Promise<TenantMailSenderConfig> {
  const entry = await client.tenantMetadata.findUnique({
    where: { tenantId_key: { tenantId, key: tenantMailSenderKey } },
    select: { value: true },
  });
  return normalizeMailSenderConfig(entry?.value);
}

/** 返回给前端的配置：SMTP 授权码脱敏。 */
export function maskMailSenderConfig(config: TenantMailSenderConfig): TenantMailSenderConfig {
  if (!config.smtpPass) return config;
  return { ...config, smtpPass: SMTP_PASS_MASK };
}

/**
 * 提交保存时：若授权码仍是掩码，且连接信息（host/port/user）没变，就沿用库里的真实值。
 * 连接信息变了却还是掩码 → 拒绝，避免把旧凭据发到新服务器。
 */
export function restoreMaskedSmtpPass(
  submitted: TenantMailSenderConfig,
  stored: TenantMailSenderConfig,
): { ok: true; config: TenantMailSenderConfig } | { ok: false; message: string } {
  if (submitted.smtpPass !== SMTP_PASS_MASK) {
    return { ok: true, config: submitted };
  }
  if (
    submitted.smtpHost !== stored.smtpHost
    || submitted.smtpPort !== stored.smtpPort
    || submitted.smtpUser !== stored.smtpUser
  ) {
    return { ok: false, message: "SMTP 服务器信息已修改，请重新输入 SMTP 授权码" };
  }
  return { ok: true, config: { ...submitted, smtpPass: stored.smtpPass } };
}

/** 官方发件是否可用（平台层配了 Resend）。 */
export function officialMailerAvailable(config: CampuxConfig): boolean {
  return Boolean(config.resend.apiKey);
}

/** 当前生效的发件人地址（用于界面展示与预校验）。 */
export function resolveEffectiveFromEmail(sender: TenantMailSenderConfig, config: CampuxConfig): string {
  return sender.mode === "official" ? config.resend.fromEmail : sender.fromEmail;
}

export type MailSendResult = { ok: true } | { ok: false; error: string };

/**
 * 校验当前配置是否「可发信」——只做静态检查，不连服务器。
 * UI 用它给出「未配置好不让保存」的即时反馈。
 */
export function validateMailSenderConfig(
  sender: TenantMailSenderConfig,
  config: CampuxConfig,
): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  if (sender.mode === "official") {
    if (!officialMailerAvailable(config)) {
      problems.push("官方发件未启用：本实例没有配置 RESEND_API_KEY，请改用自定义 SMTP");
    }
  } else {
    if (!sender.smtpHost) problems.push("请填写 SMTP 服务器地址");
    if (!sender.smtpUser) problems.push("请填写 SMTP 账号");
    if (!sender.smtpPass) problems.push("请填写 SMTP 密码/授权码");
    if (!sender.fromEmail) problems.push("请填写发件人邮箱");
    else if (!/^[^\s@]+@[^\s@]+$/.test(sender.fromEmail)) problems.push("发件人邮箱格式不正确");
  }
  return { ok: problems.length === 0, problems };
}

/**
 * 真正发一封信（注册验证码、测试邮件、密码重置都走这里）。
 * 官方模式复用 `sendEmail`（Resend）；SMTP 模式走 nodemailer。
 */
export async function sendTenantMail(
  options: {
    sender: TenantMailSenderConfig;
    config: CampuxConfig;
    to: string;
    subject: string;
    html: string;
    text: string;
  },
): Promise<MailSendResult> {
  const { sender, config } = options;

  if (sender.mode === "official") {
    if (!officialMailerAvailable(config)) {
      return { ok: false, error: "本实例未配置官方发件（RESEND_API_KEY），请在「注册与邮箱验证」里改用自定义 SMTP" };
    }
    try {
      const result = await sendEmail(config, {
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
      });
      if (result.skipped) {
        return { ok: false, error: "官方发件未启用（未配置 RESEND_API_KEY）" };
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  const problems = validateMailSenderConfig(sender, config).problems;
  if (problems.length > 0) {
    return { ok: false, error: problems.join("；") };
  }

  try {
    const secure = sender.smtpPort === 465;
    const transporter = nodemailer.createTransport({
      host: sender.smtpHost,
      port: sender.smtpPort,
      secure,
      // 465 走隐式 TLS；587/25 等端口在服务器公告 STARTTLS 时自动升级。
      // 不设 `requireTLS: true`：对端不公告 STARTTLS 的自建 MTA 会一直等到超时。
      requireTLS: false,
      auth: { user: sender.smtpUser, pass: sender.smtpPass },
      greetingTimeout: 10_000,
      connectionTimeout: 15_000,
      socketTimeout: 30_000,
    });
    await transporter.verify();
    await transporter.sendMail({
      from: `"${sender.fromName}" <${sender.fromEmail}>`,
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
    });
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("535") || message.includes("authentication failed") || message.includes("Invalid login")) {
      return { ok: false, error: "SMTP 认证失败：请检查账号与密码/授权码（QQ/163 邮箱需使用授权码，不是登录密码）" };
    }
    if (message.includes("ECONNREFUSED") || message.includes("ETIMEDOUT") || message.includes("getaddrinfo")) {
      return { ok: false, error: `无法连接 SMTP 服务器 ${sender.smtpHost}:${sender.smtpPort}` };
    }
    return { ok: false, error: message };
  }
}

/** 测试邮件正文。 */
export function buildMailTestMessage(tenantName: string) {
  const subject = `Campux 发件测试 - ${tenantName}`;
  const text = `这是一封来自「${tenantName}」的 Campux 发件配置测试邮件。\n收到这封邮件说明当前发件配置可用，可以保存注册邮箱验证设置。`;
  const html = `<p>这是一封来自「${tenantName}」的 <b>Campux 发件配置测试邮件</b>。</p><p>收到这封邮件说明当前发件配置可用，可以保存注册邮箱验证设置。</p>`;
  return { subject, text, html };
}
