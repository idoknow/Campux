import { describe, expect, it } from "bun:test";
import { isFinalizedAiFeedbackOutcome } from "./review";

describe("isFinalizedAiFeedbackOutcome", () => {
  it("accepts finalized outcomes but rejects pending and cancelled posts", () => {
    expect(isFinalizedAiFeedbackOutcome("approved")).toBe(true);
    expect(isFinalizedAiFeedbackOutcome("published")).toBe(true);
    expect(isFinalizedAiFeedbackOutcome("publishing")).toBe(true);
    expect(isFinalizedAiFeedbackOutcome("partially_failed")).toBe(true);
    expect(isFinalizedAiFeedbackOutcome("rejected")).toBe(true);
    expect(isFinalizedAiFeedbackOutcome("pending_approval")).toBe(false);
    expect(isFinalizedAiFeedbackOutcome("cancelled")).toBe(false);
  });
});
