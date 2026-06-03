import { describe, expect, test } from "bun:test";
import { buildQZoneVisitorDailySeries, parseQZoneVisitorCounts } from "./qzone-visitor-stats";

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
});
