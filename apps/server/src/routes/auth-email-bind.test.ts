import { describe, expect, test } from "bun:test";
import { bindEmailSchema } from "./auth";

describe("bind email schema", () => {
  test("accepts a normal email address", () => {
    expect(bindEmailSchema.safeParse("user@example.com").success).toBe(true);
  });

  test("trims surrounding whitespace", () => {
    expect(bindEmailSchema.parse("  user@example.com  ")).toBe("user@example.com");
  });

  test("rejects an address without a domain suffix", () => {
    expect(bindEmailSchema.safeParse("user@example").success).toBe(false);
  });

  test("rejects an address without a local part", () => {
    expect(bindEmailSchema.safeParse("@example.com").success).toBe(false);
  });

  test("rejects an address with whitespace inside", () => {
    expect(bindEmailSchema.safeParse("user name@example.com").success).toBe(false);
  });
});
