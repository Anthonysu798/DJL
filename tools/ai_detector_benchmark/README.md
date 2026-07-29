# AI Writing Check benchmark harness

Run the same pipeline and installed model artifacts used by DJL:

```bash
bun tools/ai_detector_benchmark/run.ts \
  --input tools/ai_detector_benchmark/fixtures/smoke.jsonl \
  --state-dir /path/to/djl-state
```

Add `--summary-only` to omit per-record derived rows from stdout. Aggregate metrics, slices, dataset hashes, and runtime evidence remain in the report; source text is never included. Benchmark analysis bypasses both result-cache reads and writes, fails if any cache hit is observed, and records the preprocessing, segmentation, model revision, complete artifact fingerprint, file hashes, output contract, calibration bands, and cache-hit count in schema 8.

For example, evaluate the current English v8 policy on a homogeneous English
fixture with `--fixed-human-threshold 0.35 --fixed-ai-threshold 0.99
--fixed-ai-minimum-characters 600`. The runner applies those frozen thresholds
to every raw scored region, counts unique eligible characters, uses the same
largest-remainder rounding and 65% document decision helpers as production, and
does not search or adjust the policy on the tested split. Use separate runs for
languages with different policies. The general evidence minimum is automatically
fixed at 120 eligible characters for both likely-human and likely-AI calls; the
supplied AI-specific minimum is an additional constraint and must be at least 120.

Input is JSONL with `id`, `language`, `label`, `text`, `provenance`, and `license`. Labels may be `human`, `ai`, or `ai-refined`. Optional audit metadata includes `splitRole`, `sourceGroupId`, `authorId`, `promptFamily`, `nativeLanguageCohort`, `scenario`, `domain`, `generator`, and `attackEditing`. The parser rejects empty inputs, duplicate fixture IDs, invalid metadata, canonical-text duplicates across roles, and any NFKC-, whitespace-, and case-normalized source group, author, or prompt family that leaks across declared roles. Pass `--split-role validation` or `--split-role locked` to make every row's explicit role fail-closed for a formal run; locked rows are rejected without the matching assertion.

Binary classification and score metrics exclude `ai-refined`; those records instead receive a separate AI/human/inconclusive outcome distribution so hybrid authorship is not forced into a misleading binary accuracy target. Schema 8 output also contains the dataset digest, runtime/hardware facts, metrics by language and eligible-length band, uncertainty, latency, memory, and individual predictions. The document AI-evidence score is the length-weighted 35th percentile of eligible region scores. It is a ranking statistic, so AUROC, average precision, fixed thresholds, and observed recall at false-positive-rate targets of 0.1%, 1%, and 5% remain meaningful. It is not a calibrated probability, so schema 8 returns `null` for Brier score and expected calibration error and an empty calibration-bin list. The benchmark reconstructs the production aggregation decision separately because percentage rounding can differ from the percentile at exact 65% boundaries. A dedicated challenger evaluator may report Brier and calibration error for direct classifier probabilities; those values do not give the production percentile probability semantics.

Every rate is accompanied by a row-level Wilson 95% confidence interval and a dependence audit. Row-level intervals are descriptive when human author IDs are absent or repeated, when multiple human rows share one source group, or when multiple AI rows share one prompt/source group. An operating point is marked supported only when its false-positive-rate upper confidence bound is within the target, human authors are explicitly independent, and both the human and AI source groups contain one evaluated row apiece. For orientation, observing no false positives needs about 381 independent human samples to support a 1% upper bound and about 3,838 to support a 0.1% upper bound. A locked split disables threshold search completely and the runner requires `--split-role locked`; development and validation operating points are explicitly descriptive and cannot be promoted to release claims.

The checked-in corpus is synthetic and exists only to smoke-test the harness. It must never be used for a product accuracy claim or release threshold.

## Observed TXD-22 English challenger evaluation

TXD-22 is a July 2026 CC-BY-4.0 English dataset with human, generated, and AI-refined or mixed answers. The sampler pins the published file ID, byte size, and SHA-256. Grouping v2 applies NFKC, whitespace collapse and trim, and case-folding before hashing; provenance records the grouping version, canonical group hash, and raw-question SHA-256 without emitting the prompt text. The source does not provide human author IDs, so TXD-22 can demonstrate current prompt-group isolation but not author-disjoint generalization.

Use development data to compare candidates and choose a threshold:

```bash
python tools/ai_detector_benchmark/fetch-txd22-sample.py \
  --split-role development \
  --per-binary-label 200 \
  --ai-refined 200 \
  | python tools/ai_detector_benchmark/evaluate-hf-challenger.py \
      --input - \
      --model MODEL_ID \
      --revision IMMUTABLE_40_CHARACTER_COMMIT \
      --model-license SPDX_LICENSE \
      --split-role development \
      --threshold 0.5 \
      --summary-only
```

