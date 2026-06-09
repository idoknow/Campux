import { describe, expect, test } from "bun:test";
import { sanitizePublishSummary, publishSummaryMaxChars } from "./publish-summary";

describe("sanitizePublishSummary", () => {
  test("trims, collapses whitespace, strips wrapping quotes and trailing punctuation", () => {
    expect(sanitizePublishSummary("  “食堂今天免费\n加餐”。 ")).toBe("食堂今天免费 加餐");
  });

  test("keeps short text within the limit unchanged", () => {
    expect(sanitizePublishSummary("寻找失物")).toBe("寻找失物");
  });

  test("hard-truncates to max chars (≤16)", () => {
    const long = "一二三四五六七八九十一二三四五六七八九十"; // 20 chars
    const out = sanitizePublishSummary(long);
    expect(Array.from(out)).toHaveLength(publishSummaryMaxChars);
    expect(out).toBe("一二三四五六七八九十一二三四五六");
  });

  test("respects a custom max", () => {
    expect(sanitizePublishSummary("一二三四五六", 4)).toBe("一二三四");
  });

  test("empty / whitespace-only returns empty string", () => {
    expect(sanitizePublishSummary("   \n  ")).toBe("");
    expect(sanitizePublishSummary("")).toBe("");
  });

  test("does not split a surrogate-pair grapheme at the boundary", () => {
    // 16 emoji, each a surrogate pair; must keep whole emoji, never half.
    const emoji = "😀".repeat(20);
    const out = sanitizePublishSummary(emoji);
    expect(Array.from(out).every((c) => c === "😀")).toBe(true);
    expect(Array.from(out).length).toBeLessThanOrEqual(publishSummaryMaxChars);
  });
});
