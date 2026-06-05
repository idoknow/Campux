const dayMs = 24 * 60 * 60 * 1000;

export type BotFriendSnapshotInput = {
  botAccountId?: string;
  date: Date;
  friendCount: number;
};

export type BotFriendTargetInput = {
  botAccountId: string;
  botDisplayName: string;
  botQqUin: string;
};

/**
 * Parse the friend count from an OneBot `get_friend_list` action response.
 * The response data is expected to be an array of friend entries.
 */
export function parseFriendListCount(data: unknown): number | null {
  if (!Array.isArray(data)) {
    return null;
  }
  return data.length;
}

export function buildBotFriendDailySeries(snapshots: BotFriendSnapshotInput[], start: Date, end: Date) {
  const days = buildEmptyBotFriendDailySeries(start, end);
  const byDate = new Map(days.map((day) => [day.date, day]));
  // Snapshots are keyed per bot per day; the daily series carries the latest
  // known friend count up to and including each day so the curve reads as a
  // running total rather than dropping to zero on days without a snapshot.
  const sorted = [...snapshots].sort((left, right) => left.date.getTime() - right.date.getTime());
  const latestByDate = new Map<string, number>();
  for (const snapshot of sorted) {
    latestByDate.set(formatDayKey(snapshot.date), snapshot.friendCount);
  }
  let carried: number | null = null;
  // Seed the carry with the most recent snapshot strictly before the window.
  const startDay = startOfDay(start);
  for (const snapshot of sorted) {
    if (snapshot.date < startDay) {
      carried = snapshot.friendCount;
    }
  }
  for (const day of days) {
    if (latestByDate.has(day.date)) {
      carried = latestByDate.get(day.date) ?? carried;
    }
    day.friendCount = carried ?? 0;
  }
  return days;
}

export function buildBotFriendTargetSeries(snapshots: BotFriendSnapshotInput[], bots: BotFriendTargetInput[], start: Date, end: Date) {
  return bots.map((bot) => ({
    botAccountId: bot.botAccountId,
    bot: {
      displayName: bot.botDisplayName,
      qqUin: bot.botQqUin,
    },
    daily: buildBotFriendDailySeries(
      snapshots.filter((snapshot) => snapshot.botAccountId === bot.botAccountId),
      start,
      end,
    ),
  }));
}

export function botFriendSnapshotDate(date: Date) {
  return startOfDay(date);
}

function buildEmptyBotFriendDailySeries(start: Date, end: Date) {
  const startDay = startOfDay(start);
  const endDay = startOfDay(end);
  const days = [];
  for (let time = startDay.getTime(); time <= endDay.getTime(); time += dayMs) {
    days.push({
      date: formatDayKey(new Date(time)),
      friendCount: 0,
    });
  }
  return days;
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatDayKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
