import type { PostReviewAssessment } from "./post-review";

export type AutoModerationPolicy = {
  enabled: boolean;
  autoApproveEnabled: boolean;
  autoRejectEnabled: boolean;
  minimumConfidence: number;
  autoApproveMinimumConfidence: number;
  autoRejectMinimumConfidence: number;
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
  add("assessment.risk", !validRisk ? "indeterminate" : assessment.riskLevel === "low" ? "pass" : "fail", !validRisk ? "Risk level is unknown." : assessment.riskLevel === "low" ? "Risk level is low." : assessment.riskLevel === "medium" ? "Risk level is medium." : "Risk level is high or critical.");
  if (!validRisk) return finish("manual_review", "未知风险必须人工审核");
  const highRisk = assessment.riskLevel === "high" || assessment.riskLevel === "critical";
  const { postIntent } = classifyHighRiskPostIntent(assessment, postText);
  if (highRisk && (postIntent === "contextual" || postIntent === "unclear")) {
    add("assessment.post_intent", postIntent === "contextual" ? "pass" : "indeterminate", postIntent === "contextual" ? "Text indicates warning/debunking/discussion; follow AI action and confidence." : "High-risk intent is unclear; manual review is required.");
    if (postIntent === "unclear") return finish("manual_review", "高风险内容意图不明确，需人工复审");
  }

  add("assessment.sensitive_findings", assessment.sensitiveFindings.length === 0 ? "pass" : "fail", assessment.sensitiveFindings.length === 0 ? "No sensitive findings." : "Sensitive findings require human review.");
  if (assessment.sensitiveFindings.length > 0 && assessment.suggestedAction !== "reject") return finish("manual_review", "敏感信息必须人工复审");
  if (assessment.sensitiveFindings.length > 0 && highRisk && postIntent !== "solicitation") return finish("manual_review", "高风险内容存在敏感发现且语义未确认，转人工复审");

  const rejectCandidate = assessment.suggestedAction === "reject" && (assessment.riskLevel === "high" || assessment.riskLevel === "critical" || assessment.riskLevel === "medium");
  if (rejectCandidate) {
    add("reject.enabled", policy.autoRejectEnabled ? "pass" : "fail", policy.autoRejectEnabled ? "Automatic rejection is enabled." : "Automatic rejection is disabled.");
    if (!policy.autoRejectEnabled) return finish("manual_review", "未启用自动拒绝，转人工复审");
    const confidencePass = assessment.confidence >= policy.autoRejectMinimumConfidence;
    add("reject.confidence", confidencePass ? "pass" : "fail", confidencePass ? "Confidence meets the configured minimum." : "Confidence is below the configured minimum.");
    if (!confidencePass) return finish("manual_review", "AI 拒绝建议置信度不足，转人工复审");
      return finish("reject", assessment.rejectionReason?.trim() || assessment.reasons.find((reason) => reason.trim()) || "AI 建议拒绝；未提供参考拒绝理由。");
  }

  if (assessment.suggestedAction === "manual_review") return finish("manual_review", "AI 建议人工复审");
  if (assessment.suggestedAction === "reject") return finish("manual_review", "低风险拒绝建议需人工复审");
  if (assessment.riskLevel !== "low") return finish("manual_review", "中高风险通过建议需人工复审");

  const approveThreshold = policy.autoApproveMinimumConfidence ?? policy.minimumConfidence;
  add("approve.enabled", policy.autoApproveEnabled ? "pass" : "fail", policy.autoApproveEnabled ? "Automatic approval is enabled." : "Automatic approval is disabled.");
  add("assessment.confidence", assessment.confidence >= approveThreshold ? "pass" : "fail", assessment.confidence >= approveThreshold ? "Confidence meets the configured minimum." : "Confidence is below the configured minimum.");
  add("assessment.suggested_action", assessment.suggestedAction === "approve" ? "pass" : "fail", assessment.suggestedAction === "approve" ? "Assessment suggests approval." : "Assessment does not suggest approval.");
  if (!policy.autoApproveEnabled) return finish("manual_review", "未启用自动通过");
  if (assessment.suggestedAction !== "approve") return finish("manual_review", "AI 未建议通过");
  if (assessment.confidence < approveThreshold) return finish("manual_review", "AI 通过建议置信度不足");
    const lowRiskMeaningful = /(?:仅为|只是|属于|内容仅是|表达了|写出了|分享了|通知|寻物|求助|祝福|观点|经历|感受|邀约|表白|告白|新闻|通知|活动|时间|地点|物品|失物|寻人|致谢|感谢)/u.test(assessment.reasons.join(" "));
    if (!lowRiskMeaningful) return finish("manual_review", "低风险内容信息不足或意图不明确，转人工复审");
    return finish("approve", "低风险、内容意图明确、AI 建议通过且达到置信度门槛");
}

export function beijingDayKey(date: Date): string {
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
}

export function getAutoModerationGate(policy: AutoModerationPolicy, assessment: PostReviewAssessment, signals: AutoModerationSignals, postText: string): AutoModerationDecision {
  return evaluateAutoModerationDecision({ policy, assessment, signals, postText });
}
