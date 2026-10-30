import { describe, expect, test } from "bun:test";
import type { PostReviewAssessment } from "./post-review";
import { classifyHighRiskPostIntent, evaluateAutoModerationDecision, type AutoModerationPolicy } from "./auto-moderation";

const policy: AutoModerationPolicy = { enabled: true, autoApproveEnabled: true, autoRejectEnabled: true, allowedAutoApproveCategories: ["campus_news"], allowedAutoRejectCategories: ["scam"], autoRejectRiskLevels: ["high", "critical"], blockedPatterns: ["直接转账"], minimumConfidence: 0.98, autoApproveMinimumConfidence: 0.98, autoRejectMinimumConfidence: 0.99, minimumValidatedSamples: 100, delaySeconds: 60, globalKillSwitch: false };
const assessment = (overrides: Partial<PostReviewAssessment> = {}): PostReviewAssessment => ({ schemaVersion: 1, riskLevel: "low", categories: ["campus_news"], sensitiveFindings: [], suggestedAction: "approve", reasons: [], confidence: 0.99, maskedText: null, rewrittenText: null, rejectionReason: null, ...overrides });
const signals = { validatedSamples: 200, matchedCategoryRates: { campus_news: { total: 120, matched: 119 } } };
const evaluate = (a = assessment(), p = policy, s = signals, text = "校园新闻") => evaluateAutoModerationDecision({ assessment: a, policy: p, signals: s, postText: text });

