import { describe, expect, test } from "bun:test";
import { PRIVATE_POST_PROMPT_MAX_LENGTH } from "@campux/domain";
import { aiSettingsSchema } from "./ai";

describe("AI settings schema", () => {
  test("trims private post prompt before enforcing max length", () => {
    const prompt = "稿".repeat(PRIVATE_POST_PROMPT_MAX_LENGTH - 5);
    const parsed = aiSettingsSchema.parse({
      rules: {
        privatePostPrompt: `${prompt}     `,
      },
    });

    expect(parsed.rules?.privatePostPrompt).toBe(prompt);
  });

  test("rejects private post prompt over the shared max length after trim", () => {
    expect(() => aiSettingsSchema.parse({
      rules: {
        privatePostPrompt: "稿".repeat(PRIVATE_POST_PROMPT_MAX_LENGTH + 1),
      },
    })).toThrow();
  });
});