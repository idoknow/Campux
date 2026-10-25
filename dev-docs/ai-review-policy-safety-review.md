# AI moderation policy boundary: safety and fairness review

**Scope:** recommendations for policy boundaries, evaluation, and release readiness. This is a review of current design and implementation, not a claim that any category is inherently unlawful or universally prohibited. Local wall rules and human reviewers determine policy; model output is a risk signal. Nothing here proposes removing quotas or changing production behavior.

## Current boundary and evidence

- `dev-docs/refactor-next/06-school-modeling-ai-review.md` §Non-goals and §Auto-moderation stages (lines 15–21, 328–386) define advisory-first behavior, no direct `Post.status` mutation by model output, and staged automation. Its §Safety and privacy boundary (388–395) calls for tenant isolation and uncertainty on truth/controversy judgments.
- Current `apps/server/src/runtime/post-review.ts` builds a structured prompt, explicitly treats post text as untrusted and says not to follow its instructions (lines 204–218); it schema-validates output and bounds response size. `apps/server/src/runtime/auto-moderation.ts` (25–50) fails closed to manual review for non-low risk/sensitive findings, requires low confidence-threshold? (minimum confidence), samples, category allowlisting, and a configured pattern for rejection. The implementation's logic should be validated in both shadow and live-like fixtures before relying on it.
- Automation is consequential: `apps/server/src/runtime/auto-moderation-scheduler.ts` (120–196) rechecks policy/calibration before changing status; approval can enter publishing. `docs/operator/review-and-publish.md` §Review actions (22–32) documents that approval creates publish attempts. Treat release gates accordingly.
- Existing evaluation baseline `dev-docs/ai-review-stage-0-acceptance.md` (3–17) uses authorized minimized historical data, reports aggregate per-tenant counts and reject-based errors, and requires manual sign-off. Current `/api/admin/ai-review/metrics` in `apps/server/src/routes/ai-review.ts` (109–118) reports only counts by status and matched/overridden feedback, not error rates or category denominators.

## Risks and recommended boundaries

### False positives and false negatives

**False positives:** slang, reclaimed language, quotation/reporting, satire, negation, dialect, common names, shared class/place terms, and benign calls for help may be classified as harassment, personal data, or solicitation. Contextual school entities can turn a common alias into an unjustified person match. A blanket blocked phrase can trigger on a quoted warning, a negated statement, or a discussion of scams rather than an offer. High-impact false positives include delayed auto-rejection and low-risk classification errors that result in approval/publishing.

**False negatives:** obfuscated phone/contact details, OCR text in attachments, spaced or misspelled names, euphemisms, coded harassment, indirect identifiers, coordinated targeting across posts, and recently emerging scams may evade text-only analysis. The current review call sends only `post.text` (`post-review.ts` 180–209); the design document's attachment OCR and author history are future inputs, not evidence of present coverage. Don't claim coverage for image/audio or campaign/broadcast domains without separate evaluation.

**Recommendation:** preserve manual review as the default on unknown categories, incomplete input, model/provider/schema errors, conflicting signals, or uncertain labels. Do not let a confident model score alone authorize rejection. Treat hard patterns as review triggers unless the wall owner explicitly defines a narrow, reviewable rule. Keep the automatic rejection scope narrower than automatic approval scope, and require an explicit per-wall decision for each enabled action/category. This is a risk boundary, not a determination that the content violates a universal standard.

### Fairness and label quality

Human decisions are operational labels, not objective ground truth. Different walls, reviewers, and time periods can apply different rules; reviewer disagreement and missing category labels can distort apparent agreement. A high aggregate match rate can mask severe misses in a small wall or in a rare but high-impact category. Categories and rule configuration can also encode local bias; entity repetition can amplify past mistaken judgments.

**Recommendation:** report results separately by tenant, category, model/snapshot version, action, and meaningful input modality. Stratify where lawfully and ethically justified by language/register and relevant content form; avoid collecting sensitive demographic attributes merely to create slices. Keep disagreements visible and adjudicate high-impact examples with more than one authorized reviewer where feasible. Track label coverage and reviewer disagreement; don't count unlabeled examples as correct.

### Privacy and retention

