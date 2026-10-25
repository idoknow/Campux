# AI review policy proposal (offline; not runtime policy)

**Status:** proposed guidance for evaluation and human discussion only. This document does not change wall rules, model prompts, server decisions, or settings. Each wall's explicitly configured rules remain controlling; this proposal does not presume unprovided rules. AI output is advisory, not a finding of fact or a substitute for a reviewer.

## Decision vocabulary

For this proposal, the three buckets mean:

- **Proposed reject:** Recommend rejection only where the text itself supplies clear, direct evidence of a serious violation of an explicit applicable rule or a clear, imminent safety threat. The model must identify the specific text and rule/risk, explain why context does not plausibly reverse the meaning, and have high confidence (proposed >=0.95). A reviewer remains responsible for the actual rejection. This label alone does not authorize an automatic server rejection.
- **Mandatory human review:** Recommend review where plausible interpretations differ, evidence is incomplete, the consequences are material, or a privacy, safety, legal, identity, or policy question needs context. This includes all sensitive personal-data findings, targeted allegations, threats, suspected minors, ambiguous sexual content, coded or obfuscated solicitation, uncertain quotations/satire, policy ambiguity, and model uncertainty. Do not infer guilt, identity, intent, or truth from an allegation or model score.
- **Normal allow:** Recommend ordinary human workflow / allow only where no specific applicable rule violation or material safety/privacy concern is evidenced, context is sufficient, and confidence is high (proposed >=0.90). Benign criticism, disagreement, ordinary romance, neutral news, and general non-identifying requests are not violations merely because they are uncomfortable. An allow recommendation is not publication authorization.

Thresholds are conservative proposal thresholds, not measured performance claims. Confidence is not a probability of truth; it cannot override evidence requirements. If action and risk conflict, use the more cautious bucket. Missing, truncated, contradictory, malformed, out-of-scope, or context-dependent inputs go to human review. No model-only decision should identify a person, validate a factual allegation, or resolve legal ambiguity.

## Evidence and boundaries

1. Base judgments on the submitted text and applicable, explicit wall rule; distinguish quoted, reported, hypothetical, negated, and first-person content. Do not treat keywords alone as proof.
2. A proposed rejection needs an explicit rule match or clearly evidenced imminent danger, with concrete quoted evidence. Strong dislike, vague suspicion, unsourced accusations, and model confidence alone are insufficient.
3. A human reviewer should assess context, proportionality, privacy exposure, and possible safe edits. Where editing may cure a concern, suggest a minimal redaction/revision rather than treating it as established misconduct.
4. Treat personal identifiers, contact details, precise location, private messages, health/academic data, and identity-linked allegations as sensitive even when a submitter calls a post anonymous. Avoid reproducing sensitive material in explanations; use minimal redacted excerpts.
5. Do not make legal determinations. Content that could involve defamation, harassment, discrimination, sexual exploitation, self-harm, violence, or unlawful conduct requires context-sensitive human review unless an explicit rule and direct evidence meet the proposed reject threshold. Immediate credible threats should be escalated using established safety procedures; the model must not invent an emergency workflow.
6. Apply configured rules only within their scope. A tenant's rules and data must not be borrowed from another wall. If a rule is absent, unclear, conflicting, or possibly unlawful, do not invent a prohibition: route to an authorized human.
7. Text-only review cannot clear images, OCR, audio, or linked material. State that limitation; review those materials separately under the applicable process.
8. Evaluation material must be synthetic or effectively anonymized; never add real names, handles, contact details, post IDs, or identifiable incidents. Store and inspect examples with least access, tenant separation, and retention appropriate to approved evaluation.

## Advice versus server action

Existing auto-moderation code fails closed to `manual_review` unless specific gates pass: enabled and not kill-switched; low risk and no sensitive findings; configured action enabled; confidence threshold; for rejection, a configured blocked-pattern match; for approval, an allowlisted category plus minimum validated samples and category agreement threshold. A model suggestion alone does not reject. Failures/unavailable analysis are not positive evidence. The design document also describes staged rollout and human oversight. This proposal does not assert that an example's expected action is what any current deployment will do.

In the corpus, `expected_server_action` is a conservative **target for policy evaluation**, not a claim about present implementation. `manual_review` means keep pending for an authorized reviewer; `allow` means no policy-based block in the hypothetical example, while ordinary human workflow still applies; `reject` is reserved for direct, high-evidence cases with an explicitly supplied applicable rule. With no rule supplied, the corpus does not presume a wall-specific ban. Expected model advice uses the three proposal buckets above. Synthetic contexts and rules are stated per case.

## Evaluation and disagreement handling

Measure separately: false-reject rate on benign/quoted/critical speech; missed high-evidence privacy or safety risks; escalation rate for genuinely ambiguous cases; and model/server-action disagreement. Stratify by language, slang, obfuscation, quotation, negation, and short/long text where lawful and privacy-safe. A reviewer label is the adjudication target, not model consensus. Inspect false positives before broadening rules; do not optimize toward rejection volume. A case without enough context should be labeled ambiguous, not forced into a binary answer. Version this proposal and corpus when criteria change; remove examples that risk re-identification.
