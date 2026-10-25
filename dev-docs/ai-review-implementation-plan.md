# AI moderation decisions: implementation plan and checklist

**Status:** proposal only. No runtime behavior is changed by this document. Product/operations owners must approve policy semantics and rollout thresholds before implementation. This plan does not set a new policy baseline, change production mode, or restore any daily quota.

## 1. Scope and intended outcome

Make moderation decisions explicit, schema-validated, grounded in inspectable evidence, and safe under malformed output, stale settings, retries, and service failure. Preserve human review as the operational fallback. Keep `off`, `shadow`, `assist`, and `auto` semantics distinct; do not treat configuration of an auto mode as authorization to execute a decision. Any future auto execution must be gated by a fully validated assessment, explicit applicable policy, current safety checks, durable audit, and delayed revalidation.

### Current behavior (observed)

- Tenant AI settings are stored in `TenantAiSettings.rules` JSON. `ai-settings.ts` defaults review mode to `off`; default auto-moderation flags are false, default minimum confidence is 0.98, sample floor is 100, and execution delay is 60 seconds. `normalizeAiRules` silently defaults unsupported review modes to `off`, clamps values and drops malformed string-array members. `routes/ai.ts` validates settings input with Zod, but the assessment parser is handwritten.
- `routes/posts.ts` (around line 1195) starts `assessPostForReview` asynchronously after post creation; `onebot.ts` (around line 3032) also invokes it. `post-review.ts` reads current settings, and only calls the provider when AI is enabled, mode is `llm`, and a key is configured. It bounds provider response bytes, requires a JSON object envelope, and parses content with `parsePostReviewAssessment`. Invalid schema/network/provider outcomes become failed/unavailable; logs contain error name and post/tenant IDs.
- Assessment fields are enumerated in `post-review.ts`: risk level, categories, sensitive findings, suggested action, reasons, confidence, and optional text/rejection suggestions. The parser rejects extra keys and enforces ranges/lengths, but does not establish that excerpts or reasons are supported by the submitted post, nor that categories/actions correspond to evidence. Provider prompt says not to decide post status, but persisted auto mode can stage a decision.
- In `auto-moderation.ts`, only low-risk, no-sensitive-finding cases can pass. Reject requires the auto-reject flag, a case-insensitive substring match against configured blocked patterns, and confidence floor. Approve requires enabled flag, confidence, `suggestedAction=approve`, aggregate labeled feedback sample floor, category allowlist, and category match rate >= 0.98 with enough category samples. Other outcomes fall back to manual review. These constants/semantics are current implementation, not an endorsed policy baseline.
- `post-review.ts` persists auto-mode actions as `approve`, `reject`, or `manual_review`; execution delay applies to non-manual outcomes. Shadow writes analysis with no automatic action. `autoDecisionReason` is free text; there is no explicit policy version or decision trace object. `writeAutoAssessmentDecision` can emit `manual_review` for unavailable/failed results.
- `auto-moderation-scheduler.ts` polls every 5 seconds, claims due rows with leases, rechecks active tenant, mode, policy flags, global kill switch, post status, calibration, and the gate before mutation; it cancels stale/changed decisions. Approvals may enter existing publish flows; failures after commit are handled by a recovery sweep. Admin/reviewer can revert staged/committed decisions via review routes. This is consequential workflow, so any changes must preserve transaction and lease behavior.
- `PostAiAnalysis`, `AiFeedback`, `SchoolEntity`, and `SchoolModelSnapshot` are tenant-scoped Prisma models. Analysis columns store assessment values as nullable scalars/JSON, feedback records human action and categories, and entities have JSON `evidence`. The stage-1 migration adds human-review storage; the later schedule/quota-named migration adds durable scheduling fields and feedback categories. Do not reintroduce quota behavior or infer policy from that migration's name.
- `AdminPage.tsx` exposes mode, moderation flags, category/pattern lists, confidence/sample/delay controls, school entities, and snapshot refresh. The warning text currently refers to a daily cap, although current types and gate do not include one; remove or correct that stale UI copy if UI is touched. `PostsPage.tsx` renders findings and supports reviewer feedback. Route response typing is mirrored in `apps/web/src/types/app.ts`.
- Stage 0 already has an offline historical evaluator (`scripts/evaluate_historical_posts.py`) and acceptance note (`dev-docs/ai-review-stage-0-acceptance.md`): authorized minimized JSONL, aggregate-only report, no DB/network by default, up to 12k characters passed to an injected adapter, and no production side effects.

