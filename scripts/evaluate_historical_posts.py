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
    parser.add_argument("--provider", action="store_true", help="run supplied local adapter per row; unavailable in CLI unless embedded")
    args = parser.parse_args(argv)
    try:
        rows = read_jsonl(args.input)
        if args.provider:
            if provider is None:
                raise ValueError("provider adapter must be supplied by an embedding; no network provider is built in")
            for row in rows:
                row["prediction"] = provider(provider_payload(row))
        report = json.dumps(evaluate(rows), ensure_ascii=False, indent=2) + "\n"
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
