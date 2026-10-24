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

export type AutoModerationDecision = {
  action: "approve" | "reject" | "manual_review";
  reason: string;
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
  if (!policy.enabled || policy.globalKillSwitch) return { action: "manual_review", reason: "自动审核已关闭或触发全局紧急停止" };
  if (assessment.riskLevel !== "low" || assessment.sensitiveFindings.length > 0) return { action: "manual_review", reason: "中高风险或敏感信息必须人工审核" };
  let reason = "AI 拒绝建议缺少达到置信度门槛的明确规则命中";
  if (assessment.suggestedAction === "reject") {
    if (!policy.autoRejectEnabled) reason = "未启用自动拒绝";
    else {
      const patternHit = policy.blockedPatterns.find((pattern) => pattern && postText.toLocaleLowerCase().includes(pattern.toLocaleLowerCase()));
      if (patternHit && assessment.confidence >= policy.minimumConfidence) return { action: "reject", reason: `命中已配置规则且达到置信度门槛：${patternHit}` };
      return { action: "manual_review", reason: patternHit ? "拒绝决策未达到置信度门槛" : "没有命中管理员配置的明确拒绝规则" };
    }
  }
  if (assessment.riskLevel !== "low" || assessment.sensitiveFindings.length > 0) return { action: "manual_review", reason: "中高风险或敏感信息必须人工审核" };
  if (!policy.autoApproveEnabled || assessment.confidence < policy.minimumConfidence || assessment.suggestedAction !== "approve") return { action: "manual_review", reason };
  if (signals.validatedSamples < policy.minimumValidatedSamples) return { action: "manual_review", reason: "有效人工校准样本不足" };
  const category = assessment.categories.find((item) => policy.allowedAutoApproveCategories.includes(item));
  if (!category) return { action: "manual_review", reason: "投稿类别不在自动通过白名单" };
  const rate = signals.matchedCategoryRates[category];
  if (!rate || rate.total < policy.minimumValidatedSamples || rate.matched / rate.total < 0.98) return { action: "manual_review", reason: "该类别人工校准一致率不足" };
  return { action: "approve", reason: `低风险且达到校准门槛的白名单类别：${category}` };
}

export function beijingDayKey(date: Date): string {
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
}

export function getAutoModerationGate(policy: AutoModerationPolicy, assessment: PostReviewAssessment, signals: AutoModerationSignals, postText: string): AutoModerationDecision {
  return evaluateAutoModerationDecision({ policy, assessment, signals, postText });
}
