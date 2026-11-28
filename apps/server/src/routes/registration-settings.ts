import type { FastifyInstance } from "fastify";
import type { CampuxConfig } from "@campux/config";
import { z } from "zod";
import { requireTenantRole } from "../lib/auth";
import { writeAuditLog } from "../lib/audit";
import { prisma } from "../lib/prisma";
import {
  COMMON_EMAIL_SUFFIXES,
  COMMON_WILDCARD_DOMAINS,
  MAX_ALLOWED_SUFFIXES,
  normalizeAllowedSuffixes,
  normalizeRegistrationEmailPolicy,
  readRegistrationEmailPolicy,
  registrationEmailPolicyKey,
  type RegistrationEmailPolicy,
} from "../lib/registration-email-policy";
import {
  buildMailTestMessage,
  maskMailSenderConfig,
  normalizeMailSenderConfig,
  officialMailerAvailable,
  readTenantMailSenderConfig,
  resolveEffectiveFromEmail,
  restoreMaskedSmtpPass,
  sendTenantMail,
  tenantMailSenderKey,
  validateMailSenderConfig,
  type TenantMailSenderConfig,
} from "../lib/tenant-mail-sender";

/**
 * 注册与邮箱验证配置。
 *
 * 两条硬规则（运营者要求的）：
 * 1. 开启邮箱验证时，发件配置必须完整可用，否则不允许保存；
 * 2. 修改发件配置后要先发一封测试邮件成功，才能保存。
 *
 * 第 2 条用一个短期「已验证」凭据实现：测试成功时把配置摘要记进内存，
 * 保存时要求提交的配置摘要与之匹配。重启后失效（重新测一次即可），
 * 这样不需要为它建表。
 */

const TEST_TTL_MS = 10 * 60 * 1000;

/** 保存时发现策略已被其他管理员并发修改：中止本次写入，让运营者刷新后重试。 */
class RegistrationSettingsConflictError extends Error {}

type VerifiedMailSender = { fingerprint: string; verifiedAt: number };
const verifiedMailSenderByTenant = new Map<string, VerifiedMailSender>();

/** 用发件配置的关键字段算摘要：任一字段变了就必须重新测试。 */
/**
 * 发件配置指纹：用长度前缀编码，避免字段内容里的分隔符造成「不同配置同指纹」。
 */
function mailSenderFingerprint(sender: TenantMailSenderConfig): string {
  const fields = [
    sender.mode,
    sender.smtpHost,
    String(sender.smtpPort),
    sender.smtpUser,
    sender.smtpPass,
    sender.fromEmail,
    sender.fromName,
  ];
  return fields.map((f) => `${f.length}:${f}`).join("|");
}

export function __resetMailSenderVerificationForTests() {
  verifiedMailSenderByTenant.clear();
}

const suffixSchema = z.string().trim().max(80);

const patchSettingsSchema = z.object({
  emailPolicy: z.object({
    required: z.boolean(),
    allowedSuffixes: z.array(suffixSchema).max(MAX_ALLOWED_SUFFIXES).optional(),
  }),
  mailSender: z.object({
    mode: z.enum(["official", "smtp"]),
    smtpHost: z.string().trim().max(255).optional(),
    smtpPort: z.number().int().min(1).max(65535).optional(),
    smtpUser: z.string().trim().max(255).optional(),
    smtpPass: z.string().max(255).optional(),
    fromEmail: z.string().trim().max(255).optional(),
    fromName: z.string().trim().max(80).optional(),
  }),
});

const testSchema = z.object({
  to: z.string().trim().email("请输入正确的收件邮箱").max(255),
  // 测试时允许不入库：前端把当前表单值直接发来验证。
  mailSender: patchSettingsSchema.shape.mailSender,
});

