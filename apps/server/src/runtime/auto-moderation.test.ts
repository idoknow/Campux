import { describe, expect, test } from "bun:test";
import type { PostReviewAssessment } from "./post-review";
import { classifyHighRiskPostIntent, evaluateAutoModerationDecision, type AutoModerationPolicy } from "./auto-moderation";

const policy: AutoModerationPolicy = { enabled: true, autoApproveEnabled: true, autoRejectEnabled: true, minimumConfidence: 0.98, autoApproveMinimumConfidence: 0.98, autoRejectMinimumConfidence: 0.99, delaySeconds: 60, globalKillSwitch: false };
const assessment = (overrides: Partial<PostReviewAssessment> = {}): PostReviewAssessment => ({ schemaVersion: 1, riskLevel: "low", categories: ["campus_news"], sensitiveFindings: [], suggestedAction: "approve", reasons: [], confidence: 0.99, maskedText: null, rewrittenText: null, rejectionReason: null, ...overrides });
const signals = { validatedSamples: 200, matchedCategoryRates: { campus_news: { total: 120, matched: 119 } } };
const evaluate = (a = assessment(), p = policy, s = signals, text = "校园新闻") => evaluateAutoModerationDecision({ assessment: a, policy: p, signals: s, postText: text });

describe("automatic moderation explicit policy trace", () => {
  test("traces successful low-risk approval", () => {
    const result = evaluate();
    expect(result).toMatchObject({ action: "approve", reason: "低风险、AI 建议通过且达到置信度门槛", trace: { finalAction: "approve" } });
    expect(result.trace.rules.map((r) => r.ruleId)).toEqual(["policy.enabled", "policy.kill_switch", "assessment.risk", "assessment.sensitive_findings", "approve.enabled", "assessment.confidence", "assessment.suggested_action"]);
    expect(result.trace.rules.every((r) => ["pass", "fail", "indeterminate"].includes(r.outcome))).toBe(true);
  });
  test("traces disabled and kill switch as manual review", () => {
    expect(evaluate(assessment(), { ...policy, enabled: false }).trace.rules[0]).toMatchObject({ ruleId: "policy.enabled", outcome: "fail" });
    expect(evaluate(assessment(), { ...policy, globalKillSwitch: true }).trace.rules[1]).toMatchObject({ ruleId: "policy.kill_switch", outcome: "fail" });
    expect(evaluate(assessment(), { ...policy, enabled: false }).reason).toBe("自动审核已关闭或触发全局紧急停止");
  });
  test("risk and sensitive findings fail closed", () => {
    for (const a of [assessment({ riskLevel: "high" }), assessment({ sensitiveFindings: [{ type: "phone", excerpt: "138****", reason: "手机号" }] })]) {
      expect(evaluate(a).action).toBe("manual_review");
      expect(evaluate(a).trace.rules.find((r) => r.ruleId === "assessment.risk" || r.ruleId === "assessment.sensitive_findings")?.outcome).toBe("fail");
    }
  });
  test("high/medium reject recommendations auto-reject above confidence, others stay manual", () => {
    const highText = "有人招募同学做刷单冲销量，先下单退款，联系我每单付费。";
    const highReject = assessment({ riskLevel: "high", suggestedAction: "reject", confidence: 0.95, rejectionReason: "疑似刷单返佣招募。" });
    expect(evaluate(highReject, policy, signals, highText)).toMatchObject({ action: "reject", reason: "疑似刷单返佣招募。" });
    expect(evaluate(assessment({ ...highReject, confidence: 0.94 }), policy, signals, highText).action).toBe("manual_review");
    expect(evaluate(assessment({ riskLevel: "medium", suggestedAction: "reject", confidence: 0.96, rejectionReason: "中风险拒绝理由。" })).reason).toBe("中风险拒绝理由。");
    expect(evaluate(assessment({ riskLevel: "medium", suggestedAction: "reject", confidence: 0.94 })).action).toBe("manual_review");
    expect(evaluate(assessment({ riskLevel: "medium", suggestedAction: "approve" })).action).toBe("manual_review");
    expect(evaluate(assessment({ riskLevel: "medium", suggestedAction: "manual_review" })).action).toBe("manual_review");
    expect(evaluate(assessment({ riskLevel: "low", suggestedAction: "approve", confidence: 0.99 })).action).toBe("approve");
    expect(evaluate(assessment({ riskLevel: "low", suggestedAction: "approve", reasons: ["内容空洞、意图不明"], confidence: 0.99 })).action).toBe("manual_review");
    expect(evaluate(assessment({ riskLevel: "low", suggestedAction: "manual_review", reasons: ["无法判断意图"] })).action).toBe("manual_review");
  });


  test("conflicting or unknown assessment values are manual review", () => {
    expect(evaluate(assessment({ riskLevel: "critical", suggestedAction: "approve" })).action).toBe("manual_review");
    expect(evaluate({ ...assessment(), riskLevel: "unknown" as PostReviewAssessment["riskLevel"] }).action).toBe("manual_review");
    expect(evaluate(assessment({ suggestedAction: "manual_review" })).action).toBe("manual_review");
  });
});
