#!/usr/bin/env python3
"""Train and evaluate a research-only AI detector without pretrained weights.

The model is intentionally simple: normalized word/character hashing feeds a
linear logistic classifier trained from scratch. TXD development question
groups are deterministically separated into training, calibration, and
operating-point partitions. Evaluation never changes the saved model or its
threshold.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
import platform
import sys
import tempfile
import time
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from statistics import NormalDist
from typing import Any, Sequence

import joblib
import numpy as np


ARTIFACT_SCHEMA_VERSION = 1
MODEL_FAMILY = "scratch-word-char-hashing-linear-logistic"
SPLIT_SALT = "djl-scratch-hashing-v1"
TARGET_FPR = 0.01
MINIMUM_GATE_HUMANS = 381
FIXTURE_SPLIT_ROLES = ("development", "validation", "locked")
EVALUATION_SPLIT_ROLES = ("validation", "locked")


@dataclass(frozen=True)
class Fixture:
    fixture_id: str
    label: str
    text: str
    language: str
    split_role: str
    source_group_id: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)

    prepare = subparsers.add_parser(
        "prepare-txd",
        help="Create a question-grouped TXD JSONL fixture under the system temp directory.",
    )
    prepare.add_argument("--split-role", required=True, choices=("development", "validation"))
    prepare.add_argument("--per-label", required=True, type=int)
    prepare.add_argument("--output", required=True)

    train = subparsers.add_parser("train")
    train.add_argument("--development-input", required=True)
    train.add_argument("--artifact", required=True)
    train.add_argument("--report", required=True)
    train.add_argument("--seed", type=int, default=1729)

    evaluate = subparsers.add_parser("evaluate")
    evaluate.add_argument("--artifact", required=True)
    evaluate.add_argument("--input", required=True)
    evaluate.add_argument("--name", required=True)
    evaluate.add_argument("--report", required=True)
    evaluate.add_argument("--language", default="en")
    evaluate.add_argument(
        "--split-role", required=True, choices=EVALUATION_SPLIT_ROLES
    )
    return parser.parse_args()


def ensure_temp_path(path_value: str) -> Path:
    path = Path(path_value).resolve()
    temp_root = Path(tempfile.gettempdir()).resolve()
    try:
        path.relative_to(temp_root)
    except ValueError as error:
        raise ValueError(f"generated data and artifacts must stay under {temp_root}") from error
    return path


def load_txd_sampler() -> Any:
    script = Path(__file__).with_name("fetch-txd22-sample.py")
    spec = importlib.util.spec_from_file_location("fetch_txd22_sample", script)
    if not spec or not spec.loader:
        raise RuntimeError(f"cannot load {script}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def prepare_txd(split_role: str, per_label: int, output_value: str) -> dict[str, Any]:
    if not 1 <= per_label <= 5000:
        raise ValueError("--per-label must be from 1 through 5000")
    output = ensure_temp_path(output_value)
    sampler = load_txd_sampler()
    data = sampler.fetch_dataset()
    rows, excluded_encoding_rows = sampler.decode_rows(data)
    eligible = [
        row
        for row in rows
        if sampler.split_role_for_group(row.source_group_id) == split_role
    ]
    selected = [
        *sampler.select_balanced(eligible, {sampler.HUMAN_SOURCE}, per_label),
        *sampler.select_balanced(eligible, sampler.AI_SOURCES, per_label),
    ]
    output.parent.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256()
    with output.open("wb") as handle:
        for row in selected:
            line = sampler.fixture_jsonl_bytes(sampler.fixture(row, split_role))
            handle.write(line)
            digest.update(line)
    return {
        "dataset": sampler.DATASET_DOI,
        "fileSha256": sampler.FILE_SHA256,
        "fixtureSha256": digest.hexdigest(),
        "splitRole": split_role,
        "samples": len(selected),
        "perLabel": per_label,
        "excludedEncodingRows": excluded_encoding_rows,
        "questionIncludedAsFeature": False,
        "output": str(output),
    }


def read_fixtures(path_value: str, expected_role: str | None = None) -> list[Fixture]:
    if expected_role is not None and expected_role not in FIXTURE_SPLIT_ROLES:
        raise ValueError(f"unsupported expected split role: {expected_role}")
    path = ensure_temp_path(path_value)
    fixtures: list[Fixture] = []
    ids: set[str] = set()
    with path.open(encoding="utf-8-sig") as handle:
        for line_number, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            try:
                value = json.loads(line)
            except json.JSONDecodeError as error:
                raise ValueError(f"line {line_number} is not valid JSON") from error
            if not isinstance(value, dict):
                raise ValueError(f"line {line_number} must contain an object")
            required = ("id", "label", "text", "language", "splitRole", "sourceGroupId")
            if any(not isinstance(value.get(key), str) or not value[key] for key in required):
                raise ValueError(f"line {line_number} is missing a required string field")
            if value["id"] in ids:
                raise ValueError(f"line {line_number} has a duplicate id")
            if value["label"] not in {"human", "ai", "ai-refined"}:
                raise ValueError(f"line {line_number} has an unsupported label")
            if value["splitRole"] not in FIXTURE_SPLIT_ROLES:
                raise ValueError(
                    f"line {line_number} has an unsupported splitRole"
                )
            if expected_role is not None and value["splitRole"] != expected_role:
                raise ValueError(
                    f"line {line_number} has splitRole={value['splitRole']}, "
                    f"expected {expected_role}"
                )
            source_group_id = " ".join(
                unicodedata.normalize("NFKC", value["sourceGroupId"]).split()
            ).casefold()
            if not source_group_id:
                raise ValueError(f"line {line_number} has an empty sourceGroupId")
            ids.add(value["id"])
            fixtures.append(
                Fixture(
                    fixture_id=value["id"],
                    label=value["label"],
                    text=value["text"],
                    language=value["language"],
                    split_role=value["splitRole"],
                    source_group_id=source_group_id,
                )
            )
    if not fixtures:
        raise ValueError("benchmark input is empty")
    return fixtures


def development_partition(source_group_id: str) -> str:
    digest = hashlib.sha256(
        f"{SPLIT_SALT}\0{source_group_id}".encode("utf-8")
    ).digest()
    bucket = int.from_bytes(digest[:4], "big") % 100
    if bucket < 60:
        return "train"
    if bucket < 70:
        return "calibration"
    return "operating"


def feature_union() -> Any:
    from sklearn.feature_extraction.text import HashingVectorizer
    from sklearn.pipeline import FeatureUnion

    return FeatureUnion(
        [
            (
                "character",
                HashingVectorizer(
                    analyzer="char",
                    ngram_range=(3, 5),
                    n_features=2**18,
                    alternate_sign=False,
                    norm="l2",
                    lowercase=True,
                    strip_accents="unicode",
                    dtype=np.float32,
                ),
            ),
            (
                "word",
                HashingVectorizer(
                    analyzer="word",
                    ngram_range=(1, 2),
                    n_features=2**17,
                    alternate_sign=False,
                    norm="l2",
                    lowercase=True,
                    strip_accents="unicode",
                    token_pattern=r"(?u)\b\w+\b",
                    dtype=np.float32,
                ),
            ),
        ]
    )


def labels(fixtures: Sequence[Fixture]) -> np.ndarray:
    return np.asarray([1 if fixture.label == "ai" else 0 for fixture in fixtures])


def score_texts(artifact: dict[str, Any], texts: Sequence[str]) -> np.ndarray:
    matrix = artifact["features"].transform(texts)
    raw_scores = artifact["classifier"].decision_function(matrix).reshape(-1, 1)
    return artifact["calibrator"].predict_proba(raw_scores)[:, 1]


def wilson_interval(successes: int, samples: int, confidence: float = 0.95) -> dict[str, float]:
    if samples <= 0:
        raise ValueError("Wilson interval requires at least one sample")
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
        "lower": max(0.0, center - margin),
        "upper": min(1.0, center + margin),
    }


def choose_threshold(
    y_true: np.ndarray,
    scores: np.ndarray,
    *,
    human_author_independence_established: bool = False,
    human_source_group_independence_established: bool = False,
    ai_source_group_independence_established: bool = False,
) -> dict[str, Any]:
    human_scores = scores[y_true == 0]
    ai_scores = scores[y_true == 1]
    if len(human_scores) < MINIMUM_GATE_HUMANS:
        raise ValueError(
            f"operating partition needs at least {MINIMUM_GATE_HUMANS} human samples; "
            f"received {len(human_scores)}"
        )
    candidates = sorted(
        {
            *[float(score) for score in scores],
            float(np.nextafter(float(np.max(scores)), math.inf)),
        },
        reverse=True,
    )
    best: dict[str, Any] | None = None
    for threshold in candidates:
        false_positives = int(np.sum(human_scores >= threshold))
        interval = wilson_interval(false_positives, len(human_scores))
        if interval["upper"] > TARGET_FPR:
            continue
        true_positives = int(np.sum(ai_scores >= threshold))
        release_independence_established = (
            human_author_independence_established
            and human_source_group_independence_established
            and ai_source_group_independence_established
        )
        candidate = {
            "threshold": threshold,
            "falsePositives": false_positives,
            "humanSamples": len(human_scores),
            "falsePositiveRate": false_positives / len(human_scores),
            "falsePositiveRate95Ci": interval,
            "truePositives": true_positives,
            "aiSamples": len(ai_scores),
            "truePositiveRate": true_positives / len(ai_scores),
            "truePositiveRate95Ci": wilson_interval(true_positives, len(ai_scores)),
            "targetFalsePositiveRate": TARGET_FPR,
            "targetSupportedAt95Confidence": (
                release_independence_established
                and interval["upper"] <= TARGET_FPR
            ),
            "evidenceStatus": (
                "supported-at-95-confidence"
                if release_independence_established
                and interval["upper"] <= TARGET_FPR
                else "release-independence-not-established"
            ),
        }
        if best is None or (
            candidate["truePositives"],
            -candidate["falsePositives"],
            candidate["threshold"],
        ) > (
            best["truePositives"],
            -best["falsePositives"],
            best["threshold"],
        ):
            best = candidate
    if best is None:
        raise ValueError("no development threshold satisfies the Wilson FPR gate")
    return best


def expected_calibration_error(y_true: np.ndarray, scores: np.ndarray) -> float:
    error = 0.0
    for index in range(10):
        lower = index / 10
        upper = (index + 1) / 10
        members = (scores >= lower) & (
            (scores < upper) | ((index == 9) & (scores <= upper))
        )
        if not np.any(members):
            continue
        error += float(np.mean(members)) * abs(
            float(np.mean(scores[members])) - float(np.mean(y_true[members]))
        )
    return error


def probability_metrics(y_true: np.ndarray, scores: np.ndarray) -> dict[str, float]:
    ai_count = int(np.sum(y_true == 1))
    human_count = int(np.sum(y_true == 0))
    if ai_count == 0 or human_count == 0:
        raise ValueError("probability metrics require both human and AI samples")

    order = np.argsort(scores, kind="stable")
    sorted_scores = scores[order]
    sorted_labels = y_true[order]
    ai_rank_sum = 0.0
    start = 0
    while start < len(order):
        end = start + 1
        while end < len(order) and sorted_scores[end] == sorted_scores[start]:
            end += 1
        average_rank = (start + 1 + end) / 2
        ai_rank_sum += average_rank * int(np.sum(sorted_labels[start:end] == 1))
        start = end
    auroc = (
        ai_rank_sum - ai_count * (ai_count + 1) / 2
    ) / (ai_count * human_count)

    descending = np.argsort(-scores, kind="stable")
    sorted_scores = scores[descending]
    sorted_labels = y_true[descending]
    true_positives = 0
    false_positives = 0
    previous_recall = 0.0
    average_precision = 0.0
    start = 0
    while start < len(descending):
        end = start + 1
        while end < len(descending) and sorted_scores[end] == sorted_scores[start]:
            end += 1
        true_positives += int(np.sum(sorted_labels[start:end] == 1))
        false_positives += int(np.sum(sorted_labels[start:end] == 0))
        recall = true_positives / ai_count
        precision = true_positives / (true_positives + false_positives)
        average_precision += (recall - previous_recall) * precision
        previous_recall = recall
        start = end

    return {
        "auroc": float(auroc),
        "averagePrecision": float(average_precision),
        "brierScore": float(np.mean((scores - y_true) ** 2)),
        "expectedCalibrationError10Bins": expected_calibration_error(y_true, scores),
    }


def threshold_metrics(
    y_true: np.ndarray,
    scores: np.ndarray,
    threshold: float,
    *,
    human_author_independence_established: bool = False,
    human_source_group_independence_established: bool = False,
    ai_source_group_independence_established: bool = False,
) -> dict[str, Any]:
    human = y_true == 0
    ai = y_true == 1
    predicted_ai = scores >= threshold
    false_positives = int(np.sum(predicted_ai & human))
    true_positives = int(np.sum(predicted_ai & ai))
    human_samples = int(np.sum(human))
    ai_samples = int(np.sum(ai))
    interval = wilson_interval(false_positives, human_samples)
    total = human_samples + ai_samples
    release_independence_established = (
        human_author_independence_established
        and human_source_group_independence_established
        and ai_source_group_independence_established
    )
    return {
        "threshold": threshold,
        "falsePositives": false_positives,
        "humanSamples": human_samples,
        "falsePositiveRate": false_positives / human_samples,
        "falsePositiveRate95Ci": interval,
        "truePositives": true_positives,
        "aiSamples": ai_samples,
        "truePositiveRate": true_positives / ai_samples,
        "truePositiveRate95Ci": wilson_interval(true_positives, ai_samples),
        "positiveCallCoverage": int(np.sum(predicted_ai)) / total,
        "targetFalsePositiveRate": TARGET_FPR,
        "targetSupportedAt95Confidence": (
            release_independence_established
            and human_samples >= MINIMUM_GATE_HUMANS
            and interval["upper"] <= TARGET_FPR
        ),
        "evidenceStatus": (
            "supported-at-95-confidence"
            if release_independence_established
            and human_samples >= MINIMUM_GATE_HUMANS
            and interval["upper"] <= TARGET_FPR
            else "release-independence-not-established"
            if not release_independence_established
            else "insufficient-human-samples-or-excess-false-positives"
        ),
        "confidenceIntervalMethod": (
            "Wilson score (row-level; TXD provides no human author identifiers)"
        ),
    }


def source_group_dependence(fixtures: Sequence[Fixture]) -> dict[str, Any]:
    by_label: dict[str, Any] = {}
    for label in ("human", "ai"):
        counts: dict[str, int] = {}
        for fixture in fixtures:
            if fixture.label != label:
                continue
            counts[fixture.source_group_id] = (
                counts.get(fixture.source_group_id, 0) + 1
            )
        sizes = list(counts.values())
        by_label[label] = {
            "samples": sum(sizes),
            "uniqueSourceGroups": len(counts),
            "repeatedSourceGroups": sum(size > 1 for size in sizes),
            "maximumRowsPerSourceGroup": max(sizes) if sizes else None,
        }
    return {
        "byLabel": by_label,
        "humanAuthorIdsAvailable": False,
        "formalRowLevelWilsonSupport": False,
        "reason": (
            "TXD-22 has no human author identifiers; row-level Wilson intervals "
            "cannot establish author-independent false-positive risk."
        ),
    }


def binary_fixtures(fixtures: Sequence[Fixture]) -> list[Fixture]:
    return [fixture for fixture in fixtures if fixture.label in {"human", "ai"}]


def train_model(
    development_input: str, artifact_value: str, report_value: str, seed: int
) -> dict[str, Any]:
    from sklearn.linear_model import LogisticRegression, SGDClassifier

    artifact_path = ensure_temp_path(artifact_value)
    report_path = ensure_temp_path(report_value)
    fixtures = binary_fixtures(read_fixtures(development_input, "development"))
    partitions = {
        name: [
            fixture
            for fixture in fixtures
            if development_partition(fixture.source_group_id) == name
        ]
        for name in ("train", "calibration", "operating")
    }
    for name, members in partitions.items():
        if set(labels(members)) != {0, 1}:
            raise ValueError(f"development {name} partition must contain both labels")
    features = feature_union()
    train_texts = [fixture.text for fixture in partitions["train"]]
    train_labels = labels(partitions["train"])
    started = time.perf_counter()
    train_matrix = features.transform(train_texts)
    classifier = SGDClassifier(
        loss="log_loss",
        penalty="l2",
        alpha=1e-5,
        max_iter=100,
        tol=1e-4,
        class_weight="balanced",
        random_state=seed,
    )
    classifier.fit(train_matrix, train_labels)
    calibration_matrix = features.transform(
        [fixture.text for fixture in partitions["calibration"]]
    )
    calibration_raw = classifier.decision_function(calibration_matrix).reshape(-1, 1)
    calibrator = LogisticRegression(C=1.0, solver="lbfgs", random_state=seed)
    calibrator.fit(calibration_raw, labels(partitions["calibration"]))
    artifact = {
        "schemaVersion": ARTIFACT_SCHEMA_VERSION,
        "modelFamily": MODEL_FAMILY,
        "features": features,
        "classifier": classifier,
        "calibrator": calibrator,
        "trainingGroups": sorted(
            {fixture.source_group_id for fixture in fixtures}
        ),
        "seed": seed,
    }
    operating = partitions["operating"]
    operating_scores = score_texts(artifact, [fixture.text for fixture in operating])
    operating_labels = labels(operating)
    operating_point = choose_threshold(operating_labels, operating_scores)
    artifact["threshold"] = operating_point["threshold"]
    elapsed_ms = (time.perf_counter() - started) * 1000
    artifact_path.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(artifact, artifact_path, compress=3)
    artifact_sha256 = hashlib.sha256(artifact_path.read_bytes()).hexdigest()
    report = {
        "schemaVersion": 1,
        "warning": (
            "Experimental scratch baseline only. TXD development performance is not "
            "independent accuracy evidence."
        ),
        "model": {
            "family": MODEL_FAMILY,
            "pretrainedWeights": False,
            "questionIncludedAsFeature": False,
            "seed": seed,
            "features": {
                "characterNgrams": [3, 5],
                "wordNgrams": [1, 2],
                "hashDimensions": 2**18 + 2**17,
            },
            "artifact": str(artifact_path),
            "artifactSha256": artifact_sha256,
            "artifactBytes": artifact_path.stat().st_size,
        },
        "development": {
            "samples": len(fixtures),
            "partitionSamples": {
                name: {
                    "total": len(members),
                    "human": int(np.sum(labels(members) == 0)),
                    "ai": int(np.sum(labels(members) == 1)),
                }
                for name, members in partitions.items()
            },
            "operatingProbabilityMetrics": probability_metrics(
                operating_labels, operating_scores
            ),
            "preRegisteredOperatingPoint": operating_point,
            "dependenceAudit": source_group_dependence(operating),
        },
        "runtime": {
            "python": platform.python_version(),
            "scikitLearn": sys.modules["sklearn"].__version__,
            "platform": platform.platform(),
            "trainingAndCalibrationMs": elapsed_ms,
        },
    }
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return report


def evaluate_model(
    artifact_value: str,
    input_value: str,
    name: str,
    report_value: str,
    language: str,
    split_role: str,
) -> dict[str, Any]:
    if split_role not in EVALUATION_SPLIT_ROLES:
        raise ValueError("evaluation split role must be validation or locked")
    artifact_path = ensure_temp_path(artifact_value)
    report_path = ensure_temp_path(report_value)
    artifact = joblib.load(artifact_path)
    if (
        artifact.get("schemaVersion") != ARTIFACT_SCHEMA_VERSION
        or artifact.get("modelFamily") != MODEL_FAMILY
        or not isinstance(artifact.get("threshold"), float)
    ):
        raise ValueError("scratch model artifact is malformed or incompatible")
    fixtures = [
        fixture
        for fixture in binary_fixtures(read_fixtures(input_value, split_role))
        if language == "all" or fixture.language == language
    ]
    if not fixtures:
        raise ValueError(f"evaluation input has no {language} binary fixtures")
    overlap = set(artifact["trainingGroups"]) & {
        fixture.source_group_id for fixture in fixtures
    }
    if overlap:
        raise ValueError("evaluation input overlaps a development source group")
    texts = [fixture.text for fixture in fixtures]
    started = time.perf_counter()
    scores = score_texts(artifact, texts)
    batch_elapsed_ms = (time.perf_counter() - started) * 1000
    score_texts(artifact, texts[: min(8, len(texts))])
    latencies: list[float] = []
    for text in texts:
        item_started = time.perf_counter()
        score_texts(artifact, [text])
        latencies.append((time.perf_counter() - item_started) * 1000)
    y_true = labels(fixtures)
    threshold = artifact["threshold"]
    result = {
        "schemaVersion": 1,
        "warning": (
            "Research-only evaluation. Passing one dataset does not establish general "
            "authorship detection accuracy."
        ),
        "name": name,
        "model": {
            "family": MODEL_FAMILY,
            "pretrainedWeights": False,
            "questionIncludedAsFeature": False,
            "artifactSha256": hashlib.sha256(artifact_path.read_bytes()).hexdigest(),
            "artifactBytes": artifact_path.stat().st_size,
        },
        "dataset": {
            "samples": len(fixtures),
            "human": int(np.sum(y_true == 0)),
            "ai": int(np.sum(y_true == 1)),
            "splitRoles": sorted({fixture.split_role for fixture in fixtures}),
            "fixtureSha256": hashlib.sha256(
                Path(input_value).read_bytes()
            ).hexdigest(),
        },
        "probabilityMetrics": probability_metrics(y_true, scores),
        "fixedOperatingPoint": threshold_metrics(y_true, scores, threshold),
        "dependenceAudit": source_group_dependence(fixtures),
        "runtime": {
            "batchTotalMs": batch_elapsed_ms,
            "batchMeanPerSampleMs": batch_elapsed_ms / len(fixtures),
            "singleSampleMeanMs": float(np.mean(latencies)),
            "singleSampleMedianMs": float(np.median(latencies)),
            "singleSampleP95Ms": float(np.percentile(latencies, 95)),
        },
        "rowsOmitted": True,
    }
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    return result


def main() -> None:
    args = parse_args()
    if args.command == "prepare-txd":
        result = prepare_txd(args.split_role, args.per_label, args.output)
    elif args.command == "train":
        result = train_model(
            args.development_input, args.artifact, args.report, args.seed
        )
    else:
        result = evaluate_model(
            args.artifact,
            args.input,
            args.name,
            args.report,
            args.language,
            args.split_role,
        )
    json.dump(result, sys.stdout, indent=2)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
