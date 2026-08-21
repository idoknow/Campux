import { describe, expect, test } from "bun:test";
import { toSystemTenant } from "./system";

describe("toSystemTenant runtime status", () => {
  test("serializes live OneBot connections and QZone target readiness", () => {
    const tenant = {
      id: "tenant-1", slug: "wall", host: null, name: "测试墙", status: "active" as const,
      readyAt: new Date("2026-08-21T00:00:00.000Z"), archiveWarningAt: null,
      createdAt: new Date("2026-08-20T00:00:00.000Z"), updatedAt: new Date("2026-08-21T00:00:00.000Z"),
      botAccounts: [{
        id: "bot-1", platform: "onebot", qqUin: 10001n, displayName: "墙号", enabled: true,
        reviewGroupId: "20001", lastSeenAt: new Date("2026-08-21T01:02:03.000Z"),
        sessions: [{ healthStatus: "available" }],
        publishTargets: [{ id: "target-1", type: "qzone", displayName: "QQ 空间", enabled: true, required: true }],
      }],
      _count: { botAccounts: 1, posts: 2, memberships: 3 },
    };

    const result = toSystemTenant(tenant, { getBotConnectionStatus: () => ({ online: true, connectionCount: 2 }) });

    expect(result.bots[0]?.connection).toEqual({ online: true, connectionCount: 2 });
    expect(result.bots[0]?.publishTargets[0]?.status).toBe("ready");
  });

  test("marks enabled QZone targets unavailable without a healthy session", () => {
    const tenant = {
      id: "tenant-2", slug: "wall-2", host: null, name: "离线墙", status: "active" as const,
      readyAt: null, archiveWarningAt: null, createdAt: new Date(), updatedAt: new Date(),
      botAccounts: [{
        id: "bot-2", platform: "onebot", qqUin: 10002n, displayName: "墙号 2", enabled: true,
        reviewGroupId: null, lastSeenAt: null, sessions: [],
        publishTargets: [{ id: "target-2", type: "qzone", displayName: "QQ 空间", enabled: true, required: true }],
      }],
      _count: { botAccounts: 1, posts: 0, memberships: 0 },
    };

    const result = toSystemTenant(tenant, { getBotConnectionStatus: () => ({ online: false, connectionCount: 0 }) });

    expect(result.bots[0]?.connection.online).toBe(false);
    expect(result.bots[0]?.publishTargets[0]?.status).toBe("unavailable");
  });
});
