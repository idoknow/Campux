import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { TenantRole } from "@campux/db";
import { requireTenantRole } from "../lib/auth";
import { prisma } from "../lib/prisma";
import { writeAuditLog } from "../lib/audit";
import { enqueueAttempt } from "../runtime/publishing";
import type { RuntimeQueue } from "../runtime/queue";

const roleSchema = z.enum(["submitter", "reviewer", "admin"]);

const memberParamsSchema = z.object({
  id: z.string().min(1),
});

const memberPatchSchema = z.object({
  role: roleSchema,
});

const targetParamsSchema = z.object({
  id: z.string().min(1),
});

const targetPatchSchema = z.object({
  displayName: z.string().min(1).max(80).optional(),
  enabled: z.boolean().optional(),
  required: z.boolean().optional(),
  publishDelaySeconds: z.number().int().min(0).max(86_400).optional(),
  failurePolicy: z.string().min(1).max(80).optional(),
});

const targetCreateSchema = z.object({
  botAccountId: z.string().min(1),
  displayName: z.string().min(1).max(80),
  enabled: z.boolean().default(true),
  required: z.boolean().default(true),
  publishDelaySeconds: z.number().int().min(0).max(86_400).default(0),
});

const attemptParamsSchema = z.object({
  id: z.string().min(1),
});

const postParamsSchema = z.object({
  id: z.string().min(1),
});

export function registerAdminRoutes(app: FastifyInstance, queue: RuntimeQueue) {
  app.get("/api/admin/members", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    const members = await prisma.tenantMembership.findMany({
      where: {
        tenantId: context.selectedTenant.id,
      },
      include: {
        user: true,
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    return {
      members: members.map((member) => toMember(member)),
    };
  });

  app.patch("/api/admin/members/:id", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    const params = memberParamsSchema.parse(request.params);
    const body = memberPatchSchema.parse(request.body);
    const member = await prisma.tenantMembership.findFirst({
      where: {
        id: params.id,
        tenantId: context.selectedTenant.id,
      },
    });

    if (!member) {
      return reply.code(404).send({ message: "成员不存在" });
    }

    const updated = await prisma.tenantMembership.update({
      where: {
        id: member.id,
      },
      data: {
        role: body.role,
      },
      include: {
        user: true,
      },
    });

    await writeAuditLog({
      tenantId: context.selectedTenant.id,
      actorId: context.user.id,
      action: "member.update_role",
      targetType: "membership",
      targetId: member.id,
      detail: {
        oldRole: member.role,
        newRole: body.role,
      },
    });

    return {
      member: toMember(updated),
    };
  });

  app.get("/api/admin/publish-targets", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    const targets = await prisma.publishTarget.findMany({
      where: {
        tenantId: context.selectedTenant.id,
      },
      include: {
        botAccount: true,
      },
      orderBy: {
        displayName: "asc",
      },
    });

    return {
      targets: targets.map(toPublishTarget),
    };
  });

  app.post("/api/admin/publish-targets", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    const body = targetCreateSchema.parse(request.body);
    const botAccount = await prisma.botAccount.findFirst({
      where: {
        id: body.botAccountId,
        tenantId: context.selectedTenant.id,
      },
    });

    if (!botAccount) {
      return reply.code(404).send({ message: "Bot 账号不存在" });
    }

    const target = await prisma.publishTarget.create({
      data: {
        tenantId: context.selectedTenant.id,
        botAccountId: botAccount.id,
        displayName: body.displayName,
        enabled: body.enabled,
        required: body.required,
        publishDelaySeconds: body.publishDelaySeconds,
      },
      include: {
        botAccount: true,
      },
    });

    await writeAuditLog({
      tenantId: context.selectedTenant.id,
      actorId: context.user.id,
      action: "publish_target.create",
      targetType: "publish_target",
      targetId: target.id,
    });

    return {
      target: toPublishTarget(target),
    };
  });

  app.patch("/api/admin/publish-targets/:id", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    const params = targetParamsSchema.parse(request.params);
    const body = targetPatchSchema.parse(request.body);
    const target = await prisma.publishTarget.findFirst({
      where: {
        id: params.id,
        tenantId: context.selectedTenant.id,
      },
    });

    if (!target) {
      return reply.code(404).send({ message: "发布目标不存在" });
    }

    const updateData = {
      ...(body.displayName === undefined ? {} : { displayName: body.displayName }),
      ...(body.enabled === undefined ? {} : { enabled: body.enabled }),
      ...(body.required === undefined ? {} : { required: body.required }),
      ...(body.publishDelaySeconds === undefined ? {} : { publishDelaySeconds: body.publishDelaySeconds }),
      ...(body.failurePolicy === undefined ? {} : { failurePolicy: body.failurePolicy }),
    };
    const updated = await prisma.publishTarget.update({
      where: {
        id: target.id,
      },
      data: updateData,
      include: {
        botAccount: true,
      },
    });

    await writeAuditLog({
      tenantId: context.selectedTenant.id,
      actorId: context.user.id,
      action: "publish_target.update",
      targetType: "publish_target",
      targetId: target.id,
      detail: updateData,
    });

    return {
      target: toPublishTarget(updated),
    };
  });

  app.get("/api/admin/posts/:id/publish-attempts", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "reviewer");
    const params = postParamsSchema.parse(request.params);
    const attempts = await prisma.publishAttempt.findMany({
      where: {
        tenantId: context.selectedTenant.id,
        postId: params.id,
      },
      include: {
        publishTarget: {
          include: {
            botAccount: true,
          },
        },
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

    return {
      attempts: attempts.map(toPublishAttempt),
    };
  });

  app.post("/api/admin/publish-attempts/:id/retry", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    const params = attemptParamsSchema.parse(request.params);
    const attempt = await prisma.publishAttempt.findFirst({
      where: {
        id: params.id,
        tenantId: context.selectedTenant.id,
      },
    });

    if (!attempt) {
      return reply.code(404).send({ message: "发布记录不存在" });
    }

    const updated = await prisma.publishAttempt.update({
      where: {
        id: attempt.id,
      },
      data: {
        status: "queued",
        lastError: null,
        nextRunAt: new Date(),
      },
    });
    enqueueAttempt(queue, updated.tenantId, updated.id);

    await writeAuditLog({
      tenantId: context.selectedTenant.id,
      actorId: context.user.id,
      action: "publish_attempt.retry",
      targetType: "publish_attempt",
      targetId: attempt.id,
    });

    return {
      ok: true,
    };
  });
}

