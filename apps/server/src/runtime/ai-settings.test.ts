import { describe, expect, test } from "bun:test";
import { DEFAULT_PRIVATE_POST_PROMPT } from "@campux/domain";
import { normalizeAiRules } from "./ai-settings";
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

  test("prefills conservative auto-moderation allowlists without enabling automation", () => {
    const rules = normalizeAiRules(undefined);
    expect(rules.aiReviewMode).toBe("off");
    expect(rules.autoModeration).toMatchObject({ enabled: false, autoApproveEnabled: false, autoRejectEnabled: false, allowedAutoApproveCategories: ["campus_news", "campus_event", "lost_and_found"], allowedAutoRejectCategories: ["scam", "harassment", "personal_information", "dangerous_content"], autoRejectRiskLevels: ["high", "critical"], autoApproveMinimumConfidence: 0.98, autoRejectMinimumConfidence: 0.99 });
  });

  test("normalizes per-operation thresholds and risk mappings", () => {
    expect(normalizeAiRules({ autoModeration: { autoApproveMinimumConfidence: 0.95, autoRejectMinimumConfidence: 0.995, autoRejectRiskLevels: ["low", "critical", "high"] } }).autoModeration).toMatchObject({ autoApproveMinimumConfidence: 0.95, autoRejectMinimumConfidence: 0.995, autoRejectRiskLevels: ["critical", "high"] });
    expect(normalizeAiRules({ autoModeration: { autoApproveMinimumConfidence: 4, autoRejectMinimumConfidence: "bad" } }).autoModeration).toMatchObject({ autoApproveMinimumConfidence: 1, autoRejectMinimumConfidence: 0.99 });
  });

  test("settings API accepts operation thresholds and constrained risk mapping", () => {
    expect(aiSettingsSchema.safeParse({ rules: { autoModeration: { autoApproveMinimumConfidence: 0.96, autoRejectMinimumConfidence: 0.995, autoRejectRiskLevels: ["high", "critical"], allowedAutoRejectCategories: ["scam"] } } }).success).toBe(true);
    expect(aiSettingsSchema.safeParse({ rules: { autoModeration: { autoRejectRiskLevels: ["low"] } } }).success).toBe(false);
  });
});
