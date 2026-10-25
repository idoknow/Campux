import { describe, expect, it } from "bun:test";
import { isFinalizedAiFeedbackOutcome } from "./review";

describe("isFinalizedAiFeedbackOutcome", () => {
  it("accepts approved posts after publication progresses", () => {
    expect(isFinalizedAiFeedbackOutcome("published", "approve")).toBe(true);
    expect(isFinalizedAiFeedbackOutcome("publishing", "approve")).toBe(true);
    expect(isFinalizedAiFeedbackOutcome("rejected", "approve")).toBe(false);
  });

  it("accepts rejected posts only for a rejection decision", () => {
    expect(isFinalizedAiFeedbackOutcome("rejected", "reject")).toBe(true);
    expect(isFinalizedAiFeedbackOutcome("approved", "reject")).toBe(false);
  });
});
