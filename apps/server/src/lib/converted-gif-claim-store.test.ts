import { describe, expect, test } from "bun:test";
import {
  ConvertedGifClaimStore,
  ConvertedGifClaimUnavailableError,
  type ConvertedGifClaimSetting,
} from "./converted-gif-claim-store";

function createMemoryStore() {
  const records = new Map<string, ConvertedGifClaimSetting>();
  const posts = new Set<string>();
  const transaction = async <T>(callback: (tx: {
    findExistingKeys(keys: string[]): Promise<string[]>;
    deleteByKeys(keys: string[]): Promise<number>;
  }) => Promise<T>): Promise<T> => {
    const recordSnapshot = new Map(records);
    const postSnapshot = new Set(posts);
    try {
      return await callback({
        findExistingKeys: async (keys) => keys.filter((key) => records.has(key)),
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
      for (const [key, setting] of recordSnapshot) records.set(key, setting);
      posts.clear();
      for (const postId of postSnapshot) posts.add(postId);
      throw error;
    }
  };
  const store = new ConvertedGifClaimStore({
    transaction,
    pruneAndCreate: async (cutoff, setting) => {
      for (const [key, record] of records) {
        if (new Date(record.value.expiresAt).getTime() <= cutoff.getTime()) {
          records.delete(key);
        }
      }
      records.set(setting.key, setting);
    },
  });
  return { posts, records, store, transaction };
}

const now = new Date("2026-07-17T12:00:00.000Z").getTime();
const proof = `${now + 15 * 60 * 1000}.deterministic_nonce_123.signature`;

describe("ConvertedGifClaimStore", () => {
  test("consumes a claim exactly once", async () => {
    const { store } = createMemoryStore();
    await store.issue(proof, now);

    expect(await store.consume([proof])).toHaveLength(1);
    await expect(store.consume([proof])).rejects.toBeInstanceOf(ConvertedGifClaimUnavailableError);
  });

  test("rejects a replay during preflight without consuming other available claims", async () => {
    const { store } = createMemoryStore();
    const replayed = `${now + 15 * 60 * 1000}.replayed_nonce_value_123.signature`;
    await store.issue(proof, now);
    await store.issue(replayed, now);
    await store.consume([replayed]);

    await expect(store.assertAvailable([proof, replayed])).rejects.toMatchObject({
      unavailableIndexes: [1],
    });
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

    await expect(store.consume([proof, unavailable])).rejects.toMatchObject({
      unavailableIndexes: [1],
    });
    expect(await store.consume([proof])).toHaveLength(1);
  });

  test("rolls claim consumption back when the later post write fails", async () => {
    const { posts, store, transaction } = createMemoryStore();
    await store.issue(proof, now);

    await expect(transaction(async (tx) => {
      await store.consumeUsing([proof], tx);
      posts.add("candidate-post");
      throw new Error("post write failed");
    })).rejects.toThrow("post write failed");

    expect(posts.size).toBe(0);
    expect(await store.consume([proof])).toHaveLength(1);
  });

  test("consumes through a caller-provided transaction without opening a nested transaction", async () => {
    const records = new Map<string, ConvertedGifClaimSetting>();
    const store = new ConvertedGifClaimStore({
      transaction: async () => {
        throw new Error("nested transaction must not be opened");
      },
      pruneAndCreate: async (_cutoff, setting) => {
        records.set(setting.key, setting);
      },
    });
    await store.issue(proof, now);

    const consumed = await store.consumeUsing([proof], {
      findExistingKeys: async (keys) => keys.filter((key) => records.has(key)),
      deleteByKeys: async (keys) => {
        let count = 0;
        for (const key of keys) {
          if (records.delete(key)) count += 1;
        }
        return count;
      },
    });

    expect(consumed).toHaveLength(1);
    expect(records.size).toBe(0);
  });
});