describe("automatic moderation explicit policy trace", () => {
  test("traces successful calibrated category approval", () => {
    const result = evaluate();
    expect(result).toMatchObject({ action: "approve", reason: "低风险且达到校准门槛的白名单类别：campus_news", trace: { finalAction: "approve" } });
    expect(result.trace.rules.map((r) => r.ruleId)).toEqual(["policy.enabled", "policy.kill_switch", "assessment.risk", "assessment.sensitive_findings", "approve.enabled", "assessment.confidence", "assessment.suggested_action", "calibration.samples", "approve.category_allowlist", "calibration.category_agreement"]);
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
  test("reject requires enabled rule, literal case-insensitive substring hit and confidence", () => {
    const a = assessment({ suggestedAction: "reject" });
    expect(evaluate(a, { ...policy, autoRejectEnabled: false }, signals, "直接转账").reason).toBe("未启用自动拒绝");
    expect(evaluate(assessment({ suggestedAction: "reject", confidence: 0.97 }), policy, signals, "直接转账").reason).toBe("拒绝类别或风险级别未获管理员明确授权");
    expect(evaluate(a, policy, signals, "通常情况下转账需要谨慎").action).toBe("manual_review");
  });
  test("high-risk posts classify by text semantics: solicitation rejects, rebuttals follow gates, unclear intent reviews", () => {
    const configured = { ...policy, autoRejectMinimumConfidence: 0.99, blockedPatterns: [], allowedAutoRejectCategories: [] };
    const solicitation = assessment({ suggestedAction: "manual_review", riskLevel: "high", categories: ["solicitation"], confidence: 0.5, sensitiveFindings: [{ type: "刷单返佣", excerpt: "每单给20块辛苦费", reason: "诱导刷单返佣" }] });
    const pitch = "家里有亲戚做电商，最近平台审核冲销量需要帮忙，很简单就是下单再退款，每单给20块辛苦费，不占用太多时间，想赚点零花的同学可以联系我。";
    expect(classifyHighRiskPostIntent(solicitation, pitch).postIntent).toBe("solicitation");
    expect(evaluate(solicitation, configured, signals, pitch).action).toBe("reject");
    expect(evaluate(assessment({ ...solicitation, riskLevel: "critical" }), configured, signals, pitch).action).toBe("reject");
    expect(evaluate(solicitation, { ...configured, autoRejectEnabled: false }, signals, pitch).action).toBe("manual_review");

    const rebuttal = assessment({ suggestedAction: "manual_review", riskLevel: "high", categories: ["诈骗"], confidence: 0.97, sensitiveFindings: [] });
    const rebuttalText = "提醒同学不要参与下单退款刷单，这类兼职是诈骗，请勿相信。";
    expect(classifyHighRiskPostIntent(rebuttal, rebuttalText).postIntent).toBe("contextual");
    expect(evaluate(rebuttal, policy, signals, rebuttalText).action).toBe("manual_review");
    const quoted = "有人说下单再退款能赚钱，这是刷单诈骗，大家不要参与。";
    expect(classifyHighRiskPostIntent(solicitation, quoted).postIntent).toBe("contextual");
    expect(evaluate(assessment({ ...solicitation, categories: ["诈骗"], sensitiveFindings: [] }), policy, signals, quoted).action).toBe("manual_review");
    const fullQuotedPitch = "有人发帖：家里有亲戚做电商，平台审核冲销量，需要同学下单再退款，每单给20元，联系我。请大家不要参与，这是刷单诈骗。";
    expect(classifyHighRiskPostIntent(solicitation, fullQuotedPitch).postIntent).toBe("contextual");
    expect(evaluate(assessment({ ...solicitation, categories: ["诈骗"], sensitiveFindings: [] }), policy, signals, fullQuotedPitch).action).toBe("manual_review");

    const unclear = assessment({ suggestedAction: "reject", riskLevel: "high", categories: ["misc"], confidence: 1, sensitiveFindings: [] });
    expect(classifyHighRiskPostIntent(unclear, "高风险内容").postIntent).toBe("unclear");
    expect(evaluate(unclear, configured, signals, "高风险内容").action).toBe("manual_review");
  });

  test("high-risk contextual content obeys suggestion, confidence and category gates", () => {
    const contextualPolicy = { ...policy, autoRejectMinimumConfidence: 0.99, allowedAutoRejectCategories: ["scam"], blockedPatterns: ["直接转账"] };
    const contextual = assessment({ suggestedAction: "reject", riskLevel: "high", categories: ["scam"], confidence: 0.97, sensitiveFindings: [] });
    const contextText = "辟谣：直接转账是诈骗话术，请大家不要相信。";
    expect(classifyHighRiskPostIntent(contextual, contextText).postIntent).toBe("contextual");
    expect(evaluate(contextual, contextualPolicy, signals, contextText).action).toBe("manual_review");
    const categoryNotAllowed = assessment({ suggestedAction: "reject", riskLevel: "high", categories: ["debunking"], confidence: 1, sensitiveFindings: [] });
    expect(evaluate(categoryNotAllowed, contextualPolicy, signals, contextText).action).toBe("manual_review");
  });

  test("model reject without exact configured substring hit is not auto-rejected", () => {
    const result = evaluate(assessment({ suggestedAction: "reject" }), policy, signals, "普通校园新闻");
    expect(result.action).toBe("manual_review");
    expect(result.reason).toBe("没有命中管理员配置的明确拒绝规则");
    expect(result.trace.rules.find((r) => r.ruleId === "reject.pattern_substring")).toMatchObject({ outcome: "fail", matchSemantics: "literal_substring" });
  });
  test("approval gates each flag, confidence, action, samples, category, and agreement", () => {
    const cases = [
      [assessment({ suggestedAction: "approve" }), { ...policy, autoApproveEnabled: false }, signals, "校园新闻", "AI 通过建议未达到配置的置信度门槛"],
      [assessment({ confidence: 0.97 }), policy, signals, "校园新闻", "AI 通过建议未达到配置的置信度门槛"],
      [assessment({ suggestedAction: "manual_review" }), policy, signals, "校园新闻", "AI 通过建议未达到配置的置信度门槛"],
      [assessment(), policy, { ...signals, validatedSamples: 0 }, "校园新闻", "有效人工校准样本不足"],
      [assessment({ categories: ["unknown"] }), policy, signals, "校园新闻", "投稿类别不在自动通过白名单"],
      [assessment(), policy, { ...signals, matchedCategoryRates: { campus_news: { total: 100, matched: 97 } } }, "校园新闻", "该类别人工校准一致率不足"],
    ] as const;
    for (const [a, p, s, text, reason] of cases) expect(evaluate(a, p, s, text)).toMatchObject({ action: "manual_review", reason });
  });
  test("conflicting or unknown assessment values are manual review", () => {
    expect(evaluate(assessment({ riskLevel: "critical", suggestedAction: "approve" })).action).toBe("manual_review");
    expect(evaluate({ ...assessment(), riskLevel: "unknown" as PostReviewAssessment["riskLevel"] }).action).toBe("manual_review");
    expect(evaluate(assessment({ suggestedAction: "manual_review" })).action).toBe("manual_review");
  });
});
