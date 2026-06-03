import { describe, expect, test } from "bun:test";
import { formatQZoneAutoRefreshCooldown, isQZoneProtocolAutoRefreshCooldownError, QZoneProtocolAutoRefreshCooldownError } from "./qzone-auto-refresh";

describe("QZone protocol auto refresh cooldown", () => {
  test("identifies cooldown errors", () => {
    const error = new QZoneProtocolAutoRefreshCooldownError(90_000, "上次失败");

    expect(isQZoneProtocolAutoRefreshCooldownError(error)).toBe(true);
    expect(isQZoneProtocolAutoRefreshCooldownError(new Error("other"))).toBe(false);
  });

  test("formats remaining cooldown for operators", () => {
    expect(formatQZoneAutoRefreshCooldown(90_000)).toBe("约 2 分钟");
    expect(formatQZoneAutoRefreshCooldown(2 * 60 * 60 * 1000)).toBe("约 2 小时");
  });
});
