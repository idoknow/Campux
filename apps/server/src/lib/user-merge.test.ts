import { describe, expect, it } from "bun:test";
import { resolveActiveAccount, shouldPromptAccountMerge, UserMergeError } from "./user-merge";

/**
 * `resolveActiveAccount` 接受任意 Prisma 客户端，这里用最小内存桩驱动真实实现，
 * 避免「在测试里重写一遍算法」这种自我验证。
 */
type Row = { id: string; mergedAt: Date | null; mergedIntoUserId: string | null };

function makeClient(rows: Row[]) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const calls: string[] = [];
  const client = {
    user: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        calls.push(where.id);
        return byId.get(where.id) ?? null;
      },
    },
  };
  return { client, calls };
}

describe("resolveActiveAccount", () => {
  it("returns the account itself when it was never merged", async () => {
    const { client } = makeClient([{ id: "a", mergedAt: null, mergedIntoUserId: null }]);
    expect(await resolveActiveAccount(client as never, { id: "a", mergedAt: null, mergedIntoUserId: null }))
      .toEqual({ userId: "a", redirectedFrom: null });
  });

  it("redirects a merged old account to its target", async () => {
    const { client } = makeClient([
      { id: "new", mergedAt: null, mergedIntoUserId: null },
    ]);
    expect(await resolveActiveAccount(client as never, { id: "old", mergedAt: new Date(), mergedIntoUserId: "new" }))
      .toEqual({ userId: "new", redirectedFrom: "old" });
  });

  it("follows a chain of merges to the final account", async () => {
    const { client } = makeClient([
      { id: "b", mergedAt: new Date(), mergedIntoUserId: "c" },
      { id: "c", mergedAt: null, mergedIntoUserId: null },
    ]);
    expect(await resolveActiveAccount(client as never, { id: "a", mergedAt: new Date(), mergedIntoUserId: "b" }))
      .toEqual({ userId: "c", redirectedFrom: "a" });
  });

  it("falls back to the old account when the target no longer exists", async () => {
    const { client } = makeClient([]);
    expect(await resolveActiveAccount(client as never, { id: "old", mergedAt: new Date(), mergedIntoUserId: "gone" }))
      .toEqual({ userId: "old", redirectedFrom: null });
  });

  it("stops following a cycle instead of looping forever", async () => {
    const { client, calls } = makeClient([
      { id: "a", mergedAt: new Date(), mergedIntoUserId: "b" },
      { id: "b", mergedAt: new Date(), mergedIntoUserId: "a" },
    ]);
    const result = await resolveActiveAccount(client as never, { id: "a", mergedAt: new Date(), mergedIntoUserId: "b" });
    // 成环时退回旧号本身，而不是返回一个未经校验的中间账号。
    expect(result).toEqual({ userId: "a", redirectedFrom: null });
    expect(calls.length).toBeLessThanOrEqual(32);
  });

  it("follows long merge chains all the way to the active account", async () => {
    // 10 级链：早期实现只有 5 跳，会把用户登进一个已被停用的中间账号。
    const users = Array.from({ length: 11 }, (_, index) => ({
      id: `u${index}`,
      mergedAt: index === 10 ? null : new Date(),
      mergedIntoUserId: index === 10 ? null : `u${index + 1}`,
    }));
    const { client } = makeClient(users);
    const result = await resolveActiveAccount(client as never, {
      id: "u0",
      mergedAt: new Date(),
      mergedIntoUserId: "u1",
    });
    expect(result).toEqual({ userId: "u10", redirectedFrom: "u0" });
  });
});

describe("shouldPromptAccountMerge", () => {
  it("prompts only for unbound, unmerged accounts", () => {
    expect(shouldPromptAccountMerge({ email: null, mergedAt: null })).toBe(true);
  });

  it("does not prompt once the account has an email", () => {
    expect(shouldPromptAccountMerge({ email: "a@qq.com", mergedAt: null })).toBe(false);
  });

  it("does not prompt for already-merged accounts", () => {
    expect(shouldPromptAccountMerge({ email: null, mergedAt: new Date() })).toBe(false);
  });
});

describe("UserMergeError CODE_STALE", () => {
  it("carries the CODE_STALE code for the transactional consumption guard", () => {
    // 消费并入合并事务后，验证码失效通过这个错误码回滚整个合并。
    const error = new UserMergeError("验证码已失效，请重新获取后重试", "CODE_STALE");
    expect(error.code).toBe("CODE_STALE");
    expect(error.message).toBe("验证码已失效，请重新获取后重试");
    expect(error instanceof UserMergeError).toBe(true);
  });
});
