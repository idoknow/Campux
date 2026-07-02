import { describe, expect, test } from "bun:test";
import type { FastifyBaseLogger } from "fastify";
import type { CampuxConfig } from "@campux/config";
import { runTenantLifecycleSweep } from "./tenant-lifecycle";

const fixedNow = new Date("2026-07-03T04:00:00.000Z");
const dayMs = 24 * 60 * 60 * 1000;

function daysAgo(days: number) {
  return new Date(fixedNow.getTime() - days * dayMs);
}

function testLogger() {
  return {
    info: () => undefined,
    warn: () => undefined,
  } as unknown as FastifyBaseLogger;
}

function testConfig() {
  return {
    resend: {
      apiKey: undefined,
      fromEmail: "noreply@example.com",
    },
  } as unknown as CampuxConfig;
}

function createLifecycleStore(candidates: Array<{ id: string; name: string; archiveWarningAt: Date | null; _count: { memberships: number } }>) {
  const updates: Array<{ where: { id: string }; data: Record<string, unknown> }> = [];
  const findManyArgs: unknown[] = [];

  return {
    updates,
    findManyArgs,
    store: {
      tenant: {
        async findMany(args: unknown) {
          findManyArgs.push(args);
          return candidates;
        },
        async update(args: { where: { id: string }; data: Record<string, unknown> }) {
          updates.push(args);
          return {};
        },
      },
      tenantMembership: {
        async findMany() {
          return [];
        },
      },
    },
  };
}

describe("runTenantLifecycleSweep", () => {
  test("archives an active tenant when an existing warning is past the grace window", async () => {
    const { store, updates } = createLifecycleStore([
      {
        id: "tenant-overdue",
        name: "Overdue Warning Wall",
        archiveWarningAt: daysAgo(8),
        _count: { memberships: 2 },
      },
    ]);
    const auditActions: string[] = [];

    await runTenantLifecycleSweep({
      logger: testLogger(),
      config: testConfig(),
      prisma: store,
      now: () => fixedNow,
      writeAuditLog: async ({ action }) => {
        auditActions.push(action);
      },
      sendEmail: async () => ({ skipped: true as const }),
    });

    expect(updates).toEqual([
      {
        where: { id: "tenant-overdue" },
        data: { status: "archived" },
      },
    ]);
    expect(auditActions).toEqual(["tenant.archive.auto"]);
  });

  test("keeps an issued warning active even if membership count later exceeds the initial threshold", async () => {
    const { store, updates } = createLifecycleStore([
      {
        id: "tenant-warned",
        name: "Warned Wall",
        archiveWarningAt: daysAgo(3),
        _count: { memberships: 5 },
      },
    ]);

    await runTenantLifecycleSweep({
      logger: testLogger(),
      config: testConfig(),
      prisma: store,
      now: () => fixedNow,
      writeAuditLog: async () => undefined,
      sendEmail: async () => ({ skipped: true as const }),
    });

    expect(updates).toEqual([]);
  });

  test("does not warn a never-warned tenant whose membership count is above the threshold", async () => {
    const { store, updates } = createLifecycleStore([
      {
        id: "tenant-busy",
        name: "Active Unready Wall",
        archiveWarningAt: null,
        _count: { memberships: 5 },
      },
    ]);

    await runTenantLifecycleSweep({
      logger: testLogger(),
      config: testConfig(),
      prisma: store,
      now: () => fixedNow,
      writeAuditLog: async () => undefined,
      sendEmail: async () => ({ skipped: true as const }),
    });

    expect(updates).toEqual([]);
  });
});
