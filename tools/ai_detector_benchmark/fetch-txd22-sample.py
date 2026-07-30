#!/usr/bin/env python3
"""Stream a pinned, grouped TXD-22 sample as DJL benchmark JSONL."""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import re
import sys
import unicodedata
import urllib.parse
import urllib.request
from collections import defaultdict
from dataclasses import dataclass
from typing import Iterable, Sequence


DATASET_ID = "prcjcggtjf"
DATASET_VERSION = 1
DATASET_DOI = "10.17632/prcjcggtjf.1"
FILE_ID = "1e842f9d-4ff8-4986-bc7c-cde460f806ee"
FILE_SIZE = 121_656_267
FILE_SHA256 = "232c260f8caf7ea61a331f39fa730956862afbe0c5fc554720daa07d215a2f7d"
FILE_URL = (
    f"https://data.mendeley.com/public-files/datasets/{DATASET_ID}/files/"
    f"{FILE_ID}/file_downloaded"
)
LICENSE = "CC-BY-4.0"
HUMAN_SOURCE = "Human written"
AI_SOURCES = frozenset(
    {
        "BLACKBOXAI",
        "ChatGPT",
        "Claude",
        "Copilot",
        "DeepAI",
        "DeepSeek",
        "Gemini",
        "Gemma",
        "Grok",
        "Llama",
        "Mistral AI",
        "Nova",
        "Perplexity",
        "Pi",
        "Poe",
        "Qwen",
        "Z.ai",
    }
)
REFINED_SOURCES = frozenset(
    {
        "AI-generated and AI-refined",
        "AI-generated and AI-refined and Human-written",
        "AI-generated and Human-written",
        "Human-written and AI-refined",
    }
)
TRUSTED_DOWNLOAD_HOSTS = frozenset(
    {
        "data.mendeley.com",
        "static.data.mendeley.com",
        "prod-dcd-datasets-public-files-eu-west-1.s3.eu-west-1.amazonaws.com",
    }
)
MIN_TEXT_CHARACTERS = 120
GROUPING_VERSION = "txd22-question-nfkc-casefold-ws-v2"


@dataclass(frozen=True)
class SourceRow:
    question: str
    answer: str
    source: str
    source_group_id: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--split-role", required=True, choices=("development", "validation"))
    parser.add_argument("--per-binary-label", type=int, default=100)
    parser.add_argument("--ai-refined", type=int, default=100)
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args()
    if not 1 <= args.per_binary_label <= 1000:
        parser.error("--per-binary-label must be from 1 through 1000")
    if not 0 <= args.ai_refined <= 1000:
        parser.error("--ai-refined must be from 0 through 1000")
    return args


