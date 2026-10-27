import { describe, expect, it } from "bun:test";
import {
  isValidPublishRateLimits,
  nextPublishRateLimitWindowEnd,
  normalizePublishRateLimits,
} from "./tenant-metadata";

describe("tenant publish rate limit helpers", () => {
  it("keeps independent hourly and daily caps when valid", () => {
    expect(normalizePublishRateLimits({ hourly: 2, daily: 24 })).toEqual({ hourly: 2, daily: 24 });
    expect(isValidPublishRateLimits({ hourly: 2, daily: 24 })).toBe(true);
  });

  it("resets invalid hourly-times-twelve greater than daily configuration", () => {
    expect(isValidPublishRateLimits({ hourly: 2, daily: 23 })).toBe(false);
    expect(normalizePublishRateLimits({ hourly: 2, daily: 23 })).toEqual({ hourly: 0, daily: 0 });
  });

  it("treats zero as a disabled cap", () => {
    expect(normalizePublishRateLimits({ hourly: 0, daily: 0 })).toEqual({ hourly: 0, daily: 0 });
    expect(isValidPublishRateLimits({ hourly: 0, daily: 5 })).toBe(true);
    expect(isValidPublishRateLimits({ hourly: 1, daily: 0 })).toBe(true);
  });

  it("returns the next natural hour and day boundaries", () => {
    const now = new Date("2025-01-01T10:37:42.123+08:00");
    expect(nextPublishRateLimitWindowEnd(now, "hour").toISOString()).toBe("2025-01-01T03:00:00.000Z");
    expect(nextPublishRateLimitWindowEnd(now, "day").toISOString()).toBe("2025-01-01T16:00:00.000Z");
  });
});
