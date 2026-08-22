import { describe, expect, test } from "bun:test";
import { runWithActiveTenantLease } from "./tenant-runtime-lease";

describe("runWithActiveTenantLease", () => {
  test("locks the tenant row and keeps the lease through the external side effect", async () => {
    const sequence: string[] = [];
    const transaction = {
      $executeRaw: async () => {
        sequence.push("lock");
        return 1;
      },
      tenant: {
        findUnique: async () => ({ status: "active" }),
      },
    };
    const client = {
      $transaction: async (run: (tx: unknown) => Promise<unknown>) => {
        const value = await run(transaction);
        sequence.push("commit");
        return value;
      },
    };

    const result = await runWithActiveTenantLease(client as never, "tenant-active", async (leasedTransaction: unknown) => {
      expect(leasedTransaction).toBe(transaction as never);
      sequence.push("egress");
      return "published";
    });

    expect(result).toEqual({ active: true, value: "published" });
    expect(sequence).toEqual(["lock", "egress", "commit"]);
  });

  test("does not run the side effect when the locked tenant is inactive", async () => {
    let called = false;
    const client = {
      $transaction: async (run: (tx: unknown) => Promise<unknown>) => run({
        $executeRaw: async () => 1,
        tenant: {
          findUnique: async () => ({ status: "paused" }),
        },
      }),
    };

    const result = await runWithActiveTenantLease(client as never, "tenant-paused", async () => {
      called = true;
      return "published";
    });

    expect(result).toEqual({ active: false });
    expect(called).toBe(false);
  });
});
