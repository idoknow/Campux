# AI review policy clarity: admin UX spec

**Status:** proposal only; documentation does not change current behavior.
**Audience:** campus-wall admins and reviewers; admin-facing surfaces only.
**Scope:** make the existing policy and AI-assisted review legible without changing the layout, decision authority, stored data, or moderation gates.

## Current product baseline

The admin page already has compact, collapsible areas for AI settings and the school entity dictionary/feedback. Settings include modes (off, shadow, assist, auto), policy principles, focus patterns, allowed categories, strict privacy, auto-mode controls, thresholds, and a save action. Its current description says automation is gated by policy, calibration, delay, and fallback to people. A separate operations control can stop AI review globally.

The existing review analysis card is attached to the post in the review flow. It identifies shadow mode and “reference only,” displays risk, suggested action, categories, confidence, reason text, sensitive findings and excerpts, and optional masking/rewrite/rejection copy. It offers agreement/correction feedback; auto mode can show a safety-gate explanation. Admins can add a finding as an entity. Failure/unavailable cases direct reviewers back to the human process.

Keep these surfaces, hierarchy, and actions. This proposal clarifies labels and information grouping within them; it does not propose a new dashboard, new navigation, or replacing the human review decision.

## Principles and boundaries

- State plainly what the system did, what it recommends, and what a person must decide. The AI suggestion is not the human decision.
- Put the applicable policy, relevant evidence, and reason beside the recommendation. Distinguish an explicit configured rule match from model interpretation; do not imply a rule fired when only a model reason exists.
- Use risk as a compact signal, not as a verdict. Define levels in the existing card’s detail affordance, not as a new scoring system.
- Make uncertainty actionable: show the specific reason for escalation and the existing human-review path. When analysis failed or is unavailable, do not imply a risk rating.
- Do not promise audit history, reversible versions, or per-item policy snapshots unless those capabilities are confirmed and exposed. The existing analysis version and model snapshot references are not evidence that administrators can inspect a full policy-version history.
- Keep the campus-wall context implicit in the normal admin workspace. Never expose internal tenant IDs, raw tenant identifiers, or identifiers in copied content.
- Do not add automatic behavior, loosen gates, restore quota, or change the scope of feedback/entity controls.

## Wireframe-level proposal

### 1. Admin AI settings (existing collapsible section)

Keep the current section and controls. Add short, adjacent helper text and a read-only summary so admins can understand the effect of their saved policy before editing. Avoid expanding all detail by default.

```text
AI 审核设置                         [AI 辅助]
当前模式：仅人工参考
AI 仅提供提示；审核员仍作最终决定。

审核模式
[关闭 / 仅审计记录 / 仅人工参考 / 自动决策（需谨慎）]

审核规则
墙号风格/审核原则             [现有编辑框]
需重点检查的内容               [现有编辑框]
允许的投稿类别                 [现有编辑框]
严格检查个人隐私               [现有开关]

自动决策保护（折叠说明；只在适用时强调）
仅低风险、无敏感信息且满足明确策略、类别白名单、
置信度/校准门槛及延迟检查时才可能执行；其他情况转人工。
[现有自动模式控件]

保存审核设置
```

Copy rules:
- Explain “重点检查” means a signal for careful review, not necessarily an automatic rejection. Explicitly identify which existing exact-pattern rules can participate in auto-reject, if that distinction is accurate for the active configuration.
- Distinguish allowed content categories from auto-approve categories; they are different current settings. Do not suggest the first list grants automatic approval.
- Explain that confidence is a model estimate, not a probability guarantee or proof. Show thresholds in the existing controls without implying they alone authorize a decision.
- When auto mode is selected or enabled, retain the existing caution and state that non-eligible cases fall back to manual review. Keep the global stop concept separate from wall-level controls; only describe the stop as available, not as a new control here.
- After save, show the existing saved/error state and, if the server supplies a timestamp, “当前设置已保存 · [时间]”. Do not fabricate a version number or actor.

### 2. Analysis card on a post (existing review surface)

Keep the card within the post and preserve current reviewer actions. Group existing fields in a predictable order. Use small status text and the design’s restrained status color; avoid a second card inside the card.

```text
AI 审核辅助 · 仅供参考             [影子模式：仅审计]
建议：重点人工复核 · 风险：高 · 置信度：…
最终决定由审核员作出。

为什么提示？
• [现有 reason；一句一项]
• 命中规则：[已确认规则名称/简述；仅当有可核对命中数据时显示]
• 相关内容：[现有敏感发现 excerpt] · [原因]

[展开] 评估详情
  类别 · 证据片段 · 风险等级释义 · 评估/策略说明
  隐私提醒：核对原文上下文；不要仅凭摘录作决定。

[现有打码/改写/拒绝理由（有值才展示）]
[AI 判断正确] [人工纠正 / AI 误判]
```

