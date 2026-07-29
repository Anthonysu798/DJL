#!/usr/bin/env python3
"""Score a pinned Hugging Face classifier without persisting benchmark text.

This is a research-only companion to the production benchmark harness. It is
deliberately strict about split roles: a locked run requires a threshold fixed
before the run and never searches that locked input for a better threshold.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import platform
import sys
import time
import unicodedata
from dataclasses import dataclass
from statistics import NormalDist
from typing import Any, Iterable, Sequence

import torch
from transformers import AutoModelForSequenceClassification, AutoTokenizer


GROUND_TRUTH_LABELS = frozenset({"ai", "human", "ai-refined"})
AI_LABEL_MARKERS = ("ai", "machine", "generated", "fake")
SAFE_METADATA_FIELDS = frozenset(
    {
        "splitRole",
        "sourceGroupId",
        "authorId",
        "promptFamily",
        "nativeLanguageCohort",
        "scenario",
        "domain",
        "generator",
        "attackEditing",
    }
)
GROUPING_METADATA_FIELDS = frozenset({"sourceGroupId", "authorId", "promptFamily"})


@dataclass(frozen=True)
class Fixture:
    id: str
    label: str
    text: str
    language: str
    provenance: str
    license: str
    metadata: dict[str, Any]


@dataclass(frozen=True)
class ScoredFixture:
    fixture: Fixture
    score: float
    latency_ms: float


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, help="JSONL path, or '-' for stdin")
    parser.add_argument("--model", required=True)
    parser.add_argument("--revision", required=True, help="Immutable Hugging Face commit")
    parser.add_argument("--model-license", required=True)
    parser.add_argument("--split-role", required=True, choices=("development", "validation", "locked"))
    parser.add_argument("--language", choices=("en", "zh-Hans"))
    parser.add_argument("--threshold", type=float)
    output_contract = parser.add_mutually_exclusive_group()
    output_contract.add_argument(
        "--ai-label-index",
        type=int,
        help="Reviewed AI class index for a multi-logit model",
    )
    output_contract.add_argument(
        "--single-logit-polarity",
        choices=("ai", "human"),
        help=(
            "Reviewed label represented by sigmoid(logit); required when the model "
            "emits one logit"
        ),
    )
    parser.add_argument("--max-length", type=int, default=512)
    parser.add_argument("--batch-size", type=int, default=4)
    parser.add_argument("--summary-only", action="store_true")
    args = parser.parse_args()
    if len(args.revision) != 40 or any(character not in "0123456789abcdef" for character in args.revision):
        parser.error("--revision must be a lowercase 40-character commit SHA")
    if args.max_length < 32 or args.max_length > 4096:
        parser.error("--max-length must be from 32 through 4096")
    if args.batch_size < 1 or args.batch_size > 128:
        parser.error("--batch-size must be from 1 through 128")
    if args.threshold is not None and not 0 <= args.threshold <= 1:
        parser.error("--threshold must be between 0 and 1")
    if args.split_role == "locked" and args.threshold is None:
        parser.error("locked evaluation requires a pre-registered --threshold")
    return args


def read_input(path: str) -> str:
    if path == "-":
        return sys.stdin.buffer.read().decode("utf-8-sig")
    with open(path, encoding="utf-8-sig") as handle:
        return handle.read()


def decode_fixtures(raw: str) -> list[Fixture]:
    fixtures: list[Fixture] = []
    seen_ids: set[str] = set()
    for line_number, line in enumerate(raw.splitlines(), start=1):
        if not line.strip():
            continue
        try:
            value = json.loads(line)
        except json.JSONDecodeError as error:
            raise ValueError(f"line {line_number} is not valid JSON") from error
        required = ("id", "label", "text", "language", "provenance", "license")
        if not isinstance(value, dict) or any(not isinstance(value.get(key), str) for key in required):
            raise ValueError(f"line {line_number} is missing a required string field")
        if not value["id"] or value["id"] in seen_ids:
            raise ValueError(f"line {line_number} has an empty or duplicate id")
        if value["label"] not in GROUND_TRUTH_LABELS:
            raise ValueError(f"line {line_number} has an unsupported label")
        if not value["text"].strip() or not value["provenance"] or not value["license"]:
            raise ValueError(f"line {line_number} has empty benchmark evidence")
        seen_ids.add(value["id"])
        metadata: dict[str, str] = {}
        for key in SAFE_METADATA_FIELDS:
            if key not in value:
                continue
            metadata_value = value[key]
            if not isinstance(metadata_value, str) or not metadata_value.strip():
                raise ValueError(
                    f"line {line_number} has invalid optional metadata {key}"
                )
            canonical = unicodedata.normalize("NFKC", metadata_value).strip()
            if key in GROUPING_METADATA_FIELDS:
                canonical = " ".join(canonical.split()).casefold()
            metadata[key] = canonical
        fixtures.append(
            Fixture(
                id=value["id"],
                label=value["label"],
                text=value["text"],
                language=value["language"],
                provenance=value["provenance"],
                license=value["license"],
                metadata=metadata,
            )
        )
    if not fixtures:
        raise ValueError("benchmark input is empty")
    return fixtures


def fixture_digest(fixtures: Sequence[Fixture]) -> str:
    digest = hashlib.sha256()
    for fixture in fixtures:
        digest.update(
            json.dumps(
                {
                    "id": fixture.id,
                    "label": fixture.label,
                    "text": fixture.text,
                    "language": fixture.language,
                    "provenance": fixture.provenance,
                    "license": fixture.license,
                    **fixture.metadata,
                },
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8")
        )
        digest.update(b"\n")
    return digest.hexdigest()


def validate_split_role(fixtures: Sequence[Fixture], split_role: str) -> None:
    if split_role in {"validation", "locked"}:
        missing = [
            fixture.id
            for fixture in fixtures
            if fixture.metadata.get("splitRole") is None
        ]
        if missing:
            raise ValueError(
                f"{split_role} benchmark fixture must explicitly declare splitRole: {missing[0]}"
            )
    mismatched = [
        fixture.id
        for fixture in fixtures
        if fixture.metadata.get("splitRole") not in (None, split_role)
    ]
    if mismatched:
        raise ValueError(
            f"benchmark fixture splitRole does not match --split-role: {mismatched[0]}"
        )


def provenance_source(provenance: str) -> str:
    return provenance.split(" row=", 1)[0].split(" group=", 1)[0]


def infer_ai_label_index(
    config: Any,
    explicit_index: int | None,
    logits_width: int,
    single_logit_polarity: str | None = None,
) -> int:
    if logits_width == 1:
        if explicit_index is not None:
            raise ValueError(
                "--ai-label-index applies only to multi-logit models; use "
                "--single-logit-polarity for a single-logit model"
            )
        if single_logit_polarity not in {"ai", "human"}:
            raise ValueError(
                "single-logit model requires a reviewed "
                "--single-logit-polarity {ai,human}"
            )
        return 0
    if single_logit_polarity is not None:
        raise ValueError(
            "--single-logit-polarity applies only to single-logit models; use "
            "--ai-label-index for a multi-logit model"
        )
    if explicit_index is not None:
        if explicit_index < 0 or explicit_index >= logits_width:
            raise ValueError("--ai-label-index is outside the model output")
        return explicit_index
    id_to_label = getattr(config, "id2label", {}) or {}
    candidates: list[int] = []
    for index, label in id_to_label.items():
        try:
            candidate = int(index)
        except (TypeError, ValueError):
            continue
        normalized_label = str(label).lower()
        if (
            0 <= candidate < logits_width
            and any(marker in normalized_label for marker in AI_LABEL_MARKERS)
            and "human" not in normalized_label
        ):
            candidates.append(candidate)
    if len(candidates) != 1:
        raise ValueError(
            "model label mapping is ambiguous; pass a reviewed --ai-label-index explicitly"
        )
    return candidates[0]


def ai_probabilities_from_logits(
    logits: torch.Tensor,
    ai_label_index: int,
    single_logit_polarity: str | None,
) -> torch.Tensor:
    if logits.shape[1] == 1:
        if single_logit_polarity not in {"ai", "human"}:
            raise ValueError(
                "single-logit model requires a reviewed "
                "--single-logit-polarity {ai,human}"
            )
        ai_logits = (
            logits[:, 0] if single_logit_polarity == "ai" else -logits[:, 0]
        )
        return torch.sigmoid(ai_logits)
    if single_logit_polarity is not None:
        raise ValueError(
            "--single-logit-polarity applies only to single-logit models"
        )
    return torch.softmax(logits, dim=-1)[:, ai_label_index]


def model_output_metadata(
    config: Any,
    ai_label_index: int,
    logits_width: int,
    explicit_index: int | None,
    single_logit_polarity: str | None = None,
) -> dict[str, Any]:
    if logits_width == 1 and single_logit_polarity not in {"ai", "human"}:
        raise ValueError(
            "single-logit model requires a reviewed "
            "--single-logit-polarity {ai,human}"
        )
    id_to_label = getattr(config, "id2label", {}) or {}
    label = id_to_label.get(ai_label_index, id_to_label.get(str(ai_label_index)))
    metadata = {
        "logitsWidth": logits_width,
        "probability": (
            "single-logit-sigmoid"
            if logits_width == 1 and single_logit_polarity == "ai"
            else "single-logit-inverted-sigmoid"
            if logits_width == 1
            else "multi-logit-softmax"
        ),
        "aiLabelIndex": ai_label_index,
        "aiLabel": str(label) if label is not None else None,
        "aiLabelIndexSource": (
            "explicit"
            if explicit_index is not None
            else "single-logit-explicit-polarity"
            if logits_width == 1
            else "config-id2label"
        ),
    }
    if logits_width == 1:
        metadata["singleLogitPolarity"] = single_logit_polarity
        metadata["singleLogitPolaritySource"] = "explicit"
    return metadata


def wilson_interval(successes: int, samples: int, confidence: float = 0.95) -> dict[str, float] | None:
    if samples <= 0:
        return None
    z = NormalDist().inv_cdf(0.5 + confidence / 2)
    estimate = successes / samples
    denominator = 1 + z * z / samples
    center = (estimate + z * z / (2 * samples)) / denominator
    margin = (
        z
        * math.sqrt(estimate * (1 - estimate) / samples + z * z / (4 * samples * samples))
        / denominator
    )
    return {
        "lower": 0.0 if successes == 0 else max(0.0, center - margin),
        "upper": 1.0 if successes == samples else min(1.0, center + margin),
    }


def auroc(rows: Sequence[ScoredFixture]) -> float | None:
    binary = [row for row in rows if row.fixture.label in {"ai", "human"}]
    ai_count = sum(row.fixture.label == "ai" for row in binary)
    human_count = len(binary) - ai_count
    if ai_count == 0 or human_count == 0:
        return None
    sorted_rows = sorted(binary, key=lambda row: row.score)
    ai_rank_sum = 0.0
    start = 0
    while start < len(sorted_rows):
        end = start + 1
        while end < len(sorted_rows) and sorted_rows[end].score == sorted_rows[start].score:
            end += 1
        average_rank = (start + 1 + end) / 2
        ai_rank_sum += average_rank * sum(
            row.fixture.label == "ai" for row in sorted_rows[start:end]
        )
        start = end
    return (ai_rank_sum - ai_count * (ai_count + 1) / 2) / (ai_count * human_count)


def average_precision(rows: Sequence[ScoredFixture]) -> float | None:
    binary = [row for row in rows if row.fixture.label in {"ai", "human"}]
    ai_count = sum(row.fixture.label == "ai" for row in binary)
    human_count = len(binary) - ai_count
    if ai_count == 0 or human_count == 0:
        return None
    ordered = sorted(binary, key=lambda row: row.score, reverse=True)
    true_positives = 0
    false_positives = 0
    previous_recall = 0.0
    area = 0.0
    start = 0
    while start < len(ordered):
        end = start + 1
        while end < len(ordered) and ordered[end].score == ordered[start].score:
            end += 1
        true_positives += sum(row.fixture.label == "ai" for row in ordered[start:end])
        false_positives += sum(row.fixture.label == "human" for row in ordered[start:end])
        recall = true_positives / ai_count
        precision = true_positives / (true_positives + false_positives)
        area += (recall - previous_recall) * precision
        previous_recall = recall
        start = end
    return area


def brier_score(rows: Sequence[ScoredFixture]) -> float | None:
    binary = [row for row in rows if row.fixture.label in {"ai", "human"}]
    if not binary:
        return None
    return sum(
        (row.score - (1.0 if row.fixture.label == "ai" else 0.0)) ** 2
        for row in binary
    ) / len(binary)


def expected_calibration_error(
    rows: Sequence[ScoredFixture], bins: int = 10
) -> float | None:
    binary = [row for row in rows if row.fixture.label in {"ai", "human"}]
    if not binary:
        return None
    total_error = 0.0
    for bin_index in range(bins):
        lower = bin_index / bins
        upper = (bin_index + 1) / bins
        members = [
            row
            for row in binary
            if row.score >= lower
            and (row.score < upper or (bin_index == bins - 1 and row.score <= upper))
        ]
        if not members:
            continue
        mean_score = sum(row.score for row in members) / len(members)
        observed_rate = sum(row.fixture.label == "ai" for row in members) / len(members)
        total_error += len(members) / len(binary) * abs(mean_score - observed_rate)
    return total_error


def cluster_audit(
    rows: Sequence[ScoredFixture], metadata_key: str
) -> dict[str, Any]:
    counts: dict[str, int] = {}
    missing_samples = 0
    for row in rows:
        value = row.fixture.metadata.get(metadata_key)
        if not isinstance(value, str) or not value.strip():
            missing_samples += 1
            continue
        canonical = value.strip()
        counts[canonical] = counts.get(canonical, 0) + 1
    sizes = list(counts.values())
    return {
        "samples": len(rows),
        "knownSamples": len(rows) - missing_samples,
        "missingSamples": missing_samples,
        "uniqueUnits": len(counts),
        "repeatedUnits": sum(size > 1 for size in sizes),
        "maximumRowsPerUnit": max(sizes) if sizes else None,
        "complete": bool(rows) and missing_samples == 0,
        "rowIndependent": (
            bool(rows) and missing_samples == 0 and all(size == 1 for size in sizes)
        ),
    }


def dependence_audit(rows: Sequence[ScoredFixture]) -> dict[str, Any]:
    binary = [row for row in rows if row.fixture.label in {"ai", "human"}]
    human = [row for row in binary if row.fixture.label == "human"]
    ai = [row for row in binary if row.fixture.label == "ai"]
    human_authors = cluster_audit(human, "authorId")
    human_source_groups = cluster_audit(human, "sourceGroupId")
    ai_source_groups = cluster_audit(ai, "sourceGroupId")
    fpr_supported = bool(
        human_authors["rowIndependent"] and human_source_groups["rowIndependent"]
    )
    tpr_supported = bool(ai_source_groups["rowIndependent"])
    return {
        "human": {
            "authors": human_authors,
            "sourceGroups": human_source_groups,
        },
        "ai": {"sourceGroups": ai_source_groups},
        "formalInference": {
            "falsePositiveRateSupported": fpr_supported,
            "truePositiveRateSupported": tpr_supported,
            "rowLevelWilsonReleaseSupported": fpr_supported and tpr_supported,
            "reason": (
                None
                if fpr_supported and tpr_supported
                else (
                    "Row-level Wilson intervals are descriptive only: independent human "
                    "authors, one human row per source group, and one AI row per source "
                    "group were not all established."
                )
            ),
        },
    }


def operating_point(
    rows: Sequence[ScoredFixture],
    target_fpr: float,
    release_independence_established: bool,
) -> dict[str, Any]:
    binary = [row for row in rows if row.fixture.label in {"ai", "human"}]
    ai_count = sum(row.fixture.label == "ai" for row in binary)
    human_count = len(binary) - ai_count
    empty = {
        "targetFalsePositiveRate": target_fpr,
        "threshold": None,
        "falsePositiveRate": None,
        "truePositiveRate": None,
        "falsePositives": 0,
        "truePositives": 0,
        "falsePositiveRate95Ci": None,
        "truePositiveRate95Ci": None,
        "targetSupportedAt95Confidence": False,
        "evidenceStatus": "insufficient-samples",
    }
    if ai_count == 0 or human_count == 0:
        return empty
    best = dict(empty)
    for threshold in sorted({row.score for row in binary}, reverse=True):
        false_positives = sum(
            row.fixture.label == "human" and row.score >= threshold for row in binary
        )
        if false_positives / human_count > target_fpr:
            continue
        true_positives = sum(
            row.fixture.label == "ai" and row.score >= threshold for row in binary
        )
        candidate = {
            "targetFalsePositiveRate": target_fpr,
            "threshold": threshold,
            "falsePositiveRate": false_positives / human_count,
            "truePositiveRate": true_positives / ai_count,
            "falsePositives": false_positives,
            "truePositives": true_positives,
            "falsePositiveRate95Ci": wilson_interval(false_positives, human_count),
            "truePositiveRate95Ci": wilson_interval(true_positives, ai_count),
            "targetSupportedAt95Confidence": False,
            "evidenceStatus": "insufficient-human-samples-or-excess-false-positives",
        }
        false_positive_interval = candidate["falsePositiveRate95Ci"]
        candidate["targetSupportedAt95Confidence"] = (
            false_positive_interval is not None
            and false_positive_interval["upper"] <= target_fpr
            and release_independence_established
        )
        candidate["evidenceStatus"] = (
            "supported-at-95-confidence"
            if candidate["targetSupportedAt95Confidence"]
            else "independence-not-established"
            if not release_independence_established
            else "insufficient-human-samples-or-excess-false-positives"
        )
        if (
            best["threshold"] is None
            or candidate["truePositiveRate"] > best["truePositiveRate"]
            or (
                candidate["truePositiveRate"] == best["truePositiveRate"]
                and threshold < best["threshold"]
            )
        ):
            best = candidate
    return best


def threshold_metrics(rows: Sequence[ScoredFixture], threshold: float) -> dict[str, Any]:
    binary = [row for row in rows if row.fixture.label in {"ai", "human"}]
    ai_refined = [row for row in rows if row.fixture.label == "ai-refined"]
    ai_count = sum(row.fixture.label == "ai" for row in binary)
    human_count = len(binary) - ai_count
    true_positives = sum(
        row.fixture.label == "ai" and row.score >= threshold for row in binary
    )
    false_positives = sum(
        row.fixture.label == "human" and row.score >= threshold for row in binary
    )
    ai_refined_above_threshold = sum(row.score >= threshold for row in ai_refined)
    true_positive_rate = true_positives / ai_count if ai_count else None
    false_positive_rate = false_positives / human_count if human_count else None
    ai_refined_above_threshold_rate = (
        ai_refined_above_threshold / len(ai_refined) if ai_refined else None
    )
    dependence = dependence_audit(binary)
    return {
        "threshold": threshold,
        "samples": len(binary),
        "aiSamples": ai_count,
        "humanSamples": human_count,
        "truePositives": true_positives,
        "falsePositives": false_positives,
        "truePositiveRate": true_positive_rate,
        "truePositiveRate95Ci": wilson_interval(true_positives, ai_count),
        "falsePositiveRate": false_positive_rate,
        "falsePositiveRate95Ci": wilson_interval(false_positives, human_count),
        "confidenceIntervalMethod": (
            "Wilson score (row-level; see dependenceAudit before inferential use)"
        ),
        "dependenceAudit": dependence,
        "aiRefinedSamples": len(ai_refined),
        "aiRefinedAboveThreshold": ai_refined_above_threshold,
        "aiRefinedAboveThresholdRate": ai_refined_above_threshold_rate,
        "aiRefinedAboveThresholdRate95Ci": wilson_interval(
            ai_refined_above_threshold, len(ai_refined)
        ),
    }


def metadata_slices(
    rows: Sequence[ScoredFixture], threshold: float, metadata_key: str
) -> dict[str, Any]:
    values = sorted(
        {
            str(row.fixture.metadata[metadata_key])
            for row in rows
            if metadata_key in row.fixture.metadata
        }
    )
    return {
        value: threshold_metrics(
            [
                row
                for row in rows
                if str(row.fixture.metadata.get(metadata_key)) == value
            ],
            threshold,
        )
        for value in values
    }


def batched(values: Sequence[Fixture], size: int) -> Iterable[Sequence[Fixture]]:
    for start in range(0, len(values), size):
        yield values[start : start + size]


def score_fixtures(
    fixtures: Sequence[Fixture],
    model_name: str,
    revision: str,
    max_length: int,
    batch_size: int,
    explicit_ai_label_index: int | None,
    single_logit_polarity: str | None = None,
) -> tuple[list[ScoredFixture], Any, int, int]:
    torch.set_grad_enabled(False)
    torch.manual_seed(0)
    tokenizer = AutoTokenizer.from_pretrained(
        model_name,
        revision=revision,
        trust_remote_code=False,
    )
    model = AutoModelForSequenceClassification.from_pretrained(
        model_name,
        revision=revision,
        trust_remote_code=False,
    )
    model.eval()
    scored: list[ScoredFixture] = []
    ai_label_index: int | None = None
    logits_width: int | None = None
    for batch in batched(fixtures, batch_size):
        started = time.perf_counter()
        encoded = tokenizer(
            [fixture.text for fixture in batch],
            return_tensors="pt",
            padding=True,
            truncation=True,
            max_length=max_length,
        )
        logits = model(**encoded).logits.detach().cpu()
        if logits.ndim != 2 or logits.shape[0] != len(batch):
            raise ValueError(f"model returned unsupported logits shape {tuple(logits.shape)}")
        current_logits_width = int(logits.shape[1])
        if current_logits_width <= 0:
            raise ValueError("model returned an empty logits dimension")
        if logits_width is not None and current_logits_width != logits_width:
            raise ValueError("model changed its logits width between batches")
        if ai_label_index is None:
            logits_width = current_logits_width
            ai_label_index = infer_ai_label_index(
                model.config,
                explicit_ai_label_index,
                current_logits_width,
                single_logit_polarity,
            )
        probabilities = ai_probabilities_from_logits(
            logits,
            ai_label_index,
            single_logit_polarity,
        )
        elapsed_ms = (time.perf_counter() - started) * 1000
        for fixture, score in zip(batch, probabilities.tolist(), strict=True):
            if not math.isfinite(score) or not 0 <= score <= 1:
                raise ValueError("model returned a non-finite or out-of-range score")
            scored.append(
                ScoredFixture(
                    fixture=fixture,
                    score=float(score),
                    latency_ms=elapsed_ms / len(batch),
                )
            )
    if ai_label_index is None or logits_width is None:
        raise ValueError("benchmark input produced no model scores")
    return scored, model.config, ai_label_index, logits_width


def main() -> None:
    args = parse_args()
    raw = read_input(args.input)
    fixtures = decode_fixtures(raw)
    validate_split_role(fixtures, args.split_role)
    if args.language is not None:
        fixtures = [fixture for fixture in fixtures if fixture.language == args.language]
        if not fixtures:
            raise ValueError(f"benchmark input has no {args.language} fixtures")
    started = time.perf_counter()
    rows, config, ai_label_index, logits_width = score_fixtures(
        fixtures,
        args.model,
        args.revision,
        args.max_length,
        args.batch_size,
        args.ai_label_index,
        args.single_logit_polarity,
    )
    elapsed_ms = (time.perf_counter() - started) * 1000
    dependence = dependence_audit(rows)
    score_metrics: dict[str, Any] = {
        "auroc": auroc(rows),
        "averagePrecision": average_precision(rows),
        "brierScore": brier_score(rows),
        "expectedCalibrationError10Bins": expected_calibration_error(rows),
        "operatingPointSearch": (
            {
                "status": "disabled-locked",
                "reason": "Locked inputs must never be used to choose a threshold.",
                "points": [],
            }
            if args.split_role == "locked"
            else {
                "status": "descriptive-only",
                "reason": "Thresholds found on this same input are not generalization evidence.",
                "points": [
                    operating_point(
                        rows,
                        target,
                        bool(
                            dependence["formalInference"][
                                "rowLevelWilsonReleaseSupported"
                            ]
                        ),
                    )
                    for target in (0.001, 0.01, 0.05)
                ],
            }
        ),
        "dependenceAudit": dependence,
        "fixedThreshold": (
            threshold_metrics(rows, args.threshold) if args.threshold is not None else None
        ),
        "fixedThresholdSlices": (
            {
                metadata_key: metadata_slices(rows, args.threshold, metadata_key)
                for metadata_key in (
                    "domain",
                    "generator",
                    "attackEditing",
                    "nativeLanguageCohort",
                    "scenario",
                )
                if any(metadata_key in row.fixture.metadata for row in rows)
            }
            if args.threshold is not None
            else None
        ),
    }
    result = {
        "schemaVersion": 2,
        "warning": (
            "Research candidate-ranking evidence only. This does not test DJL production "
            "preprocessing, segmentation, aggregation, or a deployed quantized artifact."
        ),
        "splitRole": args.split_role,
        "dataset": {
            "sha256": fixture_digest(fixtures),
            "samples": len(fixtures),
            "sources": sorted({provenance_source(fixture.provenance) for fixture in fixtures}),
            "licenses": sorted({fixture.license for fixture in fixtures}),
        },
        "model": {
            "id": args.model,
            "revision": args.revision,
            "declaredLicense": args.model_license,
            "architecture": getattr(config, "architectures", None),
            "maxLength": args.max_length,
            **model_output_metadata(
                config,
                ai_label_index,
                logits_width,
                args.ai_label_index,
                args.single_logit_polarity,
            ),
        },
        "runtime": {
            "python": platform.python_version(),
            "torch": torch.__version__,
            "platform": platform.platform(),
            "device": "cpu",
            "totalMs": elapsed_ms,
            "meanPerSampleMs": elapsed_ms / len(rows),
        },
        "metrics": score_metrics,
        "metricNotes": {
            "binary": (
                "AUROC, average precision, Brier score, calibration error, and fixed-threshold "
                "rates exclude AI-refined records."
            ),
            "aiRefined": (
                "AI-refined records are reported only as an above-threshold distribution; "
                "they are not forced into binary authorship accuracy."
            ),
            "calibration": (
                "Brier score and calibration error assess the model's raw probabilities. "
                "A high AUROC does not make saturated or uncalibrated scores trustworthy."
            ),
            "dependence": (
                "Wilson intervals are row-level descriptions. Formal low-FPR support "
                "requires explicit independent human author IDs plus one human and one AI "
                "record per source group; otherwise use author/prompt-disjoint or "
                "cluster-robust inference."
            ),
            "deployment": (
                "This research scorer truncates one raw record to maxLength and runs the "
                "PyTorch checkpoint. It is not a substitute for evaluating DJL's exported "
                "quantized artifact through the production text pipeline."
            ),
        },
        "rowsOmitted": args.summary_only,
        "rows": (
            []
            if args.summary_only
            else [
                {
                    "id": row.fixture.id,
                    "language": row.fixture.language,
                    "label": row.fixture.label,
                    "score": row.score,
                    "latencyMs": row.latency_ms,
                    **row.fixture.metadata,
                }
                for row in rows
            ]
        ),
    }
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
