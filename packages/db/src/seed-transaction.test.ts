import { describe, expect, test } from "bun:test";
import { runSeedInTransaction } from "./seed-transaction";

describe("runSeedInTransaction", () => {
  test("runs the complete seed callback through one transaction client", async () => {
    const events: string[] = [];
    const client = {
      async $transaction<T>(operation: (tx: { write: (value: string) => void }) => Promise<T>) {
        events.push("begin");
        const result = await operation({ write: (value) => events.push(value) });
        events.push("commit");
        return result;
      },
    };

    await runSeedInTransaction(client, async (tx) => {
      tx.write("tenant");
      tx.write("admin");
    });

    expect(events).toEqual(["begin", "tenant", "admin", "commit"]);
  });

  test("does not report a commit when seeding fails after creating the active tenant", async () => {
    const events: string[] = [];
    const client = {
      async $transaction<T>(operation: (tx: { write: (value: string) => void }) => Promise<T>) {
        events.push("begin");
        const result = await operation({ write: (value) => events.push(value) });
        events.push("commit");
        return result;
      },
    };

    await expect(runSeedInTransaction(client, async (tx) => {
      tx.write("active-tenant");
      throw new Error("admin seed failed");
    })).rejects.toThrow("admin seed failed");

    expect(events).toEqual(["begin", "active-tenant"]);
  });
});