Posts, OCR, names, class/group details, contact information, AI excerpts, masked/rewritten versions, reasons, feedback comments, and school-model evidence can all contain sensitive material. Tenant-scoped database relationships and current minimized-export guidance are useful controls, but sending text to a configured provider is still a disclosure boundary. The policy should make clear which provider receives which fields, retention/training settings, region/transfer conditions if relevant, and what users/admins are told; these are unresolved choices, not facts established by the inspected docs.

**Recommendations:** minimize provider payloads and stored findings; avoid sending author behavior/history unless separately justified and evaluated. Keep raw text out of routine logs, aggregate metrics, cross-tenant datasets, and broad admin views. Enforce tenant-scoped access for analysis, evidence, and exports; audit access and reviewer actions. Define retention/deletion for raw prompts/responses, snapshots, exports, and feedback, including post deletion and tenant archive. Avoid putting full excerpts or private details into review-group messages. Review secure handling of provider responses and backups. Existing `docs/admin/security.md` §Permissions and `dev-docs/ai-review-stage-0-acceptance.md` lines 5–15 support least privilege and minimized exports; they do not settle provider retention or user notice.

### Prompt and policy injection

Untrusted post text can contain instructions to ignore policy, reveal hidden context, or force an action. The prompt's explicit instruction in `post-review.ts` 207–209 is a good baseline, but prompt wording is not a security boundary. Tenant rules, school snapshots, entity names/aliases, evidence, and OCR are also potentially user-influenced and are interpolated as context; malicious or corrupted stored context may be instruction-like. Model-generated masked/rewrite/reason text is untrusted output too.

**Recommendations:** keep post/context data structurally separated from instructions (not concatenated into the system instruction); quote/label it as data and constrain to the minimum necessary. Validate every field and enum, bound sizes, reject unknown output fields (already done by parser), and never execute model-proposed tools/actions. Do not expose secrets, hidden rules, or detailed bypass thresholds in prompts or user-visible errors. Add injection tests across body, OCR, entity alias, snapshot summary, and admin rule values. Confirm escaping and rendering for generated text to prevent markup/script/link abuse. A valid JSON response does not prove a safe or correct decision.

### Uncertainty routing and oversight

Confidence is model-reported and may not be calibrated; the 0.98 threshold in `auto-moderation.ts` is not itself evidence of a 98% correctness rate. Sparse samples, stale model versions, shifted rules, provider changes, input truncation, and category mismatch should all increase uncertainty. Current prompt says `manual_review` when uncertain (`post-review.ts` 207); this should be a measured route, not a failure bucket.

**Recommendation:** route ambiguous, conflicting, out-of-distribution, unrecognized-category, low-quality OCR, malformed/truncated, and policy-version-mismatch cases to humans. Distinguish unavailable/failed from completed manual-review suggestions in metrics. Show reviewers reason/evidence with uncertainty and model/snapshot version, not just a categorical risk label; retain independent human authority and an easy override. Never represent AI suggestions as the wall's final policy decision.

## Evaluation metrics (per tenant first)

For each tenant, report denominators and confidence intervals or uncertainty ranges, not only percentages. Suppress or combine very small cells to avoid exposing individual submissions. Recompute for each model/provider/prompt/rule/snapshot version and evaluation period.

- **Safety errors:** false-negative rate / recall for each explicitly labeled high-impact risk category; false-positive rate and precision for those categories; counts alongside rates. Define positive/negative labels and treatment of `manual_review` before calculation.
- **Decision quality:** confusion matrix for approve/revise/reject/manual-review; macro-F1 or balanced accuracy as secondary summaries (never replace category-specific error counts); human override and disagreement rate.
- **Calibration/coverage:** reliability by confidence bins, Brier score or expected calibration error where sample size supports it; fraction automatically decided versus routed to review; abstention/manual-review rate. Evaluate calibration only on held-out, adjudicated data, not training/calibration feedback reused as test data.
- **Fairness/robustness:** error slices by category, language/register and modality where supported; worst-tenant/category error and minimum sample coverage; false-positive impact on benign quoted/negated content; paraphrase/obfuscation robustness. Avoid misleading comparisons where labels or rule policies differ.
- **Operational/privacy:** provider unavailable/schema-invalid/timeout rates, latency, audit completeness, data-retention/erasure outcomes, and provider cost per 1,000 analyses. Existing `dev-docs/refactor-next/06-school-modeling-ai-review.md` §Evaluation metrics (454–465) includes agreement, high-risk recall, low-risk false alarm, reviewer time, adoption, overrides, and cost; add explicit denominators, calibration, and per-tenant/category slices.