function toMember(member: {
  id: string;
  role: TenantRole;
  createdAt: Date;
  user: {
    id: string;
    qqUin: bigint;
    displayName: string | null;
    systemRole: string | null;
  };
}) {
  return {
    id: member.id,
    role: member.role,
    createdAt: member.createdAt.toISOString(),
    user: {
      id: member.user.id,
      qqUin: member.user.qqUin.toString(),
      displayName: member.user.displayName,
      systemRole: member.user.systemRole,
    },
  };
}

function toPublishTarget(target: {
  id: string;
  type: string;
  displayName: string;
  enabled: boolean;
  required: boolean;
  publishDelaySeconds: number;
  failurePolicy: string;
  botAccount: {
    id: string;
    qqUin: bigint;
    displayName: string;
    enabled: boolean;
  };
}) {
  return {
    id: target.id,
    type: target.type,
    displayName: target.displayName,
    enabled: target.enabled,
    required: target.required,
    publishDelaySeconds: target.publishDelaySeconds,
    failurePolicy: target.failurePolicy,
    botAccount: {
      id: target.botAccount.id,
      qqUin: target.botAccount.qqUin.toString(),
      displayName: target.botAccount.displayName,
      enabled: target.botAccount.enabled,
    },
  };
}

function toPublishAttempt(attempt: {
  id: string;
  status: string;
  attempt: number;
  lastError: string | null;
  externalId: string | null;
  updatedAt: Date;
  publishTarget: {
    id: string;
    displayName: string;
    required: boolean;
    botAccount: {
      qqUin: bigint;
      displayName: string;
    };
  };
}) {
  return {
    id: attempt.id,
    status: attempt.status,
    attempt: attempt.attempt,
    lastError: attempt.lastError,
    externalId: attempt.externalId,
    updatedAt: attempt.updatedAt.toISOString(),
    publishTarget: {
      id: attempt.publishTarget.id,
      displayName: attempt.publishTarget.displayName,
      required: attempt.publishTarget.required,
      botAccount: {
        qqUin: attempt.publishTarget.botAccount.qqUin.toString(),
        displayName: attempt.publishTarget.botAccount.displayName,
      },
    },
  };
}
