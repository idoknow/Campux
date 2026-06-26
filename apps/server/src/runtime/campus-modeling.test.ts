import { describe, expect, test } from "bun:test";
import { DEFAULT_PRIVATE_POST_PROMPT } from "@campux/domain";
import { normalizeAiRules } from "./campus-modeling";

describe("AI settings normalization", () => {
  test("uses built-in private post prompt when rules are missing", () => {
    expect(normalizeAiRules(undefined).privatePostPrompt).toBe(DEFAULT_PRIVATE_POST_PROMPT);
  });

  test("uses built-in private post prompt when stored prompt is blank", () => {
    expect(normalizeAiRules({ privatePostPrompt: "  \n  " }).privatePostPrompt).toBe(DEFAULT_PRIVATE_POST_PROMPT);
  });

  test("keeps custom private post prompt editable", () => {
    expect(normalizeAiRules({ privatePostPrompt: " 自定义提示词 " }).privatePostPrompt).toBe("自定义提示词");
  });
});