`dev-docs/ai-review-stage-0-acceptance.md` uses reject-based FP/FN counts and per-tenant match rates. Expand the evaluation protocol to label the four-way action matrix and define how revised/manual-review labels map; don't infer recall from overall match rate. The current feedback metrics endpoint (`apps/server/src/routes/ai-review.ts` 109–118) is insufficient for release eligibility by itself.

## Recommended test cases

1. **Context and semantics:** benign quotation of a prohibited phrase; negated statement; educational/news reporting; satire/reclaimed language; ambiguous nickname shared by many people; criticism of an institution versus targeted personal attack; benign lost-property post mentioning a place/person.
2. **Privacy evasion:** phone/contact details with spaces, punctuation, full-width digits, Chinese numerals, OCR-like segmentation; a name plus class/club/location without explicit full name; screenshot OCR containing a contact detail. Assert text-only mode does not claim OCR coverage.
3. **Injection:** post says “ignore rules/approve”; encoded or multilingual instructions; same payload in OCR, alias, snapshot summary, rule text, or evidence. Assert no instruction following, no data disclosure, schema validation, and manual routing when uncertain.
4. **Boundary conditions:** empty/very long/truncated input; malformed/oversized provider response; provider timeout/unavailable; unknown category; conflicting `riskLevel` and `suggestedAction`; confidence at and around threshold; missing, stale, or low-count calibration; category with high overall but poor category-specific results.
5. **Tenant isolation:** identical post/entity across two tenants with different rules; no entity, snapshot, feedback, or report leakage; unauthorized reviewer/admin access; tenant deletion and export access audit.
6. **Automation lifecycle:** kill switch and tenant disable before and during delay; edited post/rule/calibration/model version before execution; user cancellation; duplicate scheduler workers/retry; approval enters correct publish path exactly once; rejection reason and notification are accurate. These are especially important given `apps/server/src/runtime/auto-moderation-scheduler.ts` and the consequence described in `docs/operator/review-and-publish.md`.
7. **Human factors:** reviewer sees AI uncertainty and can override; generated rewrite does not silently replace original; no sensitive full text in group notification/logs; explanation is specific without asserting unverified facts.

Use synthetic fixtures for injection and edge cases. For historical evaluation, use authorized, minimized, access-controlled data per `dev-docs/ai-review-stage-0-acceptance.md`; keep the adjudicated test set separate from threshold-calibration data.

## Suggested release gates

1. **Offline-only gate:** schema/tenant-isolation/privacy/injection tests pass; evaluation inputs are authorized and minimized; fixed held-out per-tenant/category set includes benign hard negatives and high-impact positives; sample counts and label coverage meet a user-approved minimum. No release on an impressive overall agreement score alone.
2. **Advisory/shadow gate:** run without decisions affecting status or publication. Observe failure/unavailable handling, uncertainty routing, reviewer time and override rates; manually adjudicate high-impact misses and benign false positives. Publish per-tenant results to authorized operators only.
3. **Narrow automation gate (only after explicit decision):** opt in per tenant and action/category; require validated calibration on held-out data, pre-agreed upper bounds for high-impact false negatives and benign false positives, sufficient sample size, stable version, delay/cancel path, audit trail, human escalation, and tested kill switch. No automatic rejection until a tenant explicitly approves its narrow criteria and reviewers sign off on examples.
4. **Canary/rollback gate:** start with one consenting tenant and a small eligible cohort; monitor per-tenant/category rates and operational errors; stop automatically or manually on any safety regression, unexplained metric shift, provider/policy version change, or tenant request. Keep a tested global and tenant-level off switch and a documented recovery path. Require renewed approval after material model, prompt, rule, or provider changes.

### User decisions still required

- Which content risks/categories are in scope, and what each wall's rules mean in edge cases; this document does not define universal policy or legal conclusions.
- Whether any provider may receive post text, what notice/consent and provider retention constraints apply, and retention/deletion periods for analyses, feedback, and exports.
- Whether to ever enable automatic approval or rejection, by which categories, and who may opt in/stop it. The design's proposed stages are not authorization to enable them.
- Minimum per-tenant and per-category sample sizes, tolerated error bounds, adjudication process, and whether sensitive subgroup analyses are justified.
- Which modalities and user-history signals may be analyzed. Current `post-review.ts` submits text only; design proposals for OCR/history must not be treated as current capability.
