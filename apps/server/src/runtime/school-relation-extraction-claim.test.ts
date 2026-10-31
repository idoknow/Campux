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

  it("does not steal a live or completed checkpoint", async () => {
    const db = { schoolRelationExtraction: {
      createMany: async () => ({ count: 0 }),
      updateMany: async () => ({ count: 0 }),
    } };
    const result = await claimSchoolRelationExtraction(db, { tenantId: "t", postId: "p", contentHash: "h", staleBefore: new Date(0), now: new Date(1000) });
    expect(result.claimed).toBe(false);
  });

  it("reclaims expired processing claims with conditional update", async () => {
    const wheres: unknown[] = [];
    let attempt = 0;
    const db = { schoolRelationExtraction: {
      createMany: async () => ({ count: 0 }),
      updateMany: async ({ where }: { where: unknown }) => { wheres.push(where); return { count: ++attempt === 2 ? 1 : 0 }; },
    } };
    const staleBefore = new Date(500);
    const result = await claimSchoolRelationExtraction(db, { tenantId: "t", postId: "p", contentHash: "h", staleBefore, now: new Date(1000) });
    expect(result.claimed).toBe(true);
    expect(wheres[1]).toEqual({ tenantId: "t", postId: "p", contentHash: "h", status: "processing", attemptedAt: { lt: staleBefore } });
  });
});
