import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireReadyTenant } from "../lib/auth";
import { prisma } from "../lib/prisma";
import { sendBotAlertEmail } from "../lib/bot-alert-email";
import { readTenantPluginConfig, BOT_ALERT_PASS_MASK } from "../lib/tenant-plugin-config";

const testEmailSchema = z.object({
  smtpHost: z.string().min(1),
  smtpPort: z.number().int().min(1).max(65535),
  smtpUser: z.string().min(1),
  smtpPass: z.string().min(1),
  fromEmail: z.string().min(1),
  toEmails: z.array(z.string().min(1)).min(1).max(20),
});

export function registerBotAlertTestRoutes(app: FastifyInstance) {
  app.post("/api/admin/plugins/bot-alert/test", async (request, reply) => {
    const context = await requireReadyTenant(request, reply, "admin");
    const body = testEmailSchema.parse(request.body);

    // GET/PATCH 响应里的 smtpPass 是掩码占位符；若提交值仍是掩码，说明管理员未改动，
    // 用库中保存的真实密码替换，避免把掩码字符串当凭证发送。
    let smtpPass = body.smtpPass;
    if (smtpPass === BOT_ALERT_PASS_MASK) {
      const stored = await readTenantPluginConfig(prisma, context.selectedTenant.id);
      // 掩码密码只允许配对已保存的 SMTP 连接信息；请求改了 host/port/user 时拒绝，
      // 避免把已存储的授权码发送到别的服务器。
      if (
        body.smtpHost !== stored.botAlert.smtpHost ||
        body.smtpPort !== stored.botAlert.smtpPort ||
        body.smtpUser !== stored.botAlert.smtpUser
      ) {
        return reply.code(400).send({ message: "SMTP 服务器信息与已保存配置不一致，请输入新的 SMTP 授权码" });
      }
      smtpPass = stored.botAlert.smtpPass;
    }

    const result = await sendBotAlertEmail(
      { ...body, smtpPass, enabled: true },
      {
        subject: "测试",
        text: "这是一封 Campux Bot 异常通知测试邮件。收到此邮件说明 SMTP 配置正确。",
        html: "<p>这是一封 <b>Campux Bot 异常通知</b>测试邮件。</p><p>收到此邮件说明 SMTP 配置正确。</p>",
      },
    );

    if (!result.ok) {
      return reply.code(502).send({ message: `发送失败：${result.error ?? "未知错误"}` });
    }

    return { ok: true, message: "测试邮件已发送" };
  });
}
