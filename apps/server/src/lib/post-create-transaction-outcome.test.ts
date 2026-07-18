import { describe, expect, test } from "bun:test";
import {
  reconcilePostCreateTransactionOutcome,
  shouldCompensatePostAttachments,
} from "./post-create-transaction-outcome";

describe("reconcilePostCreateTransactionOutcome", () => {
  test("treats a persisted candidate post as committed after an acknowledgement error", async () => {
    const post = { id: "post-1" };
    const outcome = await reconcilePostCreateTransactionOutcome(async () => post);

    expect(outcome).toEqual({ kind: "committed", post });
  });

  test("allows compensation only after a successful read proves the candidate is absent", async () => {
    const outcome = await reconcilePostCreateTransactionOutcome(async () => null);

    expect(outcome).toEqual({ kind: "rolled-back" });
  });

  test("forbids compensation when the commit outcome cannot be read", async () => {
    const outcome = await reconcilePostCreateTransactionOutcome(async () => {
      throw new Error("database unavailable");
    });

    expect(outcome.kind).toBe("unknown");
  });
});

describe("shouldCompensatePostAttachments", () => {
  test("allows cleanup only before persistence or after a positively known rollback", () => {
    expect(shouldCompensatePostAttachments("not-started")).toBe(true);
    expect(shouldCompensatePostAttachments("rolled-back")).toBe(true);
    expect(shouldCompensatePostAttachments("committed")).toBe(false);
    expect(shouldCompensatePostAttachments("unknown")).toBe(false);
  });
});
