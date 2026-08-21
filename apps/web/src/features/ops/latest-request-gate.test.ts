import { describe, expect, test } from "bun:test";
import { createLatestRequestGate } from "./latest-request-gate";

describe("createLatestRequestGate", () => {
  test("accepts only the newest overlapping request", () => {
    const gate = createLatestRequestGate();
    const older = gate.begin();
    const newer = gate.begin();

    expect(gate.isCurrent(older)).toBe(false);
    expect(gate.isCurrent(newer)).toBe(true);
  });

  test("invalidates in-flight reads after a mutation response", () => {
    const gate = createLatestRequestGate();
    const read = gate.begin();

    gate.invalidate();

    expect(gate.isCurrent(read)).toBe(false);
  });
});