def canonical_source(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def normalize_question(question: str) -> str:
    normalized = unicodedata.normalize("NFKC", question)
    return re.sub(r"\s+", " ", normalized).strip().casefold()


def source_group_id(question: str) -> str:
    return hashlib.sha256(normalize_question(question).encode("utf-8")).hexdigest()


def raw_question_id(question: str) -> str:
    return hashlib.sha256(question.encode("utf-8")).hexdigest()


def split_role_for_group(group_id: str) -> str:
    bucket = int(group_id[:8], 16) % 10
    if bucket <= 5:
        return "development"
    # TXD-22's former locked partition was opened on 2026-07-25, and the
    # corrected v2 grouping overlaps those observed v1 roles. No TXD-22 row may
    # be represented as untouched release evidence again.
    return "validation"


def stable_row_key(row: SourceRow) -> str:
    return hashlib.sha256(
        f"{row.source_group_id}\0{row.source}\0{row.answer}".encode("utf-8")
    ).hexdigest()


def decode_rows(data: bytes) -> tuple[list[SourceRow], int]:
    # The published file is mostly Windows-1252 but contains 378 undefined
    # bytes. Records containing a replacement character are excluded by a
    # detector-independent quality rule and counted in the audit summary.
    text = data.decode("cp1252", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    if reader.fieldnames != ["Question", "Answer", "Source"]:
        raise ValueError(f"TXD-22 columns changed: {reader.fieldnames!r}")
    rows: list[SourceRow] = []
    excluded_encoding_rows = 0
    for record in reader:
        question = record["Question"].strip()
        answer = record["Answer"].strip()
        source = canonical_source(record["Source"])
        if "\ufffd" in question or "\ufffd" in answer or "\ufffd" in source:
            excluded_encoding_rows += 1
            continue
        if not question or len(answer) < MIN_TEXT_CHARACTERS:
            continue
        if source not in AI_SOURCES and source not in REFINED_SOURCES and source != HUMAN_SOURCE:
            raise ValueError(f"TXD-22 contains an unknown source label: {source!r}")
        rows.append(
            SourceRow(
                question=question,
                answer=answer,
                source=source,
                source_group_id=source_group_id(question),
            )
        )
    return rows, excluded_encoding_rows


def select_balanced(
    rows: Sequence[SourceRow],
    sources: Iterable[str],
    total: int,
) -> list[SourceRow]:
    by_source: dict[str, list[SourceRow]] = defaultdict(list)
    for row in rows:
        if row.source in sources:
            by_source[row.source].append(row)
    ordered_sources = sorted(sources)
    for source in ordered_sources:
        by_source[source].sort(key=stable_row_key)
    selected: list[SourceRow] = []
    indices = {source: 0 for source in ordered_sources}
    while len(selected) < total:
        progressed = False
        for source in ordered_sources:
            index = indices[source]
            if index < len(by_source[source]):
                selected.append(by_source[source][index])
                indices[source] = index + 1
                progressed = True
                if len(selected) == total:
                    break
        if not progressed:
            raise ValueError(f"TXD-22 split has only {len(selected)} eligible requested records")
    return selected


def fetch_dataset() -> bytes:
    request = urllib.request.Request(FILE_URL, headers={"User-Agent": "DJL-benchmark-audit/1"})
    with urllib.request.urlopen(request) as response:
        final_url = urllib.parse.urlparse(response.geturl())
        if final_url.scheme != "https" or final_url.hostname not in TRUSTED_DOWNLOAD_HOSTS:
            raise ValueError(f"TXD-22 download redirected to an untrusted host: {response.geturl()}")
        data = response.read(FILE_SIZE + 1)
    if len(data) != FILE_SIZE:
        raise ValueError(f"TXD-22 size changed: expected {FILE_SIZE}, received {len(data)}")
    digest = hashlib.sha256(data).hexdigest()
    if digest != FILE_SHA256:
        raise ValueError(f"TXD-22 hash changed: expected {FILE_SHA256}, received {digest}")
    return data


def fixture(row: SourceRow, split_role: str) -> dict[str, object]:
    if row.source == HUMAN_SOURCE:
        label = "human"
        scenario = "human-original"
    elif row.source in AI_SOURCES:
        label = "ai"
        scenario = "ai-generated"
    else:
        label = "ai-refined"
        scenario = "mixed-or-refined"
    source_slug = re.sub(r"[^a-z0-9]+", "-", row.source.lower()).strip("-")
    return {
        "id": f"txd22-{source_slug}-{row.source_group_id[:16]}",
        "language": "en",
        "label": label,
        "text": row.answer,
        "provenance": (
            f"Mendeley Data {DATASET_DOI} file-sha256={FILE_SHA256} "
            f"source={row.source} grouping={GROUPING_VERSION} "
            f"group={row.source_group_id} raw-question-sha256={raw_question_id(row.question)}"
        ),
        "license": LICENSE,
        "splitRole": split_role,
        "sourceGroupId": row.source_group_id,
        "promptFamily": row.source_group_id,
        "nativeLanguageCohort": "not-reported",
        "scenario": scenario,
        **({"generator": row.source} if row.source in AI_SOURCES else {}),
        **({"attackEditing": row.source} if row.source in REFINED_SOURCES else {}),
    }


def fixture_jsonl_bytes(value: dict[str, object]) -> bytes:
    return (
        json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n"
    ).encode("utf-8")


def main() -> None:
    args = parse_args()
    rows, excluded_encoding_rows = decode_rows(fetch_dataset())
    selected_split = [
        row for row in rows if split_role_for_group(row.source_group_id) == args.split_role
    ]
    selected = [
        *select_balanced(selected_split, {HUMAN_SOURCE}, args.per_binary_label),
        *select_balanced(selected_split, AI_SOURCES, args.per_binary_label),
        *select_balanced(selected_split, REFINED_SOURCES, args.ai_refined),
    ]
    ids = [fixture(row, args.split_role)["id"] for row in selected]
    if len(ids) != len(set(ids)):
        raise ValueError("TXD-22 selection produced duplicate fixture ids")
    if not args.quiet:
        print(
            json.dumps(
                {
                    "dataset": DATASET_DOI,
                    "splitRole": args.split_role,
                    "selected": len(selected),
                    "excludedEncodingRows": excluded_encoding_rows,
                    "authorIdsAvailable": False,
                },
                sort_keys=True,
            ),
            file=sys.stderr,
        )
    for row in selected:
        # Do not inherit the Windows console code page: benchmark fixtures can
        # legitimately contain characters that CP936/GBK cannot represent.
        sys.stdout.buffer.write(fixture_jsonl_bytes(fixture(row, args.split_role)))


if __name__ == "__main__":
    main()
