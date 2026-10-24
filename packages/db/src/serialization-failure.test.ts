import { describe, expect, test } from "bun:test";
import { isPrismaKnownRequestError, isTransactionSerializationFailure } from "./index";
import { clientModule } from "./provider";

const knownError = (code: string, message: string) =>
  new clientModule.Prisma.PrismaClientKnownRequestError(message, { code, clientVersion: "test" });

describe("isTransactionSerializationFailure", () => {
  test("matches P2034 write conflicts and P2028 expired transactions", () => {
    const conflict = knownError("P2034", "Transaction failed due to a write conflict or a deadlock");
    expect(isTransactionSerializationFailure(conflict)).toBe(true);
    // 事务超时后仍在其上执行：事务已整体回滚，整个操作可安全重试
    const expired = knownError(
      "P2028",
      "Transaction API error: Transaction already closed: A query cannot be executed on an expired transaction",
    );
    expect(isTransactionSerializationFailure(expired)).toBe(true);
  });

  test("ignores P2028 errors that do not indicate transaction expiry", () => {
    // 事务 API 其他故障的提交结果未知（可能已提交），重试会重放已提交的工作
    expect(isTransactionSerializationFailure(knownError("P2028", "Transaction API error: connection reset during commit"))).toBe(false);
    expect(isTransactionSerializationFailure(knownError("P2028", ""))).toBe(false);
  });

  test("matches P2010 raw query failures carrying Postgres 40001", () => {
    // $executeRaw 的底层序列化冲突不会被 Prisma 映射为 P2034，只会包在 P2010 的 message 里
    const error = knownError(
      "P2010",
      "Invalid `prisma.$executeRaw()` invocation:\n\nRaw query failed. Code: `40001`. Message: `could not serialize access due to concurrent update`",
    );
    expect(isTransactionSerializationFailure(error)).toBe(true);
  });

  test("matches P2010 deadlocks and sqlite busy errors", () => {
    expect(isTransactionSerializationFailure(knownError("P2010", "Raw query failed. Code: `40P01`. Message: `deadlock detected`"))).toBe(true);
    expect(isTransactionSerializationFailure(knownError("P2010", "Raw query failed. Code: `SQLITE_BUSY`. Message: `database is locked`"))).toBe(true);
  });

  test("ignores raw query failures unrelated to serialization", () => {
    expect(isTransactionSerializationFailure(knownError("P2010", "Raw query failed. Code: `42P01`. Message: `relation \"Foo\" does not exist`"))).toBe(false);
    expect(isTransactionSerializationFailure(knownError("P2010", "Raw query failed. Code: `23505`. Message: `duplicate key value`"))).toBe(false);
  });

  test("ignores other Prisma and non-Prisma errors", () => {
    expect(isTransactionSerializationFailure(knownError("P2002", "Unique constraint failed"))).toBe(false);
    expect(isTransactionSerializationFailure(new Error("could not serialize access"))).toBe(false);
    expect(isTransactionSerializationFailure(null)).toBe(false);
  });

  test("runtime client errors pass isPrismaKnownRequestError", () => {
    expect(isPrismaKnownRequestError(knownError("P2010", "Raw query failed"))).toBe(true);
  });
});