Details:
- Keep the existing suggested-action and risk labels, but describe risk levels consistently: low = limited signal; medium = review context; high = careful human review; critical = highest-priority human review. Treat these as explanatory copy only; confirm wording with the policy owner before shipping. They are not independent policy definitions or new thresholds.
- Render model reason text as an explanation attributed to the analysis, not as a rule quote or verified fact. For a rule explanation, use “命中规则” only when the application can identify the exact applicable configured rule. Otherwise omit that row rather than guessing from text similarity.
- Show evidence as the minimal relevant excerpt already available. Keep the reason adjacent. Do not expand or reveal more post content than the existing reviewer already has access to. Preserve privacy-sensitive handling; do not make masking mandatory or imply the excerpt is redacted when it is not.
- Confidence can remain visible but should have a concise help label such as “模型自评，非准确率保证”. Avoid visual precision beyond the current percentage.
- Keep optional masking, rewrite, and rejection reason below the rationale, clearly labeled “建议”/“参考”; they are not automatically applied.

### 3. Uncertain, gated, or unavailable analysis

Use the existing status and auto-decision reason fields where present. Make the next step unambiguous and do not expose a recommendation as executable when a gate routes it to a person.

```text
AI 审核辅助 · 需人工审核
未自动处理：未满足校准门槛（示例；显示真实原因）
请按常规审核流程判断。
```

Examples to map only from actual returned reason/status:
- low confidence or a non-matching recommendation → “判断不确定，转人工审核”;
- high/critical risk or sensitive finding → “高风险/敏感信息需人工复核”;
- missing validated samples or category calibration → name that unmet gate;
- disabled, paused, delayed, failed, unavailable, or shadow mode → state the actual state and that no automated decision was made/executed, as applicable.

For a failed/unavailable analysis, show no fabricated risk, confidence, evidence, or action. Retain “请按人工流程审核”. Preserve the difference between an AI suggestion and the gate’s actual disposition; never label a queued/manual case “自动拒绝” or “自动通过”.

### 4. Feedback and learning transparency

Keep the two existing feedback actions and the current aggregate summary. Make the distinction human-readable: agreement means the reviewer agrees with this analysis; correction means the reviewer’s final action differs. If a comment is already requested in the review flow, label it optional and contextual (“说明原因，可选”); do not introduce a mandatory justification or imply feedback instantly changes the policy/model.

In the existing admin feedback area, retain aggregate counts and state the available scope/time window only if the service actually returns it. Explain that feedback is used as calibration evidence where eligible, not that every submission retrains a model. Do not imply that updating a school snapshot edits policy rules or guarantees improved accuracy. Existing entity dictionary entries remain analysis aids, not factual assertions or automatic decisions.

### 5. Version/change clarity (no new history capability assumed)

For current UI, show only verifiable current metadata: saved state/time if available, and the active snapshot version/status only if already returned by the existing API. Keep “policy settings” and “school model snapshot” visibly distinct. Do not call the existing analysis version a policy version.

A future history affordance is optional and needs product-owner approval plus confirmation of available data. If approved, prefer a small “查看变更记录” disclosure within settings, listing effective time, changed fields, and actor only when reliably recorded; show prior values read-only. Do not add rollback or editing from history in this proposal. Do not invent a version ID, actor, timestamp, or audit guarantee.

## Accessibility and responsive behavior

- Preserve semantic headings, native disclosure behavior, keyboard focus, and accessible names for switches and feedback actions.
- Risk and state must be expressed in text as well as color.
- Let reason and evidence wrap; do not clip sensitive excerpts or controls on narrow screens. Keep existing actions reachable without horizontal overflow.
- Keep settings compact and progressive: mode and saved policy first; detailed auto-gates in their existing section; no new metric tiles or nested card stack.

## Out of scope

No UI implementation, API/schema changes, new policy categories or risk thresholds, automated decision changes, quota changes, global operations changes, policy history/rollback implementation, tenant identifiers, or expanded access to analysis/evidence. This file is a UX proposal, not a claim that proposed copy, metadata, or history exists in production.

## Product-owner approval required

1. Whether risk-level definitions and labels (“重点人工复核”, etc.) are approved policy language, and whether risk is meant to indicate severity, review priority, or both.
2. What exact rule-match evidence can be exposed and whether configured patterns may be named/displayed to reviewers; current model reasons must not be presented as exact matches.
3. The uncertainty/escalation wording and whether every listed gate reason is available to the UI; copy must be driven only by actual disposition data.
4. Whether a saved-at/actor indicator or policy change history is a product requirement, what records are authoritative, and whether any rollback is permitted. No history is assumed here.
5. Whether feedback comments, aggregate windows, or calibration explanations should be shown to admins/reviewers, within existing permissions and data availability.
6. Whether presenting sensitive evidence excerpts in reviewer context needs additional masking or access rules; this proposal only uses the existing authorized card content.

## Assumptions

- The existing Campux admin AI settings, review analysis card, feedback actions, entity controls, modes, and gate behavior described above remain the product baseline.
- The task is documentation-only; proposed labels/layout grouping are not implemented or validated with users.
- Existing risk/action/reason/evidence fields may be displayed as they are today, but a distinct exact rule match, policy version, save timestamp, and audit history are not presumed available.
- Tenant context is implicit in the signed-in campus-wall admin workspace; internal identifiers are never part of the proposed copy or wireframe.
- The current safety boundary remains unchanged: ineligible, uncertain, sensitive, or failed analyses require human review; this spec does not restore quota or alter behavior.
