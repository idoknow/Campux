import importlib.util
import json
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("eval_posts", Path(__file__).with_name("evaluate_historical_posts.py"))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)

class EvaluationTests(unittest.TestCase):
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
