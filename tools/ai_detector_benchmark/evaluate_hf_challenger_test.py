from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import types
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("evaluate-hf-challenger.py")
SPEC = importlib.util.spec_from_file_location("evaluate_hf_challenger", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class EvaluateHfChallengerTest(unittest.TestCase):
    def scored(self, label: str, score: float, metadata=None):
        fixture = MODULE.Fixture(
            id=f"{label}-{score}",
            label=label,
            text="private text",
            language="en",
            provenance="test",
            license="MIT",
            metadata={} if metadata is None else metadata,
        )
        return MODULE.ScoredFixture(fixture=fixture, score=score, latency_ms=1)

    def test_locked_run_requires_a_pre_registered_threshold(self) -> None:
        result = subprocess.run(
            [
                sys.executable,
                str(SCRIPT),
                "--input",
                "-",
                "--model",
                "owner/model",
                "--revision",
                "a" * 40,
                "--model-license",
                "MIT",
                "--split-role",
                "locked",
            ],
            input="",
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("requires a pre-registered --threshold", result.stderr)

    def test_input_decoder_never_copies_unreviewed_metadata(self) -> None:
        raw = json.dumps(
            {
                "id": "one",
                "label": "human",
                "text": "private text",
                "language": "en",
                "provenance": "test",
                "license": "MIT",
                "domain": "essay",
                "sourceGroupId": " Shared   Prompt ",
                "rawCopy": "must not escape",
            }
        )
        fixtures = MODULE.decode_fixtures(raw)
        self.assertEqual(
            fixtures[0].metadata,
            {"domain": "essay", "sourceGroupId": "shared prompt"},
        )

    def test_input_decoder_rejects_invalid_optional_metadata(self) -> None:
        raw = json.dumps(
            {
                "id": "one",
                "label": "human",
                "text": "private text",
                "language": "en",
                "provenance": "test",
                "license": "MIT",
                "authorId": " ",
            }
        )
        with self.assertRaisesRegex(ValueError, "invalid optional metadata authorId"):
            MODULE.decode_fixtures(raw)

    def test_provenance_source_strips_record_specific_suffixes(self) -> None:
        self.assertEqual(
            MODULE.provenance_source("dataset source=human group=abc"),
            "dataset source=human",
        )
        self.assertEqual(
            MODULE.provenance_source("dataset source=human row=42"),
            "dataset source=human",
        )

    def test_fixture_split_role_must_match_the_declared_run_role(self) -> None:
        fixture = MODULE.Fixture(
            id="one",
            label="human",
            text="private text",
            language="en",
            provenance="test",
            license="MIT",
            metadata={"splitRole": "locked"},
        )
        with self.assertRaisesRegex(ValueError, "does not match"):
            MODULE.validate_split_role([fixture], "development")

    def test_validation_and_locked_require_an_explicit_fixture_role(self) -> None:
        fixture = MODULE.Fixture(
            id="one",
            label="human",
            text="private text",
            language="en",
            provenance="test",
            license="MIT",
            metadata={},
        )
        MODULE.validate_split_role([fixture], "development")
        with self.assertRaisesRegex(ValueError, "explicitly declare splitRole"):
            MODULE.validate_split_role([fixture], "validation")
        with self.assertRaisesRegex(ValueError, "explicitly declare splitRole"):
            MODULE.validate_split_role([fixture], "locked")

    def test_reports_the_resolved_ai_label_mapping(self) -> None:
        config = types.SimpleNamespace(id2label={0: "human", 1: "AI-generated"})
        self.assertEqual(MODULE.infer_ai_label_index(config, None, 2), 1)
        self.assertEqual(
            MODULE.model_output_metadata(config, 1, 2, None),
            {
                "logitsWidth": 2,
                "probability": "multi-logit-softmax",
                "aiLabelIndex": 1,
                "aiLabel": "AI-generated",
                "aiLabelIndexSource": "config-id2label",
            },
        )

    def test_single_logit_ai_polarity_scores_sigmoid_as_ai(self) -> None:
        config = types.SimpleNamespace(id2label={0: "LABEL_0"})
        self.assertEqual(MODULE.infer_ai_label_index(config, None, 1, "ai"), 0)
        logits = MODULE.torch.tensor([[2.0], [-2.0]])
        scores = MODULE.ai_probabilities_from_logits(logits, 0, "ai")
        self.assertGreater(scores[0].item(), 0.5)
        self.assertLess(scores[1].item(), 0.5)
        self.assertEqual(
            MODULE.model_output_metadata(config, 0, 1, None, "ai"),
            {
                "logitsWidth": 1,
                "probability": "single-logit-sigmoid",
                "aiLabelIndex": 0,
                "aiLabel": "LABEL_0",
                "aiLabelIndexSource": "single-logit-explicit-polarity",
                "singleLogitPolarity": "ai",
                "singleLogitPolaritySource": "explicit",
            },
        )

    def test_single_logit_human_polarity_inverts_the_ai_score(self) -> None:
        logits = MODULE.torch.tensor([[2.0], [-2.0]])
        ai_scores = MODULE.ai_probabilities_from_logits(logits, 0, "ai")
        human_polarity_scores = MODULE.ai_probabilities_from_logits(
            logits, 0, "human"
        )
        self.assertAlmostEqual(
            human_polarity_scores[0].item(),
            1 - ai_scores[0].item(),
            places=6,
        )
        self.assertAlmostEqual(
            human_polarity_scores[1].item(),
            1 - ai_scores[1].item(),
            places=6,
        )
        metadata = MODULE.model_output_metadata(
            types.SimpleNamespace(id2label={0: "human"}),
            0,
            1,
            None,
            "human",
        )
        self.assertEqual(metadata["probability"], "single-logit-inverted-sigmoid")
        self.assertEqual(metadata["singleLogitPolarity"], "human")

    def test_single_logit_missing_polarity_fails_closed(self) -> None:
        config = types.SimpleNamespace(id2label={0: "LABEL_0"})
        with self.assertRaisesRegex(
            ValueError, "requires a reviewed --single-logit-polarity"
        ):
            MODULE.infer_ai_label_index(config, None, 1)
        with self.assertRaisesRegex(
            ValueError, "requires a reviewed --single-logit-polarity"
        ):
            MODULE.ai_probabilities_from_logits(
                MODULE.torch.tensor([[2.0]]),
                0,
                None,
            )

    def test_operating_point_uses_only_thresholds_within_target_fpr(self) -> None:
        rows = [
            self.scored("human", 0.2),
            self.scored("human", 0.1),
            self.scored("ai", 0.8),
            self.scored("ai", 0.7),
        ]
        point = MODULE.operating_point(rows, 0, True)
        self.assertEqual(point["threshold"], 0.7)
        self.assertEqual(point["falsePositiveRate"], 0)
        self.assertEqual(point["truePositiveRate"], 1)
        self.assertFalse(point["targetSupportedAt95Confidence"])
        self.assertEqual(
            point["evidenceStatus"],
            "insufficient-human-samples-or-excess-false-positives",
        )

    def test_operating_point_requires_confidence_interval_to_clear_target(self) -> None:
        rows = [
            *[self.scored("human", 0.1) for _ in range(4000)],
            self.scored("ai", 0.9),
        ]
        point = MODULE.operating_point(rows, 0.001, True)
        self.assertTrue(point["targetSupportedAt95Confidence"])
        self.assertEqual(point["evidenceStatus"], "supported-at-95-confidence")

    def test_operating_point_rejects_row_level_support_without_independence(self) -> None:
        rows = [
            *[self.scored("human", 0.1) for _ in range(4000)],
            self.scored("ai", 0.9),
        ]
        point = MODULE.operating_point(rows, 0.001, False)
        self.assertFalse(point["targetSupportedAt95Confidence"])
        self.assertEqual(point["evidenceStatus"], "independence-not-established")

    def test_dependence_audit_requires_human_authors_and_unique_ai_groups(self) -> None:
        rows = [
            self.scored(
                "human",
                0.1,
                {"authorId": "author-1", "sourceGroupId": "human-prompt-1"},
            ),
            self.scored(
                "human",
                0.2,
                {"authorId": "author-2", "sourceGroupId": "human-prompt-2"},
            ),
            self.scored("ai", 0.8, {"sourceGroupId": "shared-ai-prompt"}),
            self.scored("ai", 0.9, {"sourceGroupId": "shared-ai-prompt"}),
        ]
        audit = MODULE.dependence_audit(rows)
        self.assertTrue(audit["formalInference"]["falsePositiveRateSupported"])
        self.assertFalse(audit["formalInference"]["truePositiveRateSupported"])
        self.assertEqual(audit["ai"]["sourceGroups"]["repeatedUnits"], 1)

    def test_unique_human_authors_do_not_hide_one_repeated_human_prompt(self) -> None:
        rows = [
            self.scored(
                "human",
                0.1,
                {
                    "authorId": f"author-{index}",
                    "sourceGroupId": "shared-human-prompt",
                },
            )
            for index in range(4000)
        ]
        rows.append(self.scored("ai", 0.9, {"sourceGroupId": "ai-prompt-1"}))
        audit = MODULE.dependence_audit(rows)
        self.assertFalse(audit["formalInference"]["falsePositiveRateSupported"])
        self.assertFalse(audit["formalInference"]["rowLevelWilsonReleaseSupported"])
        point = MODULE.operating_point(
            rows,
            0.001,
            audit["formalInference"]["rowLevelWilsonReleaseSupported"],
        )
        self.assertFalse(point["targetSupportedAt95Confidence"])
        self.assertEqual(point["evidenceStatus"], "independence-not-established")

    def test_repeated_ai_prompt_blocks_operating_point_release_support(self) -> None:
        rows = [
            self.scored(
                "human",
                0.1,
                {
                    "authorId": f"author-{index}",
                    "sourceGroupId": f"human-prompt-{index}",
                },
            )
            for index in range(4000)
        ]
        rows.extend(
            [
                self.scored("ai", 0.9, {"sourceGroupId": "shared-ai-prompt"}),
                self.scored("ai", 0.8, {"sourceGroupId": "shared-ai-prompt"}),
            ]
        )
        audit = MODULE.dependence_audit(rows)
        self.assertTrue(audit["formalInference"]["falsePositiveRateSupported"])
        self.assertFalse(audit["formalInference"]["truePositiveRateSupported"])
        self.assertFalse(audit["formalInference"]["rowLevelWilsonReleaseSupported"])
        point = MODULE.operating_point(
            rows,
            0.001,
            audit["formalInference"]["rowLevelWilsonReleaseSupported"],
        )
        self.assertFalse(point["targetSupportedAt95Confidence"])
        self.assertEqual(point["evidenceStatus"], "independence-not-established")

    def test_fixed_threshold_reports_wilson_intervals(self) -> None:
        rows = [
            self.scored("human", 0.1),
            self.scored("human", 0.9),
            self.scored("ai", 0.8),
            self.scored("ai", 0.2),
        ]
        metrics = MODULE.threshold_metrics(rows, 0.5)
        self.assertEqual(metrics["falsePositiveRate"], 0.5)
        self.assertEqual(metrics["truePositiveRate"], 0.5)
        self.assertLess(metrics["falsePositiveRate95Ci"]["lower"], 0.5)
        self.assertGreater(metrics["falsePositiveRate95Ci"]["upper"], 0.5)

    def test_fixed_threshold_reports_ai_refined_as_a_separate_outcome(self) -> None:
        rows = [
            self.scored("human", 0.1),
            self.scored("ai", 0.8),
            self.scored("ai-refined", 0.9),
            self.scored("ai-refined", 0.2),
        ]
        metrics = MODULE.threshold_metrics(rows, 0.5)
        self.assertEqual(metrics["samples"], 2)
        self.assertEqual(metrics["aiRefinedSamples"], 2)
        self.assertEqual(metrics["aiRefinedAboveThreshold"], 1)
        self.assertEqual(metrics["aiRefinedAboveThresholdRate"], 0.5)
        self.assertIsNotNone(metrics["aiRefinedAboveThresholdRate95Ci"])

    def test_probability_metrics_are_reported_without_ai_refined_rows(self) -> None:
        rows = [
            self.scored("human", 0.1),
            self.scored("human", 0.2),
            self.scored("ai", 0.8),
            self.scored("ai", 0.9),
            self.scored("ai-refined", 0.5),
        ]
        self.assertEqual(MODULE.average_precision(rows), 1.0)
        self.assertAlmostEqual(MODULE.brier_score(rows), 0.025)
        self.assertAlmostEqual(MODULE.expected_calibration_error(rows), 0.15)

    def test_fixed_threshold_metadata_slices_do_not_mix_generators(self) -> None:
        rows = []
        for generator, label, score in (
            ("model-a", "ai", 0.9),
            ("model-a", "ai", 0.1),
            ("model-b", "ai", 0.8),
        ):
            fixture = MODULE.Fixture(
                id=f"{generator}-{score}",
                label=label,
                text="private text",
                language="en",
                provenance="test",
                license="MIT",
                metadata={"generator": generator},
            )
            rows.append(MODULE.ScoredFixture(fixture=fixture, score=score, latency_ms=1))
        slices = MODULE.metadata_slices(rows, 0.5, "generator")
        self.assertEqual(slices["model-a"]["truePositiveRate"], 0.5)
        self.assertEqual(slices["model-b"]["truePositiveRate"], 1.0)


if __name__ == "__main__":
    unittest.main()
