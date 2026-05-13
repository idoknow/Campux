import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { hasTenantRole } from "../lib/auth";
import { writeAuditLog } from "../lib/audit";
import { prisma } from "../lib/prisma";
import { enqueuePublishFanout } from "../runtime/publishing";
import type { RuntimeQueue } from "../runtime/queue";

const registerSchema = z.object({
  botQqUin: z.string().min(1),
  userQqUin: z.string().min(1),
  displayName: z.string().min(1).max(80).optional(),
  password: z.string().min(6).default("campux123"),
  role: z.enum(["submitter", "reviewer", "admin"]).default("submitter"),
});

const reviewCommandSchema = z.object({
  botQqUin: z.string().min(1),
  groupId: z.string().min(1).optional(),
  operatorQqUin: z.string().min(1),
  displayId: z.number().int().positive(),
  action: z.enum(["approve", "reject"]),
  comment: z.string().max(500).optional(),
});

export function registerBotRoutes(app: FastifyInstance, queue: RuntimeQueue) {
  app.post("/api/bot/register", async (request, reply) => {
    const body = registerSchema.parse(request.body);
    const bot = await prisma.botAccount.findFirst({
      where: {
        qqUin: BigInt(body.botQqUin),
        enabled: true,
      },
    });

    if (!bot) {
      return reply.code(404).send({ message: "Bot 未绑定校园墙" });
    }

    const passwordHash = await Bun.password.hash(body.password);
    const userData = {
      passwordHash,
      ...(body.displayName === undefined ? {} : { displayName: body.displayName }),
    };
    const user = await prisma.user.upsert({
      where: {
        qqUin: BigInt(body.userQqUin),
      },
      update: userData,
      create: {
        qqUin: BigInt(body.userQqUin),
        passwordHash,
        ...(body.displayName === undefined ? {} : { displayName: body.displayName }),
      },
    });

    const membership = await prisma.tenantMembership.upsert({
      where: {
        tenantId_userId: {
          tenantId: bot.tenantId,
          userId: user.id,
        },
      },
      update: {
        role: body.role,
      },
      create: {
        tenantId: bot.tenantId,
        userId: user.id,
        role: body.role,
      },
    });

    await prisma.botAccount.update({
      where: {
        id: bot.id,
      },
      data: {
        lastSeenAt: new Date(),
      },
    });

    await writeAuditLog({
      tenantId: bot.tenantId,
      actorId: user.id,
      action: "bot.register",
      targetType: "membership",
      targetId: membership.id,
      detail: {
        botQqUin: body.botQqUin,
        userQqUin: body.userQqUin,
        role: body.role,
      },
    });

    return {
      user: {
        id: user.id,
        qqUin: user.qqUin.toString(),
        displayName: user.displayName,
      },
      membership: {
        id: membership.id,
        tenantId: membership.tenantId,
        role: membership.role,
      },
    };
  });

  app.post("/api/bot/review-command", async (request, reply) => {
    const body = reviewCommandSchema.parse(request.body);
    const bot = await prisma.botAccount.findFirst({
      where: {
        qqUin: BigInt(body.botQqUin),
        enabled: true,
      },
    });

    if (!bot) {
      return reply.code(404).send({ message: "Bot 未绑定校园墙" });
    }
    if (bot.reviewGroupId && body.groupId && bot.reviewGroupId !== body.groupId) {
      return reply.code(403).send({ message: "审核群不属于这个校园墙" });
    }

    const operator = await prisma.user.findUnique({
      where: {
        qqUin: BigInt(body.operatorQqUin),
      },
      include: {
        memberships: true,
      },
    });
    const membership = operator?.memberships.find((item) => item.tenantId === bot.tenantId);
    if (!operator || !membership || !hasTenantRole(membership.role, "reviewer")) {
      return reply.code(403).send({ message: "没有审核权限" });
    }

    const post = await prisma.post.findFirst({
      where: {
        tenantId: bot.tenantId,
        displayId: body.displayId,
      },
    });

    if (!post) {
      return reply.code(404).send({ message: "稿件不存在" });
    }
    if (post.status !== "pending_approval") {
      return reply.code(409).send({ message: "只有待审核稿件可以处理" });
    }

    const nextStatus = body.action === "approve" ? "approved" : "rejected";
    await prisma.post.update({
      where: {
        id: post.id,
      },
      data: {
        status: nextStatus,
        logs: {
          create: {
            tenantId: bot.tenantId,
            actorId: operator.id,
            oldStatus: post.status,
            newStatus: nextStatus,
            comment: body.comment?.trim() || `审核群命令${body.action === "approve" ? "通过" : "拒绝"}`,
          },
        },
      },
    });

    await writeAuditLog({
      tenantId: bot.tenantId,
      actorId: operator.id,
      action: `bot.review.${body.action}`,
      targetType: "post",
      targetId: post.id,
      detail: {
        displayId: post.displayId,
        groupId: body.groupId ?? null,
      },
    });

    if (body.action === "approve") {
      await enqueuePublishFanout(queue, bot.tenantId, post.id, operator.id);
    }

    return {
      ok: true,
    };
  });
}
