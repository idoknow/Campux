import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Prisma } from "@campux/db";
import { prisma } from "../lib/prisma";
import { BotWorkflowError } from "../lib/bot-workflows";
import {
  formatOfficialQqIdReply,
  isOfficialQqIdCommand,
  sendOfficialQqChannelMessage,
  signOfficialQqWebhookValidation,
} from "../runtime/official-qq";

const officialQqWebhookPayloadSchema = z.object({
  id: z.string().optional(),
  op: z.number().int(),
  t: z.string().optional(),
  d: z.unknown().optional(),
});

const officialQqValidationSchema = z.object({
  plain_token: z.string().min(1),
  event_ts: z.string().min(1),
});

const officialQqMessageSchema = z.object({
  id: z.string().optional(),
  guild_id: z.string().optional(),
  channel_id: z.string().optional(),
  content: z.string().default(""),
  author: z.object({ id: z.string().optional() }).optional(),
});

export function registerOfficialQqRoutes(app: FastifyInstance) {
  app.post("/qq-official/webhook", async (request, reply) => {
    const appId = readHeader(request.headers["x-bot-appid"]);
    if (!appId) {
      return reply.code(400).send({ message: "缺少 X-Bot-Appid" });
    }

    const bot = await prisma.botAccount.findFirst({
      where: {
        platform: "official_qq",
        officialAppId: appId,
        enabled: true,
      },
    });
    if (!bot) {
      return reply.code(404).send({ message: "QQ 官方机器人不存在或未启用" });
    }

    const payload = officialQqWebhookPayloadSchema.parse(request.body);
    try {
      if (payload.op === 13) {
        const validation = officialQqValidationSchema.parse(payload.d);
        return {
          plain_token: validation.plain_token,
          signature: signOfficialQqWebhookValidation(bot, validation.plain_token, validation.event_ts),
        };
      }

      if (payload.op !== 0) {
        return { op: 12 };
      }

      if (payload.t === "AT_MESSAGE_CREATE" || payload.t === "MESSAGE_CREATE") {
        const message = officialQqMessageSchema.parse(payload.d);
        if (message.channel_id && isOfficialQqIdCommand(message.content)) {
          await sendOfficialQqChannelMessage(bot, message.channel_id, {
            content: formatOfficialQqIdReply({
              guildId: message.guild_id ?? null,
              channelId: message.channel_id,
              messageId: message.id ?? null,
              authorId: message.author?.id ?? null,
              eventId: payload.id ?? null,
            }),
            msgId: message.id ?? null,
            eventId: payload.id ?? null,
          });
        }
      }

      return { op: 12 };
    } catch (error) {
      if (error instanceof BotWorkflowError) {
        return reply.code(error.statusCode).send({ message: error.message });
      }
      throw error;
    }
  });
}

function readHeader(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.trim() || null;
}
