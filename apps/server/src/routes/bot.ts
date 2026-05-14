import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { BotWorkflowError, registerUserViaBot, reviewPostViaBot } from "../lib/bot-workflows";
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
    const result = await handleBotWorkflowError(reply, () =>
      registerUserViaBot({
        botQqUin: body.botQqUin,
        userQqUin: body.userQqUin,
        displayName: body.displayName,
        password: body.password,
        role: body.role,
        resetExistingPassword: true,
      }),
    );
    if (!result) {
      return;
    }

    return {
      user: result.user,
      membership: {
        id: result.membership.id,
        tenantId: result.membership.tenantId,
        role: result.membership.role,
      },
    };
  });

  app.post("/api/bot/review-command", async (request, reply) => {
    const body = reviewCommandSchema.parse(request.body);
    const result = await handleBotWorkflowError(reply, () =>
      reviewPostViaBot({
        queue,
        botQqUin: body.botQqUin,
        groupId: body.groupId,
        operatorQqUin: body.operatorQqUin,
        displayId: body.displayId,
        action: body.action,
        comment: body.comment,
      }),
    );
    if (!result) {
      return;
    }

    return {
      ok: true,
    };
  });
}

async function handleBotWorkflowError<T>(reply: { code(statusCode: number): { send(payload: unknown): unknown } }, fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof BotWorkflowError) {
      reply.code(error.statusCode).send({ message: error.message });
      return null;
    }
    throw error;
  }
}
