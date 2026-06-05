import type { FastifyBaseLogger } from "fastify";
import { prisma } from "../lib/prisma";
import { botFriendSnapshotDate, parseFriendListCount } from "../lib/bot-friend-stats";

const collectIntervalMs = 60 * 60 * 1000; // re-scan hourly; one snapshot per bot per day
const perBotRequestSpacingMs = 5 * 1000;

type FriendListCaller = {
  getBotConnectionStatus(botQqUin: string): { online: boolean; connectionCount: number };
  callAction(botQqUin: string, action: string, params: Record<string, unknown>, timeoutMs?: number): Promise<unknown>;
};

/**
 * Collects each tenant bot's QQ friend count once per day so the stats page can
 * render a per-bot friend-count trend. Re-scans hourly and only collects for
 * bots that do not yet have a snapshot for the current day, so a restart or a
 * temporarily offline bot simply retries later in the day.
 */
export function registerBotFriendSnapshotScheduler({ caller, logger }: { caller: FriendListCaller; logger: FastifyBaseLogger }) {
  async function run() {
    const collected = await collectBotFriendSnapshots(caller, logger);
    if (collected > 0) {
      logger.info({ count: collected }, "bot friend snapshot scan collected");
    }
  }

  const timer = setInterval(() => {
    void run().catch((error) => logger.warn({ error }, "bot friend snapshot scan failed"));
  }, collectIntervalMs);
  void run().catch((error) => logger.warn({ error }, "bot friend snapshot scan failed"));
  return () => clearInterval(timer);
}

export async function collectBotFriendSnapshots(caller: FriendListCaller, logger: FastifyBaseLogger) {
  const today = botFriendSnapshotDate(new Date());
  const bots = await prisma.botAccount.findMany({
    where: {
      enabled: true,
    },
    select: {
      id: true,
      tenantId: true,
      qqUin: true,
      friendSnapshots: {
        where: {
          date: today,
        },
        select: {
          id: true,
        },
        take: 1,
      },
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  let collected = 0;
  let spacingIndex = 0;
  for (const bot of bots) {
    if (bot.friendSnapshots.length > 0) {
      continue;
    }
    const botQqUin = bot.qqUin.toString();
    const status = caller.getBotConnectionStatus(botQqUin);
    if (!status.online) {
      logger.debug({ botAccountId: bot.id, botQqUin }, "bot friend snapshot skipped, bot offline");
      continue;
    }

    if (spacingIndex > 0) {
      await delay(perBotRequestSpacingMs);
    }
    spacingIndex += 1;

    try {
      const data = await caller.callAction(botQqUin, "get_friend_list", {}, 15_000);
      const friendCount = parseFriendListCount(data);
      if (friendCount === null) {
        logger.warn({ botAccountId: bot.id, botQqUin }, "bot friend snapshot received invalid friend list");
        continue;
      }
      const checkedAt = new Date();
      await prisma.botFriendSnapshot.upsert({
        where: {
          botAccountId_date: {
            botAccountId: bot.id,
            date: today,
          },
        },
        create: {
          tenantId: bot.tenantId,
          botAccountId: bot.id,
          date: today,
          friendCount,
          checkedAt,
        },
        update: {
          friendCount,
          checkedAt,
        },
      });
      collected += 1;
      logger.info({ botAccountId: bot.id, botQqUin, friendCount }, "bot friend snapshot recorded");
    } catch (error) {
      logger.warn({ error, botAccountId: bot.id, botQqUin }, "bot friend snapshot collection failed");
    }
  }

  return collected;
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
