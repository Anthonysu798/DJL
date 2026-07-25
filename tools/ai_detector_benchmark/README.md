# AI Writing Check benchmark harness

Run the same pipeline and installed model artifacts used by DJL:

```bash
bun tools/ai_detector_benchmark/run.ts \
  --input tools/ai_detector_benchmark/fixtures/smoke.jsonl \
  --state-dir /path/to/djl-state
```

Input is JSONL with `id`, `language`, `label`, `text`, `provenance`, and `license`. The runner rejects incomplete or short records. Output is JSON containing the dataset digest, runtime/hardware facts, per-language counts, uncertainty, latency, memory, and individual predictions.

The checked-in corpus is synthetic and exists only to smoke-test the harness. It must never be used for a product accuracy claim or release threshold.

For the licensed, revision-pinned HC3 holdout, stream a balanced sample directly into the runner so source text is not written to the repository or benchmark state:

```bash
bun tools/ai_detector_benchmark/fetch-hc3-sample.ts --pairs-per-language 50 \
  | bun tools/ai_detector_benchmark/run.ts \
      --input /dev/stdin \
      --state-dir /path/to/djl-state \
  > /path/to/private-report.json
```

The sampler verifies the current Hugging Face repository commit before reading rows and fails closed if it differs from the reviewed revision. It draws paired human and ChatGPT answers deterministically from English HC3 `wiki_csai` and Simplified Chinese HC3 `open_qa` and `psychology`. The report records source revisions, configurations, licenses, the streamed dataset digest, confusion counts, false-positive and true-positive rates, coverage, selective accuracy, F1, and abstentions. It emits identifiers and derived results but not source text. HC3 is a limited QA-domain holdout with possible training overlap, not a general accuracy claim.

After both models are installed, verify 20-run English, Simplified Chinese, and mixed-document determinism while all outbound fetches are blocked:

```bash
bun tools/ai_detector_benchmark/verify-runtime.ts \
  --state-dir /path/to/djl-state
```

This command also re-hashes every pinned model artifact before inference and exits nonzero on corruption, network access, floating-point drift above `1e-12`, or a change in displayed mixed-document coverage.