Re-run the selected, frozen model and threshold on `validation`. The TXD-22 sampler deliberately has no `locked` option: a v2 audit found three canonical prompt clusters crossing the earlier v1 trimmed-hash roles, and 277 of the 550 groups that would have occupied v2 buckets 8–9 had already appeared in old runs. V2 therefore assigns buckets 0–5 to development and 6–9 to observed validation. Use a different, genuinely untouched dataset for final release evaluation. For a two-logit model whose config uses generic labels, pass `--ai-label-index` only after independently reviewing the model card or training code. A single-logit model fails closed unless its reviewed output contract is declared with `--single-logit-polarity ai` or `--single-logit-polarity human`; the latter is converted to AI probability with an inverted sigmoid. The report records that polarity alongside the exact model revision and license, dataset digest, split role, classification and calibration metrics, confidence intervals, per-source slices, AI-refined outcomes, runtime, and peak RSS without retaining source text.

`evaluate-hf-challenger.py` is a research candidate-ranking screen. It runs the PyTorch model over raw answer text with one tokenizer truncation; it does not test an exported ONNX/q8 artifact or DJL's extraction, routing, passage segmentation, aggregation, and cache path. A candidate that survives this screen still needs artifact provenance review, export and quantization validation, and production-harness evaluation on a genuinely untouched external source. Challenger output alone cannot pass a release gate.

All earlier v1 TXD-22 partitions, including the partition once labeled locked and the scratch-hashing experiment inputs, are observed validation evidence only. Their candidate-rejection conclusions remain valid, but favorable metrics are not clean split-generalization evidence. TXD-22 is not a substitute for peer-reviewed, author-disjoint, non-native, adversarial, or product-domain evaluation and cannot support a universal accuracy claim.

For the licensed, revision-pinned HC3 source, stream a balanced sample directly into the runner so source text is not written to the repository or benchmark state:

```bash
bun tools/ai_detector_benchmark/fetch-hc3-sample.ts \
  --pairs-per-language 50 \
  --row-offset 100 \
  --split-role validation \
  | bun tools/ai_detector_benchmark/run.ts \
      --input - \
      --state-dir /path/to/djl-state \
      --split-role validation \
  > /path/to/private-report.json
```

The sampler downloads each JSONL file through an immutable commit URL instead of coupling a current-HEAD check to an unpinned dataset-viewer request. Each offset selects one fixed 100-row upstream window per source configuration, and all offsets must be multiples of 100. The enforced role map is offset 0 for development; offsets 100, 200, 300, 400, 500, and 600 for observed validation; and every other allowed window for a prospective locked run. Offsets 400 and 600 have already been opened and cannot be reused or described as untouched. The sampler draws paired human and ChatGPT answers deterministically from English HC3 `wiki_csai` and round-robins Simplified Chinese HC3 `open_qa` and `psychology` so one source cannot silently consume the full Chinese quota. The report records source revisions, configurations, licenses, the streamed dataset digest, confusion counts, false-positive and true-positive rates, coverage, selective accuracy, F1, abstentions, and dependence diagnostics. It emits identifiers and derived results but not source text. HC3 is a limited QA-domain holdout with possible training overlap, not a general accuracy claim.

Use a non-overlapping, role-correct 100-row window and record when it is opened. Declaring a role does not restore untouched status after results have been inspected. All variants derived from one source row must remain in the same split.

Windows PowerShell 5.1 transcodes native pipelines using a legacy encoding unless UTF-8 is selected. Set it before streaming a Chinese corpus:

```powershell
$utf8 = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = $utf8
[Console]::OutputEncoding = $utf8
```

For an external Simplified Chinese stress test, stream a deterministic balanced sample from the revision- and Git-blob-pinned NLPCC 2025 DetectRL-ZH test set:

```bash
bun tools/ai_detector_benchmark/fetch-nlpcc-zh-sample.ts --per-label 10 \
  | bun tools/ai_detector_benchmark/run.ts \
      --input - \
      --state-dir /path/to/djl-state
```

The eight reported scenarios are normal DeepSeek-V3 creative writing, human/AI mixing, English-to-Chinese round-trip paraphrasing, visually similar character perturbations, and 64/128/256/512-character slices. Upstream declares research-use task restrictions but no SPDX dataset license, so the sampler streams a bounded subset for local evaluation and the text must not be checked into DJL or redistributed. The recorded 2026-07-25 run was used to reject an unsafe threshold candidate, so it is validation evidence rather than an untouched final test.

To audit human-written (HWT), LLM-generated (LGT), and LLM-refined human writing (HLT) separately, stream the fully labeled NLPCC 2026 Task 6 Phase 2 data after the final policy is frozen:

```bash
bun tools/ai_detector_benchmark/fetch-nlpcc-2026-sample.ts --per-label 10 \
  | bun tools/ai_detector_benchmark/run.ts \
      --input - \
      --state-dir /path/to/djl-state
```

The sampler pins the repository commit and reviewed Git blob, then takes the first deterministic 10 records per label after requiring at least 120 Han characters and at least as many Han as Latin characters. That transparent filter removes the pure-English HLT noise documented by the organizers without consulting detector outputs. HLT results are an outcome distribution, not a binary accuracy score. The repository declares shared-task usage terms and copyright but no SPDX dataset license, so source text is streamed only and must not be checked in or redistributed.

After both models are installed, verify 20-run English, Simplified Chinese, and mixed-document determinism while all outbound fetches are blocked:

```bash
bun tools/ai_detector_benchmark/verify-runtime.ts \
  --state-dir /path/to/djl-state
```

This command also re-hashes every pinned model artifact before inference and exits nonzero on corruption, network access, floating-point drift above `1e-12`, or a change in displayed mixed-document coverage.
