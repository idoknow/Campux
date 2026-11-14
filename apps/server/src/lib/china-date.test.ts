import { describe, expect, test } from "bun:test";
import { formatChinaDate } from "./china-date";

describe("formatChinaDate", () => {
  test("凌晨的上海时间仍算当天，不退回 UTC 的前一天", () => {
    const midnight = new Date("2026-01-01T00:30:00+08:00");

    expect(formatChinaDate(midnight)).toBe("2026-01-01");
    expect(midnight.toISOString().slice(0, 10)).toBe("2025-12-31");
  });

  test("跨年的最后一小时仍算当年", () => {
    expect(formatChinaDate(new Date("2025-12-31T23:59:00+08:00"))).toBe("2025-12-31");
  });

  test("同一时刻多次格式化结果稳定", () => {
    const date = new Date("2026-07-05T12:00:00.000Z");

    expect(formatChinaDate(date)).toBe(formatChinaDate(new Date(date.getTime())));
  });
});
