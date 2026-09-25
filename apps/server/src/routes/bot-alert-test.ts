import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireReadyTenant } from "../lib/auth";
import { sendBotAlertEmail } from "../lib/bot-alert-email";

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

    const result = await sendBotAlertEmail(
      { ...body, enabled: true },
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
