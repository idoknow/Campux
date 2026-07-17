import { describe, expect, test } from "bun:test";
import {
  ConvertedGifClaimStore,
  ConvertedGifClaimUnavailableError,
  type ConvertedGifClaimSetting,
} from "./converted-gif-claim-store";

function createMemoryStore() {
  const records = new Map<string, ConvertedGifClaimSetting>();
  const store = new ConvertedGifClaimStore({
    transaction: async (callback) => {
      const snapshot = new Map(records);
      try {
        return await callback({
          deleteByKeys: async (keys) => {
            let count = 0;
            for (const key of keys) {
              if (records.delete(key)) count += 1;
            }
            return count;
          },
        });
      } catch (error) {
        records.clear();
        for (const [key, setting] of snapshot) records.set(key, setting);
        throw error;
      }
    },
    pruneAndCreate: async (cutoff, setting) => {
      for (const [key, record] of records) {
        if (new Date(record.value.expiresAt).getTime() <= cutoff.getTime()) {
          records.delete(key);
        }
      }
      records.set(setting.key, setting);
    },
    restore: async (settings) => {
      for (const setting of settings) records.set(setting.key, setting);
    },
  });
  return { records, store };
}

const now = new Date("2026-07-17T12:00:00.000Z").getTime();
const proof = `${now + 15 * 60 * 1000}.deterministic_nonce_123.signature`;

describe("ConvertedGifClaimStore", () => {
  test("consumes a claim once and permits an explicit retry rollback", async () => {
    const { store } = createMemoryStore();
    await store.issue(proof, now);

    const consumed = await store.consume([proof]);
    await expect(store.consume([proof])).rejects.toBeInstanceOf(ConvertedGifClaimUnavailableError);

    await store.restore(consumed);
    expect(await store.consume([proof])).toHaveLength(1);
  });

  test("rejects duplicate proofs without consuming the valid record", async () => {
    const { store } = createMemoryStore();
    await store.issue(proof, now);

    await expect(store.consume([proof, proof])).rejects.toBeInstanceOf(ConvertedGifClaimUnavailableError);
    expect(await store.consume([proof])).toHaveLength(1);
  });

  test("rolls back partial deletion when any claim is unavailable", async () => {
    const { store } = createMemoryStore();
    await store.issue(proof, now);
    const unavailable = `${now + 15 * 60 * 1000}.another_nonce_value_123.signature`;

    await expect(store.consume([proof, unavailable])).rejects.toBeInstanceOf(ConvertedGifClaimUnavailableError);
    expect(await store.consume([proof])).toHaveLength(1);
  });
});
