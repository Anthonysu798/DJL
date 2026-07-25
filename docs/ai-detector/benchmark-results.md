# Benchmark results

## 2026-07-15 synthetic harness smoke run

This run validates the production pipeline and benchmark instrumentation only. Four team-written synthetic records are not representative of real human or AI writing, so these counts are **not an accuracy measurement or product claim**.

| Fact                                   | Measured value                                                     |
| -------------------------------------- | ------------------------------------------------------------------ |
| Dataset                                | `tools/ai_detector_benchmark/fixtures/smoke.jsonl`                 |
| Dataset SHA-256                        | `ece0ad752b3f7d84ca550dadca394cdd57daaea93b4c03cb1e009d1dd9e99170` |
| Runtime                                | Bun 1.3.13, macOS arm64                                            |
| Hardware                               | Apple M1 Max, 10 logical CPUs, 32 GiB memory                       |
| English                                | 2 samples; 1 matched fixture label; 0 uncertain                    |
| Simplified Chinese                     | 2 samples; 2 matched fixture labels; 0 uncertain                   |
| Total inference wall time              | 1,051.6 ms                                                         |
| Median per-record latency              | 341.1 ms                                                           |
| Maximum observed record latency        | 652.2 ms (included first English model load)                       |
| Observed process RSS high-water sample | 658,472,960 bytes                                                  |

Predictions were identical on the repeated manager/cache check. All four eligible fixture reports summed to 100%. The immediate second four-record run returned the same predictions from the hash-only cache in 21.0 ms total, with a 0.27 ms median per-record latency.

## 2026-07-15 offline runtime determinism check

`verify-runtime.ts` re-hashed the installed artifacts, replaced global `fetch` with a blocking function, and ran the CPU classifier 20 times per language. English and Simplified Chinese each produced a floating-point score spread of `0` (tolerance `1e-12`), the mixed-language report produced one unique displayed result across 20 recomputations, and the runtime made zero network attempts. The tested sample scores were `0.9840736985206604` for English and `0.9966828227043152` for Simplified Chinese; these fixture predictions are runtime checks, not accuracy evidence.

At the then-current English threshold, the classifier labeled the reflective synthetic human fixture as likely AI. That historical false positive triggered the conservative recalibration below; the Beta label, disclaimer, passage evidence, and prohibition on consequential single-source use remain mandatory. It also confirms that this smoke corpus cannot justify a production accuracy threshold.

## 2026-07-15 revision-pinned HC3 conservative calibration run

The release harness streamed 200 licensed HC3 answers—50 human and 50 ChatGPT answers per language—through the production extraction, routing, tokenization, local inference, calibration, aggregation, and cache path. Source text was not persisted by the sampler or included in the report. The sample is deterministic, but it is small, QA-domain-heavy, and may overlap model training data; it is safety evidence for these recorded sources only, not a general accuracy claim.

| Fact                                   | Measured value                                                                                                     |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Dataset SHA-256                        | `7047b231d6ce67532a5abcd10399ffdac081deea49a8e442dc9ce52390cb6951`                                                 |
| English source                         | `Hello-SimpleAI/HC3@4d0ff18143b5a7e1b1e79beb540c04549d1e59d3`, `wiki_csai`, CC-BY-SA-4.0                           |
| Simplified Chinese sources             | `Hello-SimpleAI/HC3-Chinese@09a687b8dc164b89e7df95abf15df3b216bc31c2`, `open_qa` (MIT) and `psychology` (CC0-1.0)  |
| Runtime / hardware                     | Bun 1.3.13, macOS arm64, Apple M1 Max, 10 logical CPUs, 32 GiB memory                                              |
| English calibration                    | `djl-en-hc3-short-evidence-v3`; human `≤ 0.35`, likely AI `≥ 0.985`, with at least 600 eligible English characters |
| Simplified Chinese calibration         | `djl-zh-hans-conservative-v1`; human `≤ 0.25`, likely AI `≥ 0.8`                                                   |
| English confusion                      | 12 TP, 10 TN, 0 FP, 0 FN, 78 abstentions                                                                           |
| English rates                          | 0% false positives, 24% recall, 22% coverage, 100% selective accuracy                                              |
| Simplified Chinese confusion           | 35 TP, 44 TN, 0 FP, 1 FN, 20 abstentions                                                                           |
| Simplified Chinese rates               | 0% false positives, 70% recall, 80% coverage, 98.75% selective accuracy                                            |
| Overall                                | 47 TP, 54 TN, 0 FP, 1 FN, 98 abstentions; 51% coverage; 99.02% selective accuracy                                  |
| Cold/evicted-path inference time       | 22.33 s total; 77.51 ms median; 252.65 ms p95                                                                      |
| Observed process RSS high-water sample | 646,266,880 bytes                                                                                                  |

The prior English threshold (`0.75`) produced 34 likely-AI false positives across the same 100 human records overall, including 68% of English human records. Because false accusations are the most serious detector failure, the English threshold was raised and short English documents were made ineligible for a likely-AI label under new calibration versions. The 600-character evidence floor was added after a 410-character human prose fixture still scored above `0.985`; it changed two HC3 AI predictions to abstentions and introduced no holdout false positives. The cache identity includes the calibration version, so earlier classifications cannot cross into the recalibrated path. The result intentionally trades English coverage for abstention: more than three quarters of this English sample is inconclusive rather than overclaimed.

## Release-gate status

- Local runtime, pinned artifact, deterministic aggregation, cache, harness smoke, and the recorded conservative HC3 safety holdout: passed on the machine above.
- Larger representative English/Chinese accuracy, domain/length/native-language slices, edited/mixed authorship, cross-platform performance, and independent false-positive review: not yet satisfied. English coverage is explicitly limited.
- Production accuracy claim or removal of Beta: blocked until those representative gates are documented and pass.
