import type { FastifyInstance } from "fastify";
import { hashPassword, Prisma } from "@campux/db";
import { randomInt } from "node:crypto";
import { z } from "zod";
import { createSession, setSessionCookie } from "../lib/auth";
import { writeAuditLog } from "../lib/audit";
import { prisma } from "../lib/prisma";
import { normalizeTenantHost, requestHostCandidates } from "../lib/tenant-host";
import {
  DEPLOY_MODE_KEY,
  SETUP_COMPLETED_KEY,
  MANAGEMENT_HOST_KEY,
  getDeployMode,
  needsSetup,
  slugFromWallName,
} from "../lib/deploy-mode";
import { toPublicUser } from "../lib/serializers";

const setupInitSchema = z.object({
  // 部署模式：single = 自用单墙（推荐），multi = 多租户运营平台。
  deployMode: z.enum(["single", "multi"]),
  // 管理员账号信息。邮箱在单墙模式可选（不强依赖邮件服务）。
  email: z.string().email().optional(),
  displayName: z.string().trim().min(1, "账户名称不能为空").max(80, "账户名称最多 80 个字符"),
  password: z.string().min(6, "密码至少 6 位").max(128),
  // 单墙模式下顺带创建唯一校园墙。
  wallName: z.string().trim().min(1).max(80).optional(),
});

const defaultPostRules = [
  "不发布隐私信息、辱骂、人身攻击和未经确认的指控。",
  "寻物招领请写清地点、时间和联系方式。",
  "图片最多 9 张，审核通过后会同步到本校启用的 QQ 墙号。",
];

const defaultServices = [
  { title: "修改名称", description: "账户资料" },
  { title: "修改密码", description: "账号服务" },
  { title: "投稿规则", description: "查看本墙规范" },
  { title: "校园服务", description: "推荐入口" },
];

async function generateSyntheticQqUin(tx: Prisma.TransactionClient) {
  for (let index = 0; index < 10; index += 1) {
    const candidate = BigInt(`8${Date.now()}${randomInt(100, 999)}`);
    const existing = await tx.user.findUnique({ where: { qqUin: candidate }, select: { id: true } });
    if (!existing) {
      return candidate;
    }
  }
  throw new Error("无法生成账号编号，请重试");
}

function slugForWall(name: string) {
  return slugFromWallName(name, randomInt(1000, 9999));
}

export function registerSetupRoutes(app: FastifyInstance) {
  // Public: the frontend polls this on boot to decide whether to show the
  // first-run setup wizard instead of the login screen.
  app.get("/api/setup/status", async () => {
    const pending = await needsSetup();
    return {
      needsSetup: pending,
      deployMode: pending ? null : await getDeployMode(),
    };
  });

  // Public BUT single-shot: creates the very first system operator and chooses
  // the deployment mode. Hard-guarded by needsSetup() so it cannot be replayed
  // to mint extra admins once the instance is initialized.
  app.post("/api/setup/init", async (request, reply) => {
    if (!(await needsSetup())) {
      return reply.code(409).send({ message: "实例已经完成初始化" });
    }

    const body = setupInitSchema.parse(request.body);

    if (body.deployMode === "single" && !body.wallName) {
      return reply.code(400).send({ message: "单墙模式需要填写校园墙名称" });
    }
    if (body.email) {
      const normalizedEmail = body.email.trim().toLowerCase();
      const existingEmail = await prisma.user.findUnique({ where: { email: normalizedEmail }, select: { id: true } });
      if (existingEmail) {
        return reply.code(409).send({ message: "这个邮箱已经注册" });
      }
    }

    // The host the installer is currently using becomes the management host so
    // that, in multi mode, operator self-registration works immediately without
    // a second manual step (this was the original chicken-and-egg deadlock).
    const managementHost = requestHostCandidates(request)[0] ?? null;

    const result = await prisma.$transaction(async (tx) => {
      // Re-check inside the transaction to close the race where two installers
      // submit at once.
      const existingOperator = await tx.user.findFirst({ where: { systemRole: "system_operator" }, select: { id: true } });
      if (existingOperator) {
        throw new SetupAlreadyDoneError();
      }

      const operator = await tx.user.create({
        data: {
          qqUin: await generateSyntheticQqUin(tx),
          email: body.email ? body.email.trim().toLowerCase() : null,
          displayName: body.displayName,
          passwordHash: await hashPassword(body.password),
          passwordChangeRequired: false,
          isTestAccount: false,
          systemRole: "system_operator",
        },
      });

      await tx.systemSetting.upsert({
        where: { key: DEPLOY_MODE_KEY },
        update: { value: body.deployMode },
        create: { key: DEPLOY_MODE_KEY, value: body.deployMode },
      });

      if (managementHost) {
        await tx.systemSetting.upsert({
          where: { key: MANAGEMENT_HOST_KEY },
          update: { value: managementHost },
          create: { key: MANAGEMENT_HOST_KEY, value: managementHost },
        });
      }

      let tenantId: string | null = null;
      if (body.deployMode === "single" && body.wallName) {
        const wall = await tx.tenant.create({
          data: {
            name: body.wallName,
            slug: slugForWall(body.wallName),
            host: null,
            themeColor: "#42a5f5",
            status: "active",
            metadata: {
              create: [
                { key: "brand", value: body.wallName },
                { key: "banner", value: "" },
                { key: "post_rules", value: defaultPostRules },
                { key: "pending_post_limit", value: 1 },
                { key: "services", value: defaultServices },
              ],
            },
          },
        });
        await tx.tenantMembership.create({
          data: { tenantId: wall.id, userId: operator.id, role: "admin" },
        });
        tenantId = wall.id;
      }

      await tx.systemSetting.upsert({
        where: { key: SETUP_COMPLETED_KEY },
        update: { value: true },
        create: { key: SETUP_COMPLETED_KEY, value: true },
      });

      return { operator, tenantId };
    }).catch((caught) => {
      if (caught instanceof SetupAlreadyDoneError) {
        return null;
      }
      throw caught;
    });

    if (result === null) {
      return reply.code(409).send({ message: "实例已经完成初始化" });
    }

    await writeAuditLog({
      tenantId: result.tenantId,
      actorId: result.operator.id,
      action: "system.setup.init",
      targetType: "system_setting",
      targetId: SETUP_COMPLETED_KEY,
      detail: { deployMode: body.deployMode, managementHost, createdWall: Boolean(result.tenantId) },
    });

    const token = await createSession(result.operator.id, result.tenantId);
    setSessionCookie(reply, token);

    return {
      ok: true,
      deployMode: body.deployMode,
      user: toPublicUser(result.operator),
    };
  });
}

class SetupAlreadyDoneError extends Error {
  constructor() {
    super("setup already done");
    this.name = "SetupAlreadyDoneError";
  }
}
