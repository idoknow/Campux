import { describe, expect, test } from "bun:test";
import { summarizeTenantRuntime } from "./tenant-runtime-summary";
import type { SystemTenant } from "../../types/app";

const tenant = {
  bots: [
    {
      lastSeenAt: "2026-08-21T01:00:00.000Z",
      connection: { online: true, connectionCount: 1 },
      publishTargets: [
        { status: "ready" },
        { status: "unavailable" },
      ],
    },
    {
      lastSeenAt: "2026-08-21T02:00:00.000Z",
      connection: { online: false, connectionCount: 0 },
      publishTargets: [{ status: "disabled" }],
    },
  ],
} as SystemTenant;

describe("summarizeTenantRuntime", () => {
  test("summarizes online bots, latest connection, and publish target states", () => {
    expect(summarizeTenantRuntime(tenant)).toEqual({
      onlineBots: 1,
      totalBots: 2,
      lastConnectedAt: "2026-08-21T02:00:00.000Z",
      readyTargets: 1,
      unavailableTargets: 1,
      disabledTargets: 1,
      totalTargets: 3,
    });
  });

  test("returns empty runtime values for a tenant without bots", () => {
    expect(summarizeTenantRuntime({ bots: [] } as unknown as SystemTenant)).toEqual({
      onlineBots: 0,
      totalBots: 0,
      lastConnectedAt: null,
      readyTargets: 0,
      unavailableTargets: 0,
      disabledTargets: 0,
      totalTargets: 0,
    });
  });
});
