import { describe, expect, test } from "bun:test";
import { DEFAULT_PRIVATE_POST_PROMPT } from "@campux/domain";
import { normalizeAiRules, mergeAiRules } from "./ai-settings";
import { aiSettingsSchema } from "../routes/ai";

describe("AI settings normalization", () => {
  test("defaults AI review to off and only accepts supported modes", () => {
    expect(normalizeAiRules(undefined).aiReviewMode).toBe("off");
    expect(normalizeAiRules({ aiReviewMode: "shadow" }).aiReviewMode).toBe("shadow");
    expect(normalizeAiRules({ aiReviewMode: "assist" }).aiReviewMode).toBe("assist");
    expect(normalizeAiRules({ aiReviewMode: "auto" }).aiReviewMode).toBe("auto");

    expect(normalizeAiRules({ aiReviewMode: "auto_approve" }).aiReviewMode).toBe("off");
  });

  test("uses built-in private post prompt when rules are missing", () => {
    expect(normalizeAiRules(undefined).privatePostPrompt).toBe(DEFAULT_PRIVATE_POST_PROMPT);
  });

  test("uses built-in private post prompt when stored prompt is blank", () => {
    expect(normalizeAiRules({ privatePostPrompt: "  \n  " }).privatePostPrompt).toBe(DEFAULT_PRIVATE_POST_PROMPT);
  });

  test("keeps custom private post prompt editable", () => {
    expect(normalizeAiRules({ privatePostPrompt: " 自定义提示词 " }).privatePostPrompt).toBe("自定义提示词");
  });

  test("automatic moderation settings no longer include category allowlists or reject patterns", () => {
    const rules = normalizeAiRules(undefined);
    expect(rules.aiReviewMode).toBe("off");
    expect(rules.autoModeration).toMatchObject({ enabled: false, autoApproveEnabled: false, autoRejectEnabled: false, autoApproveMinimumConfidence: 0.98, autoRejectMinimumConfidence: 0.99 });
    expect(rules.autoModeration).not.toHaveProperty("allowedAutoApproveCategories");
    expect(rules.autoModeration).not.toHaveProperty("allowedAutoRejectCategories");
    expect(rules.autoModeration).not.toHaveProperty("blockedPatterns");
    expect(rules.autoModeration).not.toHaveProperty("minimumValidatedSamples");
  });

  test("normalizes approval and rejection confidence thresholds", () => {
    expect(normalizeAiRules({ autoModeration: { autoApproveMinimumConfidence: 0.95, autoRejectMinimumConfidence: 0.995 } }).autoModeration).toMatchObject({ autoApproveMinimumConfidence: 0.95, autoRejectMinimumConfidence: 0.995 });
    expect(normalizeAiRules({ autoModeration: { autoApproveMinimumConfidence: 4, autoRejectMinimumConfidence: "bad" } }).autoModeration).toMatchObject({ autoApproveMinimumConfidence: 1, autoRejectMinimumConfidence: 0.99 });
  });

  test("settings API accepts operation confidence thresholds", () => {
    expect(aiSettingsSchema.safeParse({ rules: { autoModeration: { autoApproveMinimumConfidence: 0.96, autoRejectMinimumConfidence: 0.995 } } }).success).toBe(true);
  });

  test("partial rule updates keep the saved rules and merge nested objects", () => {
    const saved = normalizeAiRules({ aiReviewMode: "auto", aiReviewConcurrency: 4, postTaggingEnabled: true, autoModeration: { enabled: true, delaySeconds: 60 } });
    const merged = normalizeAiRules(mergeAiRules(saved, { aiReviewConcurrency: 3 }));
    expect(merged.aiReviewMode).toBe("auto");
    expect(merged.aiReviewConcurrency).toBe(3);
    expect(merged.postTaggingEnabled).toBe(true);
    expect(merged.autoModeration).toMatchObject({ enabled: true, delaySeconds: 60 });

    const nested = normalizeAiRules(mergeAiRules(saved, { autoModeration: { delaySeconds: 90 } }));
    expect(nested.autoModeration).toMatchObject({ enabled: true, delaySeconds: 90 });
  });
});
