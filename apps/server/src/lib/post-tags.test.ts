import { describe, expect, test } from "bun:test";
import { normalizeTagName, tagColorForName } from "./post-tags";

describe("post tag normalization", () => {
  test("normalizes tag names", () => {
    expect(normalizeTagName("  ##高考   志愿  ")).toBe("高考 志愿");
    expect(normalizeTagName("")).toBe("");
  });

  test("picks a stable palette color for names", () => {
    expect(tagColorForName("高考志愿")).toMatch(/^#[0-9a-f]{6}$/);
    expect(tagColorForName("高考志愿")).toBe(tagColorForName("高考志愿"));
  });
});
