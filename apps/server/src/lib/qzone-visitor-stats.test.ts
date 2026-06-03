import { describe, expect, test } from "bun:test";
import { buildQZoneVisitorDailySeries, buildQZoneVisitorTargetSeries, parseQZoneVisitorCounts } from "./qzone-visitor-stats";

describe("qzone visitor count parsing", () => {
  test("extracts numeric visitor counts from qzone payload data", () => {
    expect(parseQZoneVisitorCounts({ todaycount: "12", totalcount: 345 })).toEqual({ todayCount: 12, totalCount: 345 });
  });

  test("rejects invalid qzone visitor payload data", () => {
    expect(parseQZoneVisitorCounts({ todaycount: "abc", totalcount: 345 })).toBeNull();
    expect(parseQZoneVisitorCounts({ todaycount: 12 })).toBeNull();
  });
});

describe("qzone visitor daily series", () => {
  test("aggregates tenant visitor snapshots by day across bots", () => {
    const start = new Date(2026, 5, 1);
    const end = new Date(2026, 5, 3, 12);

    expect(
      buildQZoneVisitorDailySeries(
        [
          { date: new Date(2026, 5, 1), todayCount: 2, totalCount: 20 },
          { date: new Date(2026, 5, 1), todayCount: 3, totalCount: 30 },
          { date: new Date(2026, 5, 3), todayCount: 5, totalCount: 55 },
        ],
        start,
        end,
      ),
    ).toEqual([
      { date: "2026-06-01", todayCount: 5, totalCount: 50 },
      { date: "2026-06-02", todayCount: 0, totalCount: 0 },
      { date: "2026-06-03", todayCount: 5, totalCount: 55 },
    ]);
  });

  test("builds a separate visitor series for each publish target", () => {
    const start = new Date(2026, 5, 1);
    const end = new Date(2026, 5, 2);

    expect(
      buildQZoneVisitorTargetSeries(
        [
          { botAccountId: "bot-a", date: new Date(2026, 5, 1), todayCount: 2, totalCount: 20 },
          { botAccountId: "bot-b", date: new Date(2026, 5, 1), todayCount: 3, totalCount: 30 },
          { botAccountId: "bot-b", date: new Date(2026, 5, 2), todayCount: 4, totalCount: 34 },
        ],
        [
          { id: "target-a", displayName: "空间 A", botAccountId: "bot-a", botDisplayName: "机器人 A", botQqUin: "10001" },
          { id: "target-b", displayName: "空间 B", botAccountId: "bot-b", botDisplayName: "机器人 B", botQqUin: "10002" },
        ],
        start,
        end,
      ),
    ).toEqual([
      {
        id: "target-a",
        displayName: "空间 A",
        bot: { displayName: "机器人 A", qqUin: "10001" },
        daily: [
          { date: "2026-06-01", todayCount: 2, totalCount: 20 },
          { date: "2026-06-02", todayCount: 0, totalCount: 0 },
        ],
      },
      {
        id: "target-b",
        displayName: "空间 B",
        bot: { displayName: "机器人 B", qqUin: "10002" },
        daily: [
          { date: "2026-06-01", todayCount: 3, totalCount: 30 },
          { date: "2026-06-02", todayCount: 4, totalCount: 34 },
        ],
      },
    ]);
  });
});