export function registerRegistrationSettingsRoutes(app: FastifyInstance, config: CampuxConfig) {
  /** 读取当前配置（含常用后缀清单，供管理端渲染多选）。 */
  app.get("/api/admin/registration-settings", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    const [policy, sender] = await Promise.all([
      readRegistrationEmailPolicy(prisma, context.selectedTenant.id),
      readTenantMailSenderConfig(prisma, context.selectedTenant.id),
    ]);
    return {
      emailPolicy: policy,
      mailSender: maskMailSenderConfig(sender),
      commonSuffixes: [...COMMON_EMAIL_SUFFIXES],
      commonWildcardDomains: [...COMMON_WILDCARD_DOMAINS],
      officialMailerAvailable: officialMailerAvailable(config),
      /** 官方发件模式下的实际发件地址，展示给运营者。 */
      officialFromEmail: config.resend.fromEmail,
      effectiveFromEmail: resolveEffectiveFromEmail(sender, config),
      maxAllowedSuffixes: MAX_ALLOWED_SUFFIXES,
    };
  });

  /** 发送测试邮件（不入库）。 */
  app.post("/api/admin/registration-settings/test-mail", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    const body = testSchema.parse(request.body ?? {});
    const stored = await readTenantMailSenderConfig(prisma, context.selectedTenant.id);

    const submitted = normalizeMailSenderConfig({
      ...body.mailSender,
      // 未提交的字段沿用库中值，避免前端只改一项时其余被清空。
      smtpHost: body.mailSender.smtpHost ?? stored.smtpHost,
      smtpPort: body.mailSender.smtpPort ?? stored.smtpPort,
      smtpUser: body.mailSender.smtpUser ?? stored.smtpUser,
      smtpPass: body.mailSender.smtpPass ?? stored.smtpPass,
      fromEmail: body.mailSender.fromEmail ?? stored.fromEmail,
      fromName: body.mailSender.fromName ?? stored.fromName,
    });
    const restored = restoreMaskedSmtpPass(submitted, stored);
    if (!restored.ok) {
      return reply.code(400).send({ message: restored.message });
    }
    const sender = restored.config;

    const staticCheck = validateMailSenderConfig(sender, config);
    if (!staticCheck.ok) {
      return reply.code(400).send({ message: staticCheck.problems.join("；") });
    }

    const message = buildMailTestMessage(context.selectedTenant.name);
    const result = await sendTenantMail({ sender, config, to: body.to, ...message });
    if (!result.ok) {
      return reply.code(502).send({ message: `测试邮件发送失败：${result.error}` });
    }

    verifiedMailSenderByTenant.set(context.selectedTenant.id, {
      fingerprint: mailSenderFingerprint(sender),
      verifiedAt: Date.now(),
    });

    return { ok: true, message: `测试邮件已发送到 ${body.to}` };
  });

  /** 保存配置。开启邮箱验证时要求发件配置已验证通过。 */
  app.patch("/api/admin/registration-settings", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    const body = patchSettingsSchema.parse(request.body ?? {});
    const tenantId = context.selectedTenant.id;

    const stored = await readTenantMailSenderConfig(prisma, tenantId);
    // 同时取出 updatedAt：未提交后缀时要靠它做条件更新，避免覆盖其他管理员的并发修改。
    const storedPolicyRow = await prisma.tenantMetadata.findUnique({
      where: { tenantId_key: { tenantId, key: registrationEmailPolicyKey } },
      select: { value: true, updatedAt: true },
    });
    const storedPolicy = normalizeRegistrationEmailPolicy(storedPolicyRow?.value);
    const submittedSender = normalizeMailSenderConfig({
      ...body.mailSender,
      smtpHost: body.mailSender.smtpHost ?? stored.smtpHost,
      smtpPort: body.mailSender.smtpPort ?? stored.smtpPort,
      smtpUser: body.mailSender.smtpUser ?? stored.smtpUser,
      smtpPass: body.mailSender.smtpPass ?? stored.smtpPass,
      fromEmail: body.mailSender.fromEmail ?? stored.fromEmail,
      fromName: body.mailSender.fromName ?? stored.fromName,
    });
    const restored = restoreMaskedSmtpPass(submittedSender, stored);
    if (!restored.ok) {
      return reply.code(400).send({ message: restored.message });
    }
    const sender = restored.config;

    // 未提交该字段 = 保持原样；显式提交空数组 = 清空（改为不限制）。
    // 不能写成 `?? []`：那样「只改 required」的请求会把已有白名单悄悄清空。
    const submittedSuffixes = body.emailPolicy.allowedSuffixes;
    const normalizedSuffixes = submittedSuffixes === undefined
      ? storedPolicy.allowedSuffixes
      : normalizeAllowedSuffixes(submittedSuffixes);
    // 显式提交了后缀但全部非法时，规范化会得到空数组（= 不限制），
    // 那等于把「配错」悄悄变成「放开所有域名」。这里拒绝并指出具体条目。
    if (submittedSuffixes && submittedSuffixes.length > 0 && normalizedSuffixes.length === 0) {
      return reply.code(400).send({
        message: `邮箱后缀格式不正确：${submittedSuffixes.join("、")}。请填写形如 qq.com 的后缀，或清空列表表示不限制。`,
        code: "INVALID_EMAIL_SUFFIX",
      });
    }
    const nextPolicy: RegistrationEmailPolicy = normalizeRegistrationEmailPolicy({
      required: body.emailPolicy.required,
      allowedSuffixes: normalizedSuffixes,
    });

    // 规则 1：开启邮箱验证必须有可用的发件配置。
    // 规则 2：**发件配置变化**时必须先测试通过——即使邮箱验证是关的。
    // 因为该配置还会被「游客注册」「账号绑定」使用，存进一份没验证过的配置，
    // 等于让这些流程在无人察觉时全部发不出信。
    // 仅调整注册策略（后缀等）而发件配置没动时不必重测，否则每改一次后缀都要再发一封信。
    const senderChanged = mailSenderFingerprint(sender) !== mailSenderFingerprint(stored);
    const staticCheck = validateMailSenderConfig(sender, config);

    // 发件配置一旦被改动，就必须是完整可用的——即使邮箱验证当前是关的。
    // 这份配置仍被「游客注册」「账号绑定」使用，存进半残配置会让它们静默失败。
    if (senderChanged && !staticCheck.ok) {
      return reply.code(400).send({
        message: `发件配置不完整：${staticCheck.problems.join("；")}`,
        code: "MAIL_SENDER_INCOMPLETE",
      });
    }
    if (senderChanged) {
      const verified = verifiedMailSenderByTenant.get(tenantId);
      const fingerprint = mailSenderFingerprint(sender);
      const stillValid = verified
        && verified.fingerprint === fingerprint
        && Date.now() - verified.verifiedAt <= TEST_TTL_MS;
      if (!stillValid) {
        return reply.code(400).send({
          message: "发件配置尚未验证：请先发送一封测试邮件并确认收到，再保存",
          code: "MAIL_SENDER_UNVERIFIED",
        });
      }
    } else if (nextPolicy.required && !staticCheck.ok) {
      // 策略要求邮箱验证、但（未改动的）历史配置本身不完整：同样拒绝。
      return reply.code(400).send({
        message: `开启邮箱验证前请先配置好发件服务：${staticCheck.problems.join("；")}`,
        code: "MAIL_SENDER_INCOMPLETE",
      });
    }

    try {
      await prisma.$transaction(async (transaction) => {
        if (submittedSuffixes === undefined) {
          // 未提交后缀 = 沿用落库值。用读取时的 updatedAt 做条件更新：
          // 若期间其他管理员改过后缀，本次保存拒绝而不是悄悄覆盖对方的新值。
          if (storedPolicyRow) {
            const policyUpdated = await transaction.tenantMetadata.updateMany({
              where: { tenantId, key: registrationEmailPolicyKey, updatedAt: storedPolicyRow.updatedAt },
              data: { value: nextPolicy },
            });
            if (policyUpdated.count === 0) {
              throw new RegistrationSettingsConflictError();
            }
          } else {
            try {
              await transaction.tenantMetadata.create({
                data: { tenantId, key: registrationEmailPolicyKey, value: nextPolicy },
              });
            } catch (error) {
              // 两个“首次保存”并发时，后到的 create 会撞唯一键：按并发冲突返回，而不是 500。
              if ((error as { code?: string }).code === "P2002") {
                throw new RegistrationSettingsConflictError();
              }
              throw error;
            }
          }
        } else {
          await transaction.tenantMetadata.upsert({
            where: { tenantId_key: { tenantId, key: registrationEmailPolicyKey } },
            update: { value: nextPolicy },
            create: { tenantId, key: registrationEmailPolicyKey, value: nextPolicy },
          });
        }
        await transaction.tenantMetadata.upsert({
          where: { tenantId_key: { tenantId, key: tenantMailSenderKey } },
          update: { value: sender },
          create: { tenantId, key: tenantMailSenderKey, value: sender },
        });
        // 审计与配置同事务：避免「配置已改、审计没记」。
        await writeAuditLog({
          tenantId,
          actorId: context.user.id,
          action: "tenant.registration_settings.update",
          targetType: "tenant",
          targetId: tenantId,
          detail: {
            emailVerificationRequired: nextPolicy.required,
            allowedSuffixes: nextPolicy.allowedSuffixes,
            mailMode: sender.mode,
            // 不记录授权码明文。
            smtpHost: sender.smtpHost,
            fromEmail: sender.fromEmail,
          },
        }, transaction);
      });
    } catch (error) {
      if (error instanceof RegistrationSettingsConflictError) {
        return reply.code(409).send({
          message: "注册配置已被其他管理员修改，请刷新后重试",
          code: "SETTINGS_CONFLICT",
        });
      }
      throw error;
    }

    // 配置变了，之前那次测试不再代表当前配置。
    verifiedMailSenderByTenant.delete(tenantId);

    return {
      emailPolicy: nextPolicy,
      mailSender: maskMailSenderConfig(sender),
    };
  });
}
