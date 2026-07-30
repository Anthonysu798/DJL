from __future__ import annotations

import importlib.util
import io
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stderr
from pathlib import Path
from unittest.mock import patch

import numpy as np


SCRIPT = Path(__file__).with_name("scratch_hashing_challenger.py")
SPEC = importlib.util.spec_from_file_location("scratch_hashing_challenger", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class ScratchHashingChallengerTest(unittest.TestCase):
    def fixture_row(
        self,
        fixture_id: str,
        split_role: str,
        *,
        label: str = "human",
        language: str = "en",
    ) -> dict[str, str]:
        return {
            "id": fixture_id,
            "label": label,
            "text": f"Fixture text for {fixture_id}.",
            "language": language,
            "splitRole": split_role,
            "sourceGroupId": f"group-{fixture_id}",
        }

    def test_development_partition_keeps_groups_together(self) -> None:
        self.assertEqual(
            MODULE.development_partition("same-question"),
            MODULE.development_partition("same-question"),
        )

    def test_reader_ignores_question_fields(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "fixtures.jsonl"
            path.write_text(
                json.dumps(
                    {
                        "id": "one",
                        "label": "human",
                        "text": "The answer is the only model input.",
                        "language": "en",
                        "Question": "A secret prompt must never become a feature.",
                        "splitRole": "development",
                        "sourceGroupId": " Group   One ",
                    }
                )
                + "\n",
                encoding="utf-8",
            )
            fixture = MODULE.read_fixtures(str(path), "development")[0]
        self.assertFalse(hasattr(fixture, "question"))
        self.assertEqual(fixture.text, "The answer is the only model input.")
        self.assertEqual(fixture.source_group_id, "group one")

    def test_reader_rejects_unknown_split_roles_fail_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "fixtures.jsonl"
            path.write_text(
                json.dumps(self.fixture_row("one", "unspecified")) + "\n",
                encoding="utf-8",
            )
            with self.assertRaisesRegex(ValueError, "unsupported splitRole"):
                MODULE.read_fixtures(str(path))

    def test_reader_rejects_mixed_roles_against_the_selected_role(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "fixtures.jsonl"
            path.write_text(
                "\n".join(
                    [
                        json.dumps(self.fixture_row("one", "validation")),
                        json.dumps(
                            self.fixture_row(
                                "two",
                                "locked",
                                label="ai-refined",
                                language="zh-Hans",
                            )
                        ),
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            with self.assertRaisesRegex(ValueError, "expected validation"):
                MODULE.read_fixtures(str(path), "validation")

    def test_evaluate_cli_requires_validation_or_locked_role(self) -> None:
        base_arguments = [
            str(SCRIPT),
            "evaluate",
            "--artifact",
            "artifact.joblib",
            "--input",
            "fixtures.jsonl",
            "--name",
            "test",
            "--report",
            "report.json",
        ]
        for extra_arguments in ([], ["--split-role", "development"]):
            with self.subTest(extra_arguments=extra_arguments):
                with patch.object(sys, "argv", [*base_arguments, *extra_arguments]):
                    with redirect_stderr(io.StringIO()):
                        with self.assertRaises(SystemExit):
                            MODULE.parse_args()
        with patch.object(
            sys, "argv", [*base_arguments, "--split-role", "validation"]
        ):
            self.assertEqual(MODULE.parse_args().split_role, "validation")

    def test_evaluate_model_rejects_development_role_before_loading_data(self) -> None:
        with self.assertRaisesRegex(
            ValueError, "evaluation split role must be validation or locked"
        ):
            MODULE.evaluate_model(
                "unused-artifact",
                "unused-input",
                "test",
                "unused-report",
                "en",
                "development",
            )

    def test_threshold_requires_wilson_and_all_independence_units_for_support(self) -> None:
        y_true = np.asarray([0] * MODULE.MINIMUM_GATE_HUMANS + [1, 1])
        scores = np.asarray([0.1] * MODULE.MINIMUM_GATE_HUMANS + [0.9, 0.2])
        point = MODULE.choose_threshold(y_true, scores)
        self.assertFalse(point["targetSupportedAt95Confidence"])
        self.assertEqual(
            point["evidenceStatus"], "release-independence-not-established"
        )
        self.assertEqual(point["falsePositives"], 0)
        self.assertEqual(point["truePositives"], 2)
        self.assertLessEqual(
            point["falsePositiveRate95Ci"]["upper"], MODULE.TARGET_FPR
        )
        author_only = MODULE.choose_threshold(
            y_true, scores, human_author_independence_established=True
        )
        self.assertFalse(author_only["targetSupportedAt95Confidence"])
        independent = MODULE.choose_threshold(
            y_true,
            scores,
            human_author_independence_established=True,
            human_source_group_independence_established=True,
            ai_source_group_independence_established=True,
        )
        self.assertTrue(independent["targetSupportedAt95Confidence"])

    def test_threshold_rejects_too_few_human_samples(self) -> None:
        y_true = np.asarray([0] * 100 + [1])
        scores = np.asarray([0.1] * 100 + [0.9])
        with self.assertRaisesRegex(ValueError, "at least"):
            MODULE.choose_threshold(y_true, scores)

    def test_probability_metrics_for_perfect_scores(self) -> None:
        y_true = np.asarray([0, 0, 1, 1])
        scores = np.asarray([0.1, 0.2, 0.8, 0.9])
        metrics = MODULE.probability_metrics(y_true, scores)
        self.assertEqual(metrics["auroc"], 1.0)
        self.assertEqual(metrics["averagePrecision"], 1.0)
        self.assertAlmostEqual(metrics["brierScore"], 0.025)


if __name__ == "__main__":
    unittest.main()