## 2. Proposed decision contract (owner approval required)

Implement a versioned, strict runtime contract shared by provider output validation, persistence decoding, policy evaluation, and API/UI serialization. Prefer a central Zod schema (or equivalent) with explicit `schemaVersion`; reject unknown keys, invalid enum values, overlong strings/arrays, non-finite numbers, invalid nullability, and inconsistent fields. Preserve bounded response reading and safe URL checks.

Represent a decision as distinct layers rather than conflating model opinion and action:

1. **Assessment:** structured risk observations and claims, each with stable category/code, concise rationale, and evidence references into the submitted text or tenant-approved context. Sensitive excerpts must be bounded, privacy-conscious, and demonstrably present in source (exact/normalized span strategy to be designed). Model-suggested action remains advisory.
2. **Policy evaluation:** explicit policy identifier/version and normalized policy snapshot; named deterministic rules with rule IDs, evaluated inputs, pass/fail/indeterminate outcomes, and reason codes. Missing/invalid policy, unsupported versions, indeterminate evidence, or incomplete calibration must resolve to `manual_review`, never permissive defaults.
3. **Final disposition:** `manual_review`, `stage_approve`, or `stage_reject` (or equivalent explicit staged state), with `executeAfter` only for eligible auto decisions. Persist model suggestion separately from final policy disposition. Human overrides remain separate events.
4. **Evidence/provenance:** source post revision/hash, provider/model identifiers, prompt/schema version, tenant snapshot ID/version, policy version/hash, and evidence references. Avoid duplicating full post text or secrets in audit/policy records.

Define whether categories are a controlled vocabulary, how aliases map, and whether reject evidence must quote a literal configured rule hit. These are owner decisions; current substring behavior is not automatically the desired future contract.

## 3. Phases and checklist

### Phase 0 — offline/shadow readiness (no decision execution)

- [ ] Owner approves policy vocabulary, decision semantics, privacy retention, evidence grounding rules, and named rollout metrics.
- [ ] Review existing Stage 0 evaluator and fixtures; add schema-versioned fixtures for valid, malformed, unsupported-version, and evidence-mismatch outputs. Keep CLI offline/read-only by default.
- [ ] Establish proposal-only sample thresholds before testing. Candidate gates for owner review (not defaults): at least 500 labeled examples per tenant and 200 per automated category; at least 99.5% precision for auto-approve and 99.9% precision for auto-reject; zero unresolved critical false negatives; 100% schema-valid/evidence-grounded candidates; independently reviewed confidence intervals and minimum elapsed observation period. Owner may reject/replace every number; thresholds cannot become defaults without sign-off.
- [ ] Run only on authorized, minimized exports; report tenant/category denominators, action confusion, calibration and evidence-validation failures, without text or post IDs. Review false positives/negatives with authorized reviewers.
- [ ] Stage 0 must not write production analysis rows, mutate posts, call an implicit network provider, or alter mode/settings. An optional injected provider remains explicitly opt-in and bounded.

### Phase 1 — explicit schema and safe persistence, still human-owned

- [ ] Add shared schema/types and a parser contract in `apps/server/src/runtime/post-review.ts` or a focused adjacent runtime module; keep provider envelope parsing separate from assessment parsing.
- [ ] Validate both fresh provider output and every persisted JSON/scalar reconstruction (`parsePostReviewAnalysisRecord`, `parsePersistedPostReviewDetail`). Unknown schema versions and invalid records must return unavailable/invalid, not be cast into trusted types.
- [ ] Add evidence-grounding validators: references must resolve to source text/context, offsets must be bounded and consistent, and cited policy/entity context must identify its tenant-scoped snapshot. Define normalization carefully so Unicode/zero-width transformations cannot turn unrelated text into a match.
- [ ] Keep `assist` as advisory-only; ensure failed/unavailable/invalid output cannot change status and UI communicates unavailable/manual workflow. Ensure `shadow` stores comparisons only and never queues an executable decision.
- [ ] Add structured failure reason codes and safe operator diagnostics; do not store raw provider response, API key, or unnecessary personal text in logs/audit.

