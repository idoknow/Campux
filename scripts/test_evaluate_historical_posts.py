import importlib.util
import io
import json
import tempfile
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("eval_posts", Path(__file__).with_name("evaluate_historical_posts.py"))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)

class EvaluationTests(unittest.TestCase):
    def test_policy_labels_separate_targets_and_privacy(self):
        cases = [
            {"id":"secret-id", "text":"secret text", "rationale":"secret reason", "expected_model_advice":"normal_allow", "expected_server_action":"allow"},
            {"id":"another-secret", "text":"private", "rationale":"private reason", "expected_model_advice":"proposed_reject", "expected_server_action":"manual_review"},
        ]
        predictions = [
            {"model_advice":"normal_allow", "server_action":"reject"},
            {"model_advice":"mandatory_human_review", "server_action":"manual_review"},
        ]
        report = MODULE.evaluate_policy_cases(cases, predictions)
        self.assertEqual(report["policy_targets"]["model_advice"]["matched"], 1)
        self.assertEqual(report["policy_targets"]["model_advice"]["mismatches"], 1)
        self.assertEqual(report["policy_targets"]["server_action"]["matched"], 1)
        self.assertEqual(report["policy_targets"]["server_action"]["mismatches"], 1)
        rendered = json.dumps(report)
        for secret in ("secret-id", "another-secret", "secret text", "secret reason", "private reason"):
            self.assertNotIn(secret, rendered)

    def test_fixture_labels_are_consumed_without_predictions(self):
        fixture = Path(__file__).parent / "fixtures" / "ai-review-policy-cases.jsonl"
        cases = MODULE.read_jsonl(fixture)
        report = MODULE.evaluate_policy_cases(cases)
        self.assertEqual(report["policy_targets"]["model_advice"]["total"], len(cases))
        self.assertEqual(report["policy_targets"]["model_advice"]["labeled"], 0)
        self.assertEqual(report["policy_targets"]["server_action"]["labeled"], 0)

    def test_policy_cli_reads_separate_prediction_file_and_emits_aggregate_only_report(self):
        from contextlib import redirect_stdout
        fixture = Path(__file__).parent / "fixtures" / "ai-review-policy-cases.jsonl"
        cases = MODULE.read_jsonl(fixture)
        predicted = [{"model_advice": c["expected_model_advice"], "server_action": c["expected_server_action"], "text": "private output"} for c in cases]
        with tempfile.TemporaryDirectory() as directory:
            prediction_file = Path(directory) / "predictions.jsonl"
            prediction_file.write_text("".join(json.dumps(row) + "\n" for row in predicted), encoding="utf-8")
            output = io.StringIO()
            with redirect_stdout(output):
                code = MODULE.main([str(fixture), "--policy-cases", "--predictions", str(prediction_file)])
        self.assertEqual(code, 0)
        report = json.loads(output.getvalue())
        self.assertEqual(report["policy_targets"]["model_advice"]["matched"], 20)
        self.assertEqual(report["policy_targets"]["server_action"]["matched"], 20)
        self.assertNotIn("allow-event-notice", output.getvalue())
        self.assertNotIn("private output", output.getvalue())
    def test_tenant_metrics_confusion_and_mismatches(self):
        rows = [
            {"tenant_id":"a", "human_action":"approve", "prediction":{"suggestedAction":"approve","categories":["x"]}},
            {"tenant_id":"a", "human_action":"reject", "prediction":{"suggestedAction":"approve","categories":["x"]}},
            {"tenant_id":"b", "prediction":{"suggestedAction":"reject","categories":["y"]}},
        ]
        report = MODULE.evaluate(rows)
        self.assertEqual(report["tenants"]["a"]["match_rate"], 0.5)
        self.assertEqual(report["tenants"]["a"]["confusion"]["false_negative"], 1)
        self.assertEqual(report["tenants"]["b"]["labeled"], 0)
        self.assertEqual(report["tenants"]["a"]["top_mismatch_types"][0]["type"], "action_mismatch")

    def test_caps_text_and_never_returns_post_content(self):
        row = {"tenant_id":"t", "text":"SECRET" * 3000, "human_action":"approve", "prediction":{"suggestedAction":"approve"}}
        report = MODULE.evaluate([row])
        self.assertNotIn("SECRET", json.dumps(report))
        self.assertEqual(MODULE.provider_payload(row)["text"], ("SECRET" * 3000)[:MODULE.MAX_TEXT_CHARS])

    def test_malformed_prediction_does_not_crash(self):
        self.assertEqual(MODULE.evaluate([{"tenant_id":"t", "prediction":None}])["tenants"]["t"]["labeled"], 0)

    def test_invalid_input_rejected(self):
        with self.assertRaises(ValueError):
            MODULE.evaluate([{"text":"missing tenant"}])

if __name__ == "__main__": unittest.main()
