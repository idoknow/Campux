import { describe, expect, test } from "bun:test";
import { buildBotFriendDailySeries, buildBotFriendTargetSeries, parseFriendListCount } from "./bot-friend-stats";

describe("friend list count parsing", () => {
  test("counts friend entries from get_friend_list payload", () => {
    expect(parseFriendListCount([{ user_id: 1 }, { user_id: 2 }, { user_id: 3 }])).toBe(3);
    expect(parseFriendListCount([])).toBe(0);
  });

  test("rejects non-array friend list payloads", () => {
    expect(parseFriendListCount({ count: 3 })).toBeNull();
    expect(parseFriendListCount(null)).toBeNull();
    expect(parseFriendListCount("oops")).toBeNull();
  });
});

describe("bot friend daily series", () => {
  test("carries the latest friend count forward across days without snapshots", () => {
    const start = new Date(2026, 5, 1);
    const end = new Date(2026, 5, 4, 12);

    expect(
      buildBotFriendDailySeries(
        [
          { date: new Date(2026, 5, 1), friendCount: 120 },
          { date: new Date(2026, 5, 3), friendCount: 135 },
        ],
        start,
        end,
      ),
    ).toEqual([
      { date: "2026-06-01", friendCount: 120 },
      { date: "2026-06-02", friendCount: 120 },
      { date: "2026-06-03", friendCount: 135 },
      { date: "2026-06-04", friendCount: 135 },
    ]);
  });

  test("seeds the curve from the most recent snapshot before the window", () => {
    const start = new Date(2026, 5, 2);
    const end = new Date(2026, 5, 3);

    expect(
      buildBotFriendDailySeries(
        [
          { date: new Date(2026, 5, 1), friendCount: 100 },
          { date: new Date(2026, 5, 3), friendCount: 110 },
        ],
        start,
        end,
      ),
    ).toEqual([
      { date: "2026-06-02", friendCount: 100 },
      { date: "2026-06-03", friendCount: 110 },
    ]);
  });

  test("builds a separate friend series for each bot", () => {
    const start = new Date(2026, 5, 1);
    const end = new Date(2026, 5, 2);

    expect(
      buildBotFriendTargetSeries(
        [
          { botAccountId: "bot-a", date: new Date(2026, 5, 1), friendCount: 50 },
          { botAccountId: "bot-b", date: new Date(2026, 5, 1), friendCount: 80 },
          { botAccountId: "bot-b", date: new Date(2026, 5, 2), friendCount: 82 },
        ],
        [
          { botAccountId: "bot-a", botDisplayName: "机器人 A", botQqUin: "10001" },
          { botAccountId: "bot-b", botDisplayName: "机器人 B", botQqUin: "10002" },
        ],
        start,
        end,
      ),
    ).toEqual([
      {
        botAccountId: "bot-a",
        bot: { displayName: "机器人 A", qqUin: "10001" },
        daily: [
          { date: "2026-06-01", friendCount: 50 },
          { date: "2026-06-02", friendCount: 50 },
        ],
      },
      {
        botAccountId: "bot-b",
        bot: { displayName: "机器人 B", qqUin: "10002" },
        daily: [
          { date: "2026-06-01", friendCount: 80 },
          { date: "2026-06-02", friendCount: 82 },
        ],
      },
    ]);
  });
});