### Phase 2 — policy decision trace and compatible storage

- [ ] Define a versioned policy snapshot and deterministic evaluator in `apps/server/src/runtime/auto-moderation.ts`; return typed rule-by-rule trace plus final disposition, not just free-text reason.
- [ ] Explicitly distinguish absent policy, disabled policy, kill switch, missing calibration, stale calibration, unsupported schema/policy version, evidence mismatch, and conflicting rules. Every uncertainty blocks automatic execution.
- [ ] Preserve the currently configured false-by-default switches and mode default `off`; do not enable auto behavior as migration side effect. Preserve absence/unknown fields conservatively rather than guessing an owner-approved baseline.
- [ ] Persist policy/schema versions and compact decision trace with an additive migration to `PostAiAnalysis` (or an additive tenant-scoped decision record if trace size/retention warrants it). Keep existing columns readable during transition; old rows lacking trace must be non-executable and render as legacy advisory data.
- [ ] Update both PostgreSQL and SQLite schema/migration paths, including canonical SQLite migration runner and baseline. Preserve tenant composite constraints and use backfill only for explicitly safe metadata; do not reconstruct missing evidence/policy versions from guesses.
- [ ] Keep new writes dual-readable during a compatibility window: writer emits new trace plus legacy `autoDecision`/`autoDecisionReason` fields needed by existing readers; reader accepts legacy rows for display but never treats them as eligible for execution. Retire compatibility only after all app versions and data are verified.

### Phase 3 — delayed execution hardening

- [ ] Update `apps/server/src/runtime/auto-moderation-scheduler.ts` to require valid trace/schema/policy versions, current policy snapshot, matching source post revision, and successful reevaluation before claiming/mutating.
- [ ] Maintain lease, cancellation, transaction, audit, post log, publish recovery, notification, and revert invariants. On any read/validation/provider-independent runtime error, leave post pending for human review and clear/release claim safely; never convert an error into approve/reject.
- [ ] Consider making policy edits, source-post edits, and human actions cancel pending staged decisions transactionally. Verify kill-switch precedence from tenant and system settings.
- [ ] Do not add or restore a daily quota. Confirm UI text and backend contracts have no quota field/branch.

### Phase 4 — admin/reviewer explainability and operations

- [ ] Update `apps/server/src/routes/ai.ts` validation and settings types only after approved schema/policy contract; reject invalid values rather than silently coercing security-relevant controls.
- [ ] Update `apps/web/src/features/admin/AdminPage.tsx` with explicit policy summary/version, rule identifiers, staged-vs-final semantics, calibration denominators/coverage, and warnings. Remove stale daily-cap wording; do not change production mode as part of this plan.
- [ ] Update `apps/web/src/features/posts/PostsPage.tsx`, `apps/server/src/routes/review.ts`, and `apps/web/src/types/app.ts` to render evidence references, decision trace, schema status, and clear human fallback. Avoid exposing sensitive raw evidence to roles without authorization.
- [ ] Add audit events for policy change, decision staged/cancelled/executed/reverted with trace/version identifiers and minimal data. Define retention/access controls with owner approval.

## 4. Exact source touchpoints

