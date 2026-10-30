import type { PostReviewAssessment } from "./post-review";

export type AutoModerationPolicy = {
  enabled: boolean;
  autoApproveEnabled: boolean;
  autoRejectEnabled: boolean;
  allowedAutoApproveCategories: string[];
  allowedAutoRejectCategories: string[];
  autoRejectRiskLevels: Array<"high" | "critical">;
  blockedPatterns: string[];
  minimumConfidence: number;
  autoApproveMinimumConfidence: number;
  autoRejectMinimumConfidence: number;
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

type HighRiskPostIntent = "solicitation" | "contextual" | "unclear";

/** Fail closed on ambiguous high-risk content; distinguish promotion from warning/discussion using whole-text semantics. */
export function classifyHighRiskPostIntent(assessment: PostReviewAssessment, postText: string): { postIntent: HighRiskPostIntent; reason: string } {
  const text = postText.normalize("NFKC").toLocaleLowerCase();
  const rebuttal = /(?:辟谣|反诈|提醒|警示|科普|不要参与|勿参与|禁止参与|别参与|不要相信|勿信|谨防|防范|曝光|揭穿|批评|反对|讨论|分析|质疑|报道|新闻|转述|引用|举例|是真是假|是否违规|被骗|受骗|套路解析|风险提示|揭露|抵制|劝阻|避坑|警惕|不是.{0,8}(?:招募|广告|诈骗)|并非.{0,8}(?:招募|广告|诈骗))/u;
  const directRecruitment = /(?:招募|招人|找人|联系我|私聊|加我|报名|来做|兼职|学生工|每单|一单|返佣|佣金|辛苦费|赚钱|赚零花|下单.{0,8}(?:退款|返款)|(?:退款|返款).{0,8}下单|刷单|冲销量)/u;
  const highRiskActivity = /(?:刷单|冲销量|下单.{0,8}(?:退款|返款)|(?:退款|返款).{0,8}下单|返佣|诈骗|骗|垫付|刷流水|套现|代付)/u;
  const promotionFindings = assessment.sensitiveFindings.some((finding) => /招募|返佣|推广|引流|诈骗招揽|拉人/u.test(`${finding.type} ${finding.reason}`));
  const directNegative = /(?:不要|勿|禁止|别|拒绝|反对|并非|不是|没有|无需).{0,12}(?:招募|兼职|下单|刷单|返佣|诈骗|联系|参与)/u;
  const explicitWarning = rebuttal.test(text) && highRiskActivity.test(text);
  if (explicitWarning) return { postIntent: "contextual", reason: "本文包含风险活动的警示、辟谣或讨论语境。" };
  if (directRecruitment.test(text) && highRiskActivity.test(text) && !directNegative.test(text)) return { postIntent: "solicitation", reason: "本文正在招揽参与具有高风险特征的活动。" };
  return { postIntent: "unclear", reason: "仅凭现有语境无法区分推广招揽与引用讨论。" };
}

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
  if (!validRisk) return finish("manual_review", "未知风险必须人工审核");
  const highRisk = assessment.riskLevel === "high" || assessment.riskLevel === "critical";
  const { postIntent } = classifyHighRiskPostIntent(assessment, postText);
  if (highRisk && postIntent === "solicitation") {
    add("assessment.post_intent", "pass", "Text context indicates direct promotion or recruitment of a high-risk activity.");
    add("reject.enabled", policy.autoRejectEnabled ? "pass" : "fail", policy.autoRejectEnabled ? "Automatic rejection is enabled." : "Automatic rejection is disabled.");
    if (!policy.autoRejectEnabled) return finish("manual_review", "高风险自动拒绝未启用，已转人工审核");
    return finish("reject", `高风险招募/诈骗推广按语义自动拒绝：${assessment.riskLevel}`);
  }
  if (highRisk && postIntent === "contextual") {
    add("assessment.post_intent", "pass", "Text context indicates warning, debunking, or discussion; normal recommendation and confidence/category gates apply.");
  } else if (highRisk) {
    add("assessment.post_intent", "indeterminate", "High-risk intent is unclear; manual review is required.");
    return finish("manual_review", "高风险内容意图不明确，需人工复核");
  }
  add("assessment.sensitive_findings", assessment.sensitiveFindings.length === 0 ? "pass" : "fail", assessment.sensitiveFindings.length === 0 ? "No sensitive findings." : "Sensitive findings require human review.");
  if (assessment.sensitiveFindings.length > 0) return finish("manual_review", "敏感信息必须人工审核");

  if (assessment.suggestedAction === "reject") {
    add("reject.enabled", policy.autoRejectEnabled ? "pass" : "fail", policy.autoRejectEnabled ? "Automatic rejection is enabled." : "Automatic rejection is disabled.");
    if (!policy.autoRejectEnabled) return finish("manual_review", "未启用自动拒绝");
    const patternHit = policy.blockedPatterns.find((pattern) => pattern && postText.toLocaleLowerCase().includes(pattern.toLocaleLowerCase()));
    add("reject.pattern_substring", patternHit ? "pass" : "fail", patternHit ? `Matched configured literal substring: ${patternHit}` : "No configured literal substring matched.", "literal_substring");
    const riskPass = policy.autoRejectRiskLevels.includes(assessment.riskLevel as "high" | "critical");
    const category = assessment.categories.find((item) => policy.allowedAutoRejectCategories.includes(item));
    add("reject.risk", riskPass ? "pass" : "fail", riskPass ? `Risk level is configured for rejection: ${assessment.riskLevel}.` : "Risk level is not configured for automatic rejection.");
    add("reject.category_allowlist", category ? "pass" : "fail", category ? `Category is allowlisted: ${category}` : "No assessed category is allowlisted for rejection.");
    const confidencePass = assessment.confidence >= policy.autoRejectMinimumConfidence;
    add("reject.confidence", confidencePass ? "pass" : "fail", confidencePass ? "Confidence meets the configured minimum." : "Confidence is below the configured minimum.");
    if (!patternHit || !riskPass || !category || !confidencePass) return finish("manual_review", !riskPass || !category ? "拒绝类别或风险级别未获管理员明确授权" : !confidencePass ? "拒绝建议置信度不足" : "没有命中管理员配置的明确拒绝规则");
    if (assessment.sensitiveFindings.length > 0) return finish("manual_review", "敏感信息必须人工审核");
    const escapedPattern = patternHit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const quotedPattern = new RegExp(`[“‘\"'][^“”‘’\"']*${escapedPattern}[^“”‘’\"']*[”’\"']`).test(postText);
    const contextualDiscussion = /(?:引用|转述|讨论|举例|反对|辟谣|批评|不要|禁止|勿).{0,12}(?:规则|话术|内容|行为|说法)?/u.test(postText);
    if (quotedPattern || contextualDiscussion) return finish("manual_review", "命中配置规则，但可能是引用或讨论语境，需人工确认");
    return finish("reject", `高风险、命中拒绝白名单和配置规则且达到置信度门槛：${category}`);
  }

  if (assessment.riskLevel !== "low") return finish("manual_review", "中高风险必须人工审核");
  const approveThreshold = policy.autoApproveMinimumConfidence ?? policy.minimumConfidence;
  add("approve.enabled", policy.autoApproveEnabled ? "pass" : "fail", policy.autoApproveEnabled ? "Automatic approval is enabled." : "Automatic approval is disabled.");
  add("assessment.confidence", assessment.confidence >= approveThreshold ? "pass" : "fail", assessment.confidence >= approveThreshold ? "Confidence meets the configured minimum." : "Confidence is below the configured minimum.");
  add("assessment.suggested_action", assessment.suggestedAction === "approve" ? "pass" : "fail", assessment.suggestedAction === "approve" ? "Assessment suggests approval." : "Assessment does not suggest approval.");
  if (!policy.autoApproveEnabled || assessment.confidence < approveThreshold || assessment.suggestedAction !== "approve") return finish("manual_review", "AI 通过建议未达到配置的置信度门槛");

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
