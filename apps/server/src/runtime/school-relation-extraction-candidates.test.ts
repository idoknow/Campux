import { describe, expect, it } from "bun:test";
import { relationExtractionRetryDelayMs, selectRelationExtractionCandidates } from "./school-relation-extraction-candidates";

const now = new Date("2026-01-01T00:00:00Z");
const candidate = (id: string, checkpoint?: Parameters<typeof selectRelationExtractionCandidates>[0]["candidates"][number]["checkpoint"], contentHash = "h") => checkpoint ? { id, contentHash, checkpoint } : { id, contentHash };

describe("relation-extraction candidate scheduling", () => {
  it("uses capped exponential retry delays", () => {
    expect([1, 2, 3, 4].map((attempt) => relationExtractionRetryDelayMs(attempt, 100, 500))).toEqual([100, 200, 400, 500]);
  });

  it("prioritizes pending work and only retries failed work after its delay", () => {
    const selected = selectRelationExtractionCandidates({ now, limit: 5, candidates: [
      candidate("a", { contentHash: "h", status: "failed", attempts: 1, attemptedAt: new Date(now.getTime() - 30_000) }),
      candidate("b"),
      candidate("c", { contentHash: "h", status: "failed", attempts: 1, attemptedAt: new Date(now.getTime() - 60_000) }),
      candidate("d", { contentHash: "h", status: "complete", attempts: 1, attemptedAt: now }),
      candidate("e", { contentHash: "h", status: "processing", attempts: 1, attemptedAt: now }),
    ] });
    expect(selected.candidates.map(({ id }) => id)).toEqual(["b", "c"]);
  });

  it("treats edited content hashes as fresh work", () => {
    const result = selectRelationExtractionCandidates({ now, limit: 5, candidates: [candidate("p", { contentHash: "old", status: "complete", attempts: 5, attemptedAt: now }, "new")] });
    expect(result.candidates.map(({ id }) => id)).toEqual(["p"]);
  });

  it("rotates from an exclusive cursor to avoid front-of-scan starvation", () => {
    const candidates = ["a", "b", "c"].map((id) => candidate(id, { contentHash: "h", status: "failed", attempts: 1, attemptedAt: new Date(now.getTime() - 60_000) }));
    const first = selectRelationExtractionCandidates({ now, limit: 1, candidates, cursor: "a" });
    const second = selectRelationExtractionCandidates({ now, limit: 1, candidates, cursor: first.nextCursor });
    expect([first.candidates[0]?.id, second.candidates[0]?.id]).toEqual(["b", "c"]);
  });

  it("makes no concurrency guarantee; caller must atomically claim before work", () => {
    const candidates = [candidate("p")];
    const one = selectRelationExtractionCandidates({ now, limit: 1, candidates });
    const two = selectRelationExtractionCandidates({ now, limit: 1, candidates });
    expect(one.candidates).toEqual(two.candidates);
    expect(one.nextCursor).toBe("p");
  });
});