| Concern | Current touchpoint | Planned work |
| --- | --- | --- |
| Settings/defaults/normalization | `apps/server/src/runtime/ai-settings.ts` (`defaultAiSettings`, `normalizeAiRules`, `normalizeAutoModeration`) | Preserve safe defaults; make security-sensitive invalid values explicit; centralize versioned policy normalization. |
| HTTP settings contract | `apps/server/src/routes/ai.ts` (`aiSettingsSchema`) | Align Zod validation with approved policy schema; test partial update/legacy JSON compatibility. |
| Model output parsing/provider call | `apps/server/src/runtime/post-review.ts` (`PostReviewAssessment`, `parsePostReviewAssessment`, `readBoundedLlmResponse`, `assessPostForReview`) | Strict versioned schema; evidence validation; separate model recommendation from policy result; typed error reasons. |
| Deterministic gate | `apps/server/src/runtime/auto-moderation.ts` | Explicit rule outcomes/reason codes and policy version; conservative handling of indeterminate inputs. |
| Decision persistence | `apps/server/src/runtime/post-review.ts` (`writeAutoAssessment`, `writeAutoAssessmentDecision`) | Additive trace persistence and legacy dual-write; prevent invalid/legacy row eligibility. |
| Delayed worker | `apps/server/src/runtime/auto-moderation-scheduler.ts` | Validate trace and current source/policy before execution; preserve claims, transaction, cancellations, recovery. |
| Trigger points | `apps/server/src/routes/posts.ts` around 1195; `apps/server/src/runtime/onebot.ts` around 3032 | Confirm both submission paths preserve same asynchronous/failure semantics and tenant boundary. |
| APIs/review feedback | `apps/server/src/routes/review.ts`; `apps/server/src/routes/ai-review.ts` | Return validated trace safely; preserve feedback auditability and reviewer authorization. |
| Admin/reviewer UI | `apps/web/src/features/admin/AdminPage.tsx`; `apps/web/src/features/posts/PostsPage.tsx`; `apps/web/src/types/app.ts` | Explain policy/evidence/fallback; retain human workflow; correct quota copy. |
| Persistence | `packages/db/prisma/schema.prisma`, `schema.sqlite.prisma`, `packages/db/prisma/migrations/*`, `packages/db/src/migrate-sqlite.ts` | Additive fields/record, PostgreSQL + canonical SQLite migration, compatibility checks. |
| Offline acceptance | `scripts/evaluate_historical_posts.py`, `scripts/test_evaluate_historical_posts.py`, `dev-docs/ai-review-stage-0-acceptance.md` | Extend aggregate-only tests/metrics and owner-approved thresholds without production side effects. |

## 5. Failure semantics (required)

| Condition | Required outcome |
| --- | --- |
| AI disabled, review mode off, no credentials, tenant inactive | No auto disposition; preserve existing post workflow. If an analysis is recorded, mark unavailable with reason code. |
| Timeout, network/provider error, response too large, malformed envelope/JSON, schema violation, unknown version | `failed` or `unavailable`; no approve/reject; pending post remains for human review. |
| Evidence does not resolve to submitted post or approved context; evidence too long/ambiguous | Reject assessment as untrusted; no auto disposition; record bounded failure code. |
| Policy absent, invalid, unknown version, internally conflicting, or stale | `manual_review`; no permissive fallback/default policy. |
| Insufficient/invalid calibration, unsupported category, non-low risk, sensitive finding, model action disagreement | `manual_review`. Recompute calibration denominator from validated, tenant-scoped feedback only. |
| Kill switch, mode/flag change, post no longer pending, source revision changed, policy/evidence trace mismatch | Cancel staged action atomically; preserve cancellation reason and allow human review. |
| Persistence/transaction/lease failure before commit | No post status mutation; retry only via idempotent durable mechanism or leave human-reviewable. |
| Post commit notification/publish failure | Do not undo committed decision implicitly; use existing recovery/idempotency paths and surface operational failure. |

## 6. Migration and backward compatibility checklist

