import { describe, expect, test } from "bun:test";
import { detectPostInjection, validateFont } from "./sanitize";

describe("validateFont", () => {
  test("accepts empty and default font values", () => {
    expect(validateFont(undefined)).toBe(true);
    expect(validateFont(null)).toBe(true);
    expect(validateFont("")).toBe(true);
    expect(validateFont("default")).toBe(true);
  });

  test("rejects unknown font values", () => {
    expect(validateFont("Comic Sans MS")).toBe(false);
  });
});

describe("detectPostInjection font validation", () => {
  test("does not flag the default font as unsafe", () => {
    expect(detectPostInjection({ text: "正常投稿", font: "default" })).toEqual({ detected: false });
  });

  test("flags unknown font values as unsafe", () => {
    expect(detectPostInjection({ text: "正常投稿", font: "Comic Sans MS" })).toEqual({
      detected: true,
      type: "css_injection",
      reason: "不允许的字体：Comic Sans MS",
    });
  });
});
