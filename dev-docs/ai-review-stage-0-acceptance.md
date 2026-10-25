# AI review Stage 0: offline historical-post evaluation

## Contract

Use `scripts/evaluate_historical_posts.py` against an authorized, minimized JSONL export. Each line is an object with `tenant_id`, optional `text`, optional `human_action` (`approve`, `revise`, `reject`, `manual_review`), optional `human_categories`, and optional `prediction` with `suggestedAction` and `categories`. No database, network, production endpoint, or LLM access is performed by the CLI. Aggregate output contains tenant IDs, counts, match rate among labeled posts, reject-based false-positive/false-negative counts, and up to five mismatch types; it never includes post text or identifiers.

Text handed to an embedded provider adapter is limited to 12,000 characters. Input file size is capped at 50 MiB. The CLI has no built-in network provider; an adapter must be injected by an embedding via `main(..., provider=callable)` and receives only the bounded text payload. Store exports and reports securely; do not commit real posts, credentials, or provider responses.

## Repeatable policy-fixture acceptance

From the repository root, run the following to exercise the complete file-based workflow. The first command creates deterministic synthetic demo predictions from fixture labels (this validates file integration/reporting, not model quality); replace that file with output from an approved local inference runner for a real evaluation.

```sh
python3 -c 'import json; from pathlib import Path; cases=[json.loads(x) for x in Path("scripts/fixtures/ai-review-policy-cases.jsonl").read_text().splitlines() if x.strip()]; Path("/tmp/ai-review-stage-0-predictions.jsonl").write_text("".join(json.dumps({"model_advice":c["expected_model_advice"],"server_action":c["expected_server_action"]})+"\\n" for c in cases))'
python3 scripts/evaluate_historical_posts.py scripts/fixtures/ai-review-policy-cases.jsonl --policy-cases --predictions /tmp/ai-review-stage-0-predictions.jsonl --output /tmp/ai-review-stage-0-report.json
python3 -m json.tool /tmp/ai-review-stage-0-report.json
```

The report contains counts and confusion pairs only, not case text, IDs, rationale, or prediction payloads. For real evaluation, prediction rows must come from local inference on the corresponding case inputs—not expected labels—and be in fixture order. `--predictions` expects one JSON object per case, with non-empty `model_advice` and `server_action` strings. The CLI itself performs no database, network, or provider calls.

Run tests: `python3 -m unittest scripts/test_evaluate_historical_posts.py -v`.

## Historical export acceptance

1. Export only authorized historical posts to JSONL; retain `tenant_id`, human action, optional human category labels, and text only when needed. Remove direct identifiers and secrets before export.
2. Test fixture-only behavior: `python3 -m unittest scripts/test_evaluate_historical_posts.py -v`.
3. Run on the minimized export: `python3 scripts/evaluate_historical_posts.py export.jsonl --output report.json`.
4. Review per-tenant labeled denominators and match rates; inspect false-positive/false-negative counts. Category mismatch counts are meaningful only where `human_categories` are supplied. Investigate the listed mismatch types with authorized reviewers using the source system separately; the report intentionally cannot identify posts.
5. Acceptance requires a valid aggregate report, no post content in report output, explicit labeled sample counts, and manual sign-off on mismatches before considering any future stage. This tool does not approve/reject posts or validate live provider/database integration.

No production database, model, or network is required or touched by this workflow.