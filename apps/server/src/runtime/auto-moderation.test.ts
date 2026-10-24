import { describe, expect, test } from "bun:test";
import type { PostReviewAssessment } from "./post-review";
import { evaluateAutoModerationDecision, type AutoModerationPolicy } from "./auto-moderation";

const policy: AutoModerationPolicy = { enabled: true, autoApproveEnabled: true, autoRejectEnabled: true, allowedAutoApproveCategories: ["campus_news"], blockedPatterns: ["直接转账"], minimumConfidence: 0.98, minimumValidatedSamples: 100, delaySeconds: 60, globalKillSwitch: false };
const assessment = (overrides: Partial<PostReviewAssessment> = {}): PostReviewAssessment => ({ riskLevel: "low", categories: ["campus_news"], sensitiveFindings: [], suggestedAction: "approve", reasons: [], confidence: 0.99, maskedText: null, rewrittenText: null, rejectionReason: null, ...overrides });
const signals = { validatedSamples: 200, matchedCategoryRates: { campus_news: { total: 120, matched: 119 } } };

describe("automatic moderation safety gates", () => {
  test("approves only a calibrated, whitelisted low-risk case", () => expect(evaluateAutoModerationDecision({ assessment: assessment(), policy, signals, postText: "校园新闻" }).action).toBe("approve"));
  test("fails closed on critical findings regardless of the model suggestion", () => expect(evaluateAutoModerationDecision({ assessment: assessment({ riskLevel: "critical", suggestedAction: "reject" }), policy, signals, postText: "直接转账" }).action).toBe("manual_review"));
  test("rejects only a low-risk case when an explicit configured pattern matches", () => expect(evaluateAutoModerationDecision({ assessment: assessment({ riskLevel: "low", suggestedAction: "reject" }), policy, signals, postText: "要求直接转账" }).action).toBe("reject"));
  test("keeps matching blocked patterns in manual review for high-risk or sensitive findings", () => {
    for (const unsafe of [
      assessment({ riskLevel: "high", suggestedAction: "reject" }),
      assessment({ sensitiveFindings: [{ type: "phone", excerpt: "138****", reason: "手机号" }], suggestedAction: "reject" }),
    ]) {
      expect(evaluateAutoModerationDecision({ assessment: unsafe, policy, signals, postText: "要求直接转账" }).action).toBe("manual_review");
    }
  });
  test("does not reject on model suggestion alone", () => expect(evaluateAutoModerationDecision({ assessment: assessment({ suggestedAction: "reject" }), policy, signals, postText: "一般内容" }).action).toBe("manual_review"));
  test("falls back to review when calibration is missing", () => expect(evaluateAutoModerationDecision({ assessment: assessment(), policy, signals: { ...signals, validatedSamples: 0 }, postText: "校园新闻" }).action).toBe("manual_review"));
});
