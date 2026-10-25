import type { PostReviewAssessment } from "./post-review";

export type AutoModerationPolicy = {
  enabled: boolean;
  autoApproveEnabled: boolean;
  autoRejectEnabled: boolean;
  allowedAutoApproveCategories: string[];
  blockedPatterns: string[];
  minimumConfidence: number;
  minimumValidatedSamples: number;
  delaySeconds: number;
  globalKillSwitch: boolean;
};

export type AutoModerationRuleOutcome = "pass" | "fail" | "indeterminate";
export type AutoModerationRuleTrace = {
  ruleId: string;
  outcome: AutoModerationRuleOutcome;
  explanation: string;
  /** Present on the pattern rule: current matching is a case-insensitive literal substring. */
  matchSemantics?: "literal_substring";
};
export type AutoModerationTrace = {
  rules: AutoModerationRuleTrace[];
  finalAction: "approve" | "reject" | "manual_review";
  explanation: string;
};
export type AutoModerationDecision = {
  action: "approve" | "reject" | "manual_review";
  reason: string;
  trace: AutoModerationTrace;
};

export type AutoModerationSignals = {
  validatedSamples: number;
  matchedCategoryRates: Record<string, { total: number; matched: number }>;
};

export function evaluateAutoModerationDecision(input: {
  assessment: PostReviewAssessment;
  policy: AutoModerationPolicy;
  signals: AutoModerationSignals;
  postText: string;
}): AutoModerationDecision {
  const { assessment, policy, signals, postText } = input;
  const rules: AutoModerationRuleTrace[] = [];
  const add = (ruleId: string, outcome: AutoModerationRuleOutcome, explanation: string, matchSemantics?: "literal_substring") => {
    rules.push({ ruleId, outcome, explanation, ...(matchSemantics ? { matchSemantics } : {}) });
  };
  const finish = (action: AutoModerationDecision["action"], reason: string): AutoModerationDecision => ({
    action, reason, trace: { rules, finalAction: action, explanation: reason },
  });

  add("policy.enabled", policy.enabled ? "pass" : "fail", policy.enabled ? "Automatic moderation is enabled." : "Automatic moderation is disabled.");
  add("policy.kill_switch", policy.globalKillSwitch ? "fail" : "pass", policy.globalKillSwitch ? "Global kill switch is active." : "Global kill switch is inactive.");
  if (!policy.enabled || policy.globalKillSwitch) return finish("manual_review", "自动审核已关闭或触发全局紧急停止");

  const validRisk = assessment.riskLevel === "low" || assessment.riskLevel === "medium" || assessment.riskLevel === "high" || assessment.riskLevel === "critical";
  add("assessment.risk", !validRisk ? "indeterminate" : assessment.riskLevel === "low" ? "pass" : "fail", !validRisk ? "Risk level is unknown." : assessment.riskLevel === "low" ? "Risk level is low." : "Risk level is not low.");
  add("assessment.sensitive_findings", assessment.sensitiveFindings.length === 0 ? "pass" : "fail", assessment.sensitiveFindings.length === 0 ? "No sensitive findings." : "Sensitive findings require human review.");
  if (!validRisk || assessment.riskLevel !== "low" || assessment.sensitiveFindings.length > 0) return finish("manual_review", "中高风险或敏感信息必须人工审核");

  if (assessment.suggestedAction === "reject") {
    add("reject.enabled", policy.autoRejectEnabled ? "pass" : "fail", policy.autoRejectEnabled ? "Automatic rejection is enabled." : "Automatic rejection is disabled.");
    if (!policy.autoRejectEnabled) return finish("manual_review", "未启用自动拒绝");
    const patternHit = policy.blockedPatterns.find((pattern) => pattern && postText.toLocaleLowerCase().includes(pattern.toLocaleLowerCase()));
    add("reject.pattern_substring", patternHit ? "pass" : "fail", patternHit ? `Matched configured literal substring: ${patternHit}` : "No configured literal substring matched.", "literal_substring");
    const confidencePass = assessment.confidence >= policy.minimumConfidence;
    add("reject.confidence", confidencePass ? "pass" : "fail", confidencePass ? "Confidence meets the configured minimum." : "Confidence is below the configured minimum.");
    if (patternHit && confidencePass) return finish("reject", `命中已配置规则且达到置信度门槛：${patternHit}`);
    return finish("manual_review", patternHit ? "拒绝决策未达到置信度门槛" : "没有命中管理员配置的明确拒绝规则");
  }

  add("approve.enabled", policy.autoApproveEnabled ? "pass" : "fail", policy.autoApproveEnabled ? "Automatic approval is enabled." : "Automatic approval is disabled.");
  add("assessment.confidence", assessment.confidence >= policy.minimumConfidence ? "pass" : "fail", assessment.confidence >= policy.minimumConfidence ? "Confidence meets the configured minimum." : "Confidence is below the configured minimum.");
  add("assessment.suggested_action", assessment.suggestedAction === "approve" ? "pass" : "fail", assessment.suggestedAction === "approve" ? "Assessment suggests approval." : "Assessment does not suggest approval.");
  if (!policy.autoApproveEnabled || assessment.confidence < policy.minimumConfidence || assessment.suggestedAction !== "approve") return finish("manual_review", "AI 拒绝建议缺少达到置信度门槛的明确规则命中");

  const samplePass = signals.validatedSamples >= policy.minimumValidatedSamples;
  add("calibration.samples", samplePass ? "pass" : "fail", samplePass ? "Validated sample minimum is met." : "Validated sample minimum is not met.");
  if (!samplePass) return finish("manual_review", "有效人工校准样本不足");

  const category = assessment.categories.find((item) => policy.allowedAutoApproveCategories.includes(item));
  add("approve.category_allowlist", category ? "pass" : "fail", category ? `Category is allowlisted: ${category}` : "No assessed category is allowlisted.");
  if (!category) return finish("manual_review", "投稿类别不在自动通过白名单");
  const rate = signals.matchedCategoryRates[category];
  const agreementPass = !!rate && rate.total >= policy.minimumValidatedSamples && rate.matched / rate.total >= 0.98;
  add("calibration.category_agreement", agreementPass ? "pass" : "fail", agreementPass ? "Category calibration agreement meets the existing minimum." : "Category calibration agreement is insufficient.");
  if (!agreementPass) return finish("manual_review", "该类别人工校准一致率不足");
  return finish("approve", `低风险且达到校准门槛的白名单类别：${category}`);
}

export function beijingDayKey(date: Date): string {
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
}

export function getAutoModerationGate(policy: AutoModerationPolicy, assessment: PostReviewAssessment, signals: AutoModerationSignals, postText: string): AutoModerationDecision {
  return evaluateAutoModerationDecision({ policy, assessment, signals, postText });
}
