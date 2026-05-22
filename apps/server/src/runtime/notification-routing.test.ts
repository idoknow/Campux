import { describe, expect, test } from "bun:test";
import { selectReviewNotificationBot } from "./notification-routing";

const baseTime = new Date("2026-05-01T00:00:00.000Z");

function bot(overrides: Partial<Parameters<typeof selectReviewNotificationBot>[0][number]> & { id: string }) {
  return {
    enabled: true,
    reviewGroupId: "10000",
    reviewNotificationEnabled: false,
    createdAt: baseTime,
    ...overrides,
  };
}

describe("selectReviewNotificationBot", () => {
  test("does not choose bots that have no explicit review notification switch", () => {
    expect(selectReviewNotificationBot([
      bot({ id: "wall-a" }),
      bot({ id: "wall-b" }),
    ])).toBeNull();
  });

  test("chooses only the enabled bot with reviewNotificationEnabled", () => {
    expect(selectReviewNotificationBot([
      bot({ id: "wall-a", reviewNotificationEnabled: false }),
      bot({ id: "wall-b", reviewNotificationEnabled: true }),
    ])?.id).toBe("wall-b");
  });

  test("ignores disabled bots and bots without review group", () => {
    expect(selectReviewNotificationBot([
      bot({ id: "disabled", reviewNotificationEnabled: true, enabled: false }),
      bot({ id: "no-group", reviewNotificationEnabled: true, reviewGroupId: null }),
      bot({ id: "active", reviewNotificationEnabled: true }),
    ])?.id).toBe("active");
  });

  test("uses the oldest bot if legacy data accidentally has more than one sender", () => {
    expect(selectReviewNotificationBot([
      bot({ id: "newer", reviewNotificationEnabled: true, createdAt: new Date(baseTime.getTime() + 1000) }),
      bot({ id: "older", reviewNotificationEnabled: true, createdAt: baseTime }),
    ])?.id).toBe("older");
  });
});
