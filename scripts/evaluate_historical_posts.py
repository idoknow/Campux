#!/usr/bin/env python3
"""Offline, read-only evaluator for exported historical post JSONL."""
import argparse
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Callable

MAX_TEXT_CHARS = 12000
MAX_INPUT_BYTES = 50 * 1024 * 1024
ACTIONS = {"approve", "revise", "reject", "manual_review"}


def provider_payload(row: dict) -> dict:
    return {"text": str(row.get("text", ""))[:MAX_TEXT_CHARS]}


def evaluate(rows: list[dict]) -> dict:
    groups = defaultdict(list)
    for row in rows:
        tenant = row.get("tenant_id")
        if not isinstance(tenant, str) or not tenant:
            raise ValueError("each row requires a non-empty tenant_id")
        groups[tenant].append(row)
    tenants = {}
    for tenant, items in sorted(groups.items()):
        def get_prediction(row: dict) -> dict:
            value = row.get("prediction")
            return value if isinstance(value, dict) else {}

        labeled = [r for r in items if r.get("human_action") in ACTIONS]
        matched = sum(get_prediction(r).get("suggestedAction") == r["human_action"] for r in labeled)
        confusion = Counter()
        mismatches = Counter()
        for row in labeled:
            human, predicted_action = row["human_action"], get_prediction(row).get("suggestedAction")
            if human == predicted_action:
                confusion["match"] += 1
            else:
                # Treat reject as positive moderation action; false positive = AI rejects human-approved.
                confusion["false_positive" if predicted_action == "reject" and human != "reject" else "false_negative" if human == "reject" and predicted_action != "reject" else "other_mismatch"] += 1
                mismatches["action_mismatch"] += 1
            if "human_categories" in row and isinstance(row["human_categories"], list):
                ai_categories = set(get_prediction(row).get("categories", []))
                human_categories = set(row["human_categories"])
                if ai_categories != human_categories:
                    mismatches["category_mismatch"] += 1
        tenants[tenant] = {"total": len(items), "labeled": len(labeled), "matched": matched,
                           "match_rate": matched / len(labeled) if labeled else None,
                           "confusion": {key: confusion[key] for key in ("match", "false_positive", "false_negative", "other_mismatch")},
                           "top_mismatch_types": [{"type": k, "count": v} for k, v in mismatches.most_common(5)]}
    return {"schema_version": 1, "tenants": tenants}


POLICY_TARGETS = {
    "expected_model_advice": "model_advice",
    "expected_server_action": "server_action",
}


def evaluate_policy_cases(rows: list[dict], predictions: list[dict] | None = None) -> dict:
    """Compare policy fixture labels with supplied local predictions, emitting counts only."""
    actual_rows = predictions if predictions is not None else rows
    if len(rows) != len(actual_rows):
        raise ValueError("policy cases and predictions must have equal length")
    targets = {}
    totals = Counter()
    for expected_key, actual_key in POLICY_TARGETS.items():
        confusion = Counter()
        labeled = 0
        for case, result in zip(rows, actual_rows):
            expected = case.get(expected_key)
            actual = result.get(actual_key)
            if actual is None and isinstance(result.get("prediction"), dict):
                actual = result["prediction"].get(actual_key)
            if not isinstance(expected, str) or not expected:
                raise ValueError(f"each policy case requires a non-empty {expected_key}")
            if not isinstance(actual, str) or not actual:
                continue
            labeled += 1
            confusion[f"{expected}->{actual}"] += 1
            totals[f"{expected}->{actual}"] += 1
        targets[expected_key.removeprefix("expected_")] = {
            "total": len(rows), "labeled": labeled,
            "matched": sum(count for pair, count in confusion.items() if pair.split("->", 1)[0] == pair.split("->", 1)[1]),
            "confusion": dict(sorted(confusion.items())),
            "mismatches": sum(count for pair, count in confusion.items() if pair.split("->", 1)[0] != pair.split("->", 1)[1]),
        }
    return {"schema_version": 1, "policy_targets": targets,
            "aggregate": {"confusion": dict(sorted(totals.items())), "labeled": sum(v["labeled"] for v in targets.values()),
                          "mismatches": sum(v["mismatches"] for v in targets.values())}}


def read_jsonl(path: Path) -> list[dict]:
    if path.stat().st_size > MAX_INPUT_BYTES:
        raise ValueError(f"input exceeds {MAX_INPUT_BYTES} bytes")
    rows = []
    with path.open(encoding="utf-8") as stream:
        for line_no, line in enumerate(stream, 1):
            if not line.strip():
                continue
            value = json.loads(line)
            if not isinstance(value, dict):
                raise ValueError(f"line {line_no} must be a JSON object")
            rows.append(value)
    return rows


def main(argv=None, provider: Callable[[dict], dict] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="JSONL export; never connects to a database")
    parser.add_argument("--output", type=Path, help="write aggregate-only JSON report")
    parser.add_argument("--predictions", type=Path, help="separate offline JSONL results, one object per case")
    parser.add_argument("--policy-cases", action="store_true", help="evaluate policy fixture labels from offline prediction fields")
    parser.add_argument("--provider", action="store_true", help="run supplied local adapter per row; unavailable in CLI unless embedded")
    args = parser.parse_args(argv)
    try:
        rows = read_jsonl(args.input)
        if args.predictions:
            if not args.policy_cases:
                raise ValueError("--predictions requires --policy-cases")
            predictions = read_jsonl(args.predictions)
            report_data = evaluate_policy_cases(rows, predictions)
        elif args.policy_cases:
            report_data = evaluate_policy_cases(rows)
        else:
            report_data = evaluate(rows)
        if args.provider:
            if provider is None:
                raise ValueError("provider adapter must be supplied by an embedding; no network provider is built in")
            for row in rows:
                row["prediction"] = provider(provider_payload(row))
            report_data = evaluate_policy_cases(rows) if args.policy_cases else evaluate(rows)
        report = json.dumps(report_data, ensure_ascii=False, indent=2) + "\n"
        if args.output:
            args.output.write_text(report, encoding="utf-8")
        else:
            sys.stdout.write(report)
        return 0
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2

if __name__ == "__main__":
    raise SystemExit(main())
