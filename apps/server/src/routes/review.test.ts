import { describe, expect, it } from "bun:test";
import { isFinalizedAiFeedbackOutcome } from "./review";

describe("isFinalizedAiFeedbackOutcome", () => {
  it("accepts only outcome statuses matching the submitted action", () => {
    expect(isFinalizedAiFeedbackOutcome("approved", "approve")).toBe(true);
    expect(isFinalizedAiFeedbackOutcome("published", "approve")).toBe(true);
    expect(isFinalizedAiFeedbackOutcome("publishing", "approve")).toBe(true);
    expect(isFinalizedAiFeedbackOutcome("partially_failed", "approve")).toBe(true);
    expect(isFinalizedAiFeedbackOutcome("rejected", "reject")).toBe(true);
    expect(isFinalizedAiFeedbackOutcome("published", "reject")).toBe(false);
    expect(isFinalizedAiFeedbackOutcome("approved", "reject")).toBe(false);
    expect(isFinalizedAiFeedbackOutcome("rejected", "approve")).toBe(false);
    expect(isFinalizedAiFeedbackOutcome("pending_approval", "approve")).toBe(false);
    expect(isFinalizedAiFeedbackOutcome("pending_approval", "reject")).toBe(false);
    expect(isFinalizedAiFeedbackOutcome("cancelled", "approve")).toBe(false);
    expect(isFinalizedAiFeedbackOutcome("cancelled", "reject")).toBe(false);
  });
});
