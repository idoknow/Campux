import { describe, expect, test } from "bun:test";
import { normalizeTagIds, normalizeTagName, normalizeTagNames } from "./post-tags";

describe("post tag normalization", () => {
  test("normalizes tag names", () => {
    expect(normalizeTagName("  ##高考   志愿  ")).toBe("高考 志愿");
    expect(normalizeTagName("")).toBe("");
  });

  test("deduplicates names and ids", () => {
    expect(normalizeTagNames(["高考志愿", "#高考志愿", "失物"])).toEqual(["高考志愿", "失物"]);
    expect(normalizeTagIds(["a", "a", "b", 3])).toEqual(["a", "b"]);
  });
});
