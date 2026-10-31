import { describe, expect, it } from "bun:test";
import { claimSchoolRelationExtraction } from "./school-relation-extraction-claim";

describe("claimSchoolRelationExtraction", () => {
  it("claims a new unique checkpoint", async () => {
    const calls: string[] = [];
    const db = { schoolRelationExtraction: {
      createMany: async () => { calls.push("create"); return { count: 1 }; },
      updateMany: async () => { calls.push("update"); return { count: 0 }; },
    } };
    const result = await claimSchoolRelationExtraction(db, { tenantId: "t", postId: "p", contentHash: "h", staleBefore: new Date(0), now: new Date(1000) });
    expect(result.claimed).toBe(true);
    expect(calls).toEqual(["create"]);
  });

  it("reclaims failed checkpoints but does not steal live or completed checkpoints", async () => {
    for (const initialStatus of ["processing", "completed"] as const) {
      const state: { status: string; attemptedAt: Date; attempts: number } = { status: initialStatus, attemptedAt: new Date(900), attempts: 1 };
      const whereCalls: unknown[] = [];
      const db = { schoolRelationExtraction: {
        createMany: async () => ({ count: 0 }),
        updateMany: async ({ where, data }: { where: { status: string; attemptedAt?: { lt: Date } }; data: { status: string; attempts: { increment: number }; attemptedAt: Date } }) => {
          whereCalls.push(where);
          if (state.status !== where.status || (where.attemptedAt && state.attemptedAt >= where.attemptedAt.lt)) return { count: 0 };
          state.status = data.status;
          state.attempts += data.attempts.increment;
          state.attemptedAt = data.attemptedAt;
          return { count: 1 };
        },
      } };
      const result = await claimSchoolRelationExtraction(db, { tenantId: "t", postId: "p", contentHash: "h", staleBefore: new Date(500), now: new Date(1000) });
      expect(result.claimed).toBe(false);
      expect(state).toEqual({ status: initialStatus, attemptedAt: new Date(900), attempts: 1 });
      expect(whereCalls).toHaveLength(initialStatus === "processing" ? 2 : 1);
    }
    const state = { status: "failed", attemptedAt: new Date(900), attempts: 1 };
    const db = { schoolRelationExtraction: {
      createMany: async () => ({ count: 0 }),
      updateMany: async ({ where, data }: { where: { status: string }; data: { status: string; attempts: { increment: number }; attemptedAt: Date } }) => {
        if (state.status !== where.status) return { count: 0 };
        state.status = data.status;
        state.attempts += data.attempts.increment;
        state.attemptedAt = data.attemptedAt;
        return { count: 1 };
      },
    } };
    const result = await claimSchoolRelationExtraction(db, { tenantId: "t", postId: "p", contentHash: "h", staleBefore: new Date(500), now: new Date(1000) });
    expect(result.claimed).toBe(true);
    expect(state).toEqual({ status: "processing", attemptedAt: new Date(1000), attempts: 2 });
  });

  it("reclaims only expired processing claims with a conditional status-and-age filter", async () => {
    const state = { status: "processing", attemptedAt: new Date(400), attempts: 1 };
    const wheres: Array<{ tenantId: string; postId: string; contentHash: string; status: string; attemptedAt?: { lt: Date } }> = [];
    const db = { schoolRelationExtraction: {
      createMany: async () => ({ count: 0 }),
      updateMany: async ({ where, data }: { where: (typeof wheres)[number]; data: { status: string; attempts: { increment: number }; attemptedAt: Date } }) => {
        wheres.push(where);
        const matches = state.status === where.status && (!where.attemptedAt || state.attemptedAt < where.attemptedAt.lt);
        if (!matches) return { count: 0 };
        state.status = data.status;
        state.attempts += data.attempts.increment;
        state.attemptedAt = data.attemptedAt;
        return { count: 1 };
      },
    } };
    const staleBefore = new Date(500);
    const result = await claimSchoolRelationExtraction(db, { tenantId: "t", postId: "p", contentHash: "h", staleBefore, now: new Date(1000) });
    expect(result).toEqual({ claimed: true, attemptAt: new Date(1000) });
    expect(state).toEqual({ status: "processing", attemptedAt: new Date(1000), attempts: 2 });
    expect(wheres).toEqual([
      { tenantId: "t", postId: "p", contentHash: "h", status: "failed" },
      { tenantId: "t", postId: "p", contentHash: "h", status: "processing", attemptedAt: { lt: staleBefore } },
    ]);

    state.attemptedAt = new Date(900);
    const liveResult = await claimSchoolRelationExtraction(db, { tenantId: "t", postId: "p", contentHash: "h", staleBefore, now: new Date(2000) });
    expect(liveResult.claimed).toBe(false);
    expect(state).toEqual({ status: "processing", attemptedAt: new Date(900), attempts: 2 });
  });
});