- [ ] Inventory live PostgreSQL and SQLite schemas before choosing field/table design; migration names alone do not prove what has been applied.
- [ ] Add nullable/versioned trace storage first; do not make legacy rows satisfy new execution criteria by backfill.
- [ ] Generate/check both Prisma schemas and migration SQL. SQLite upgrades must go through `applySqliteBaseline`; `sqlite.sql` is documented as a reference, not safe partial-schema upgrade path.
- [ ] Verify existing schedule migration columns/index types/definitions before applying; its README warns `IF NOT EXISTS` cannot verify a pre-existing same-name index and PostgreSQL prerequisite mismatches must fail.
- [ ] Deploy readers that tolerate old and new records but only new valid records can stage/execute. Then deploy writers. Keep behavior off/shadow until separate approval.
- [ ] Rollback app compatibility: new schema fields remain nullable and old code can ignore them; do not roll back by dropping data or changing post statuses. Document treatment of pending staged rows before rollback.
- [ ] Test tenant isolation, foreign keys, indexes, restart recovery, and upgrade from partial provisioning for both database engines.

## 7. Tests and verification gates

- Unit: schema valid/invalid/extra keys/unknown version/nullability/ranges/size limits; evidence spans with Unicode, normalization, repeated excerpts, omitted or forged references; policy rule trace determinism; every branch falls back safely.
- Settings: absent/legacy/partial/malformed JSON normalization; no accidental mode enablement; HTTP Zod rejects invalid controls; explicit update and readback behavior.
- Persistence: serialize/deserialize current and legacy rows; legacy/null trace never executable; migration idempotency/partial-schema failure behavior, tenant composite FK, SQLite canonical runner.
- Scheduler integration: valid due decision; kill switch toggled after staging; policy/calibration changed; post edited/withdrawn/reviewed; duplicate workers/stale lease; transaction failure; process restart; approval publish recovery; rejection notification/revert.
- API/UI: role authorization, hidden sensitive evidence for unauthorized roles, feedback link integrity, trace rendering, failed/unavailable manual guidance, mode and setting defaults.
- Offline Stage 0: fixture tests, aggregate denominators, false-positive/false-negative accounting, no post text/identifiers in output, oversized/malformed inputs, deterministic report, no network/DB effects.
- Gate progression: (a) offline evaluation signed off; (b) shadow-only production observation explicitly approved, with no state mutation; (c) assist UI approved; (d) any auto eligibility separately approved with rollback/kill-switch drill and thresholds. No gate automatically changes production mode.

## 8. Approval decisions and unverified assumptions

### Owner decisions required

- Whether the proposed evidence reference format, allowed categories, policy versioning, and trace retention meet product/privacy needs.
- Whether any approve/reject automation is intended, and the permitted categories/rules, confidence/calibration definitions, sample floors, precision targets, confidence intervals, observation period, and tenant eligibility. Sample numbers in Phase 0 are examples for approval only, not defaults.
- Whether Stage 0 shadow means offline-only or separately approved live shadow; this plan recommends offline first and requires explicit approval for live shadow.
- Whether sensitive findings may be shown to all reviewers or only admins, and retention/deletion periods for traces and feedback.

### Unverified assumptions / evidence limits

- Repository inspection cannot establish live tenant settings, production modes, database migration state, actual data quality, provider-specific JSON-schema guarantees, or operator procedures. Verify those before rollout.
- Historical evaluator measures action agreement, not evidence truth or calibrated probability; additional reviewed evidence annotations are required to measure grounding.
- Current `minimumValidatedSamples` and match-rate gate are implementation behavior, not proof of statistically sufficient safety. Feedback records may be biased or incomplete; eligibility/quality criteria need approval and analysis.
- The admin panel currently shows auto controls even though settings default disabled; do not infer that a tenant has opted in from UI availability or repository defaults.
- Current source post revision is not visibly bound into the analysis record in inspected model fields; exact edit/revision behavior and whether pending posts can be edited require route-level follow-up before implementation.
- Existing user-facing warning mentions a daily limit, but no daily quota is present in the inspected settings type/gate/scheduler; treat this as stale copy, not a hidden policy.

## 9. Definition of ready to implement

- [ ] Product/policy owner signs the decision vocabulary, evidence standard, policy baseline, and rollout thresholds.
- [ ] Operations confirms database state, kill-switch ownership, dashboards/alerts, rollback, and staged-row treatment.
- [ ] Privacy/security approves evidence minimization, tenant isolation, access, and retention.
- [ ] The plan is converted into independently testable slices; implementation remains blocked from production auto mode until separately authorized.
