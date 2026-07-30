from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("fetch-txd22-sample.py")
SPEC = importlib.util.spec_from_file_location("fetch_txd22_sample", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class Txd22SampleTest(unittest.TestCase):
    def row(self, source: str, suffix: str):
        question = f"Question {suffix}"
        return MODULE.SourceRow(
            question=question,
            answer=("Long answer " * 20) + suffix,
            source=source,
            source_group_id=MODULE.source_group_id(question),
        )

    def test_source_normalization_handles_non_breaking_space(self) -> None:
        self.assertEqual(
            MODULE.canonical_source("AI-generated\u00a0and Human-written"),
            "AI-generated and Human-written",
        )

    def test_group_split_is_stable_for_every_variant(self) -> None:
        variants = ("  Ｏne\u00a0shared prompt  ", "one shared   prompt")
        group_ids = {MODULE.source_group_id(question) for question in variants}
        self.assertEqual(len(group_ids), 1)
        group_id = group_ids.pop()
        self.assertEqual(MODULE.split_role_for_group(group_id), MODULE.split_role_for_group(group_id))
        self.assertIn(MODULE.split_role_for_group(group_id), {"development", "validation"})

    def test_balanced_selection_round_robins_sources(self) -> None:
        rows = [
            self.row("ChatGPT", "a"),
            self.row("ChatGPT", "b"),
            self.row("Claude", "a"),
            self.row("Claude", "b"),
        ]
        selected = MODULE.select_balanced(rows, {"ChatGPT", "Claude"}, 4)
        self.assertEqual({row.source for row in selected[:2]}, {"ChatGPT", "Claude"})

    def test_fixture_omits_prompt_text_and_maps_refined_separately(self) -> None:
        row = self.row("Human-written and AI-refined", "a")
        result = MODULE.fixture(row, "validation")
        self.assertEqual(result["label"], "ai-refined")
        self.assertEqual(result["splitRole"], "validation")
        self.assertNotIn("question", result)
        self.assertNotIn(row.question, str(result))
        self.assertIn(f"grouping={MODULE.GROUPING_VERSION}", str(result))
        self.assertIn("raw-question-sha256=", str(result))
        summarized_source = str(result["provenance"]).split(" group=", 1)[0]
        self.assertNotIn("raw-question-sha256=", summarized_source)

    def test_jsonl_output_is_utf8_independent_of_console_code_page(self) -> None:
        encoded = MODULE.fixture_jsonl_bytes({"text": "½ 中文"})
        self.assertEqual(encoded.decode("utf-8"), '{"text":"½ 中文"}\n')


if __name__ == "__main__":
    unittest.main()
