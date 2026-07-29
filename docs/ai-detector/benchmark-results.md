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

That cached timing is retained as a historical cache check, not inference performance. Current schema 8 benchmark runs bypass cache reads and writes, fail on any cache hit, fully checksum-verify installed artifacts before scoring, and embed model-file hashes, output contracts, calibration bands, and cache-hit count in the report.

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

## 2026-07-25 conservative length-band calibration and Windows evaluation

This work compared candidate policies and the reconstructed pre-length-band production policy over identical extracted text and region scores. The final calibration versions are `djl-en-conservative-length-bands-v8` and `djl-zh-hans-selective-human-v3`.

The final English policy uses a human threshold of `0.35`, never returns likely AI below 600 eligible characters, and uses an AI threshold of `0.99` from 600 characters onward. The final Simplified Chinese policy retains its `0.8` AI threshold; its human threshold is `0.015` below 600 eligible characters and `0.25` from 600 characters. In either language, at least 120 eligible characters in that language are required before a likely-human or likely-AI result; shorter evidence remains uncertain. These policies prioritize avoiding false accusations and abstain whenever the selected evidence standard is not met.

### Sequential calibration and validation

The experiment did not proceed directly from one calibration set to one holdout. Each inspected partition was reclassified as calibration or validation data, and the chronology is recorded here so no observed set is presented as untouched:

1. HC3 offset 0 (`b22d80eb20ed9bff8e9283eb78e08b2a618aeb266313070f53341f24c0eaa206`) was used for calibration and candidate comparison.
2. HC3 offset 100 (`170ff3772b3fd52646f4b800c9a6579dfe927557d38da8cf4a952055bda2f5b8`) was observed during policy development and is validation data, not a locked result.
3. A more aggressive Simplified Chinese candidate produced 1 false positive among 80 NLPCC human records and was rejected. The Chinese `0.8` AI threshold was retained.
4. An earlier English v6 candidate produced 2 false positives among 50 English human answers on the new offset-200 validation partition (`47be7949713ae7c18c3655a1230eccdad779f8a3fafe7f59401476e44e79d47a`) and was rejected.
5. Restoring the legacy English `0.985` AI threshold still produced 1 false positive among 50 English human answers on the new offset-300 validation partition (`4831aa58125f033382076a5f5aeb8a85990c7649962176ea57d771915a1bf08c`) and was rejected.
6. After both policies were frozen, HC3 offset 400 was opened as the only untouched locked partition.

Each HC3 partition contains 200 answers: 50 human and 50 ChatGPT answers per language.

### HC3 offset-0 calibration results

| Profile                       |  TP |  TN |  FP |  FN | Abstentions | Coverage | Selective accuracy |
| ----------------------------- | --: | --: | --: | --: | ----------: | -------: | -----------------: |
| Legacy pre-length-band policy |  48 |  55 |   0 |   1 |          96 |    52.0% |             99.04% |
| Final v8/v3 policy            |  35 |  45 |   0 |   0 |         120 |    40.0% |               100% |

| Final-policy slice |  TP |  TN |  FP |  FN | Abstentions | Recall | Coverage |
| ------------------ | --: | --: | --: | --: | ----------: | -----: | -------: |
| English            |   0 |  11 |   0 |   0 |          89 |     0% |      11% |
| Simplified Chinese |  35 |  34 |   0 |   0 |          31 |    70% |      69% |

These are calibration results, not an unbiased accuracy estimate. Offset 100 was also inspected before the final v8 policy was selected, so its earlier results are validation evidence only and are intentionally not reported as final or locked.

### Then-untouched locked HC3 offset-400 results

The locked input SHA-256 was `edf604d12f4e0acdc4f360fc913dcfb266a0a4caca3eb0e270439c3778c43517`.

| Profile                       |  TP |  TN |  FP |  FN | Abstentions | Coverage | Selective accuracy |
| ----------------------------- | --: | --: | --: | --: | ----------: | -------: | -----------------: |
| Legacy pre-length-band policy |  43 |  58 |   0 |   6 |          93 |    53.5% |           94.3925% |
| Final v8/v3 policy            |  35 |  52 |   0 |   0 |         113 |    43.5% |               100% |

| Policy and language       |  TP |  TN |  FP |  FN | Abstentions | Recall | Coverage | Selective accuracy |
| ------------------------- | --: | --: | --: | --: | ----------: | -----: | -------: | -----------------: |
| Final English             |   0 |  14 |   0 |   0 |          86 |     0% |      14% |               100% |
| Final Simplified Chinese  |  35 |  38 |   0 |   0 |          27 |    70% |      73% |               100% |
| Legacy English            |   8 |  14 |   0 |   0 |          78 |    16% |      22% |               100% |
| Legacy Simplified Chinese |  35 |  44 |   0 |   6 |          15 |    70% |      85% |             92.94% |

The locked run used Windows x64, Bun 1.3.13, an Intel Core i7-12700K with 20 logical CPUs, and 32 GB memory. The uncached detector-result path took 18,284.8427 ms total, with 69.4398 ms median latency, 173.798 ms p95 latency, and an observed process RSS high-water sample of 933,232,640 bytes.

### External NLPCC 2025 Simplified Chinese validation

The harness streamed a deterministic balanced sample from `NLP2CT/NLPCC-2025-Task1@8496a447b432aac1801041d4b543cd6b863c4c56` (`test_with_label.json`; reviewed Git blob `44655ebbf8050c0ff6f6f7a9c153488d9000651a`). Its streamed SHA-256 was `d39a0b2b9fa61086dd92052671bff9c44716c5cd499972a1de80e5ec694abad8`. It selected 10 AI and 10 human records from each of eight documented scenarios, for 160 records total. The domain is creative writing and the AI records were generated by DeepSeek-V3.

| Profile                       |  TP |  TN |  FP |  FN | Abstentions | Coverage | Selective accuracy |
| ----------------------------- | --: | --: | --: | --: | ----------: | -------: | -----------------: |
| Legacy pre-length-band policy |  48 |  66 |   0 |   5 |          41 |  74.375% |             95.80% |
| Final v8/v3 policy            |  48 |  40 |   0 |   0 |          72 |    55.0% |               100% |

The final profile's length-weighted 35th-percentile AI-evidence ranking statistic produced AUROC `0.971875` and average precision `0.972747`. Historical reports also calculated Brier score `0.106898` and expected calibration error `0.114661`, but those two values are withdrawn as probability-calibration evidence because a document percentile is not a calibrated probability. Production harness schema 8 now returns those fields as `null`.

| Final-policy scenario | AI true positives / 10 | Human false positives / 10 | Note                     |
| --------------------- | ---------------------: | -------------------------: | ------------------------ |
| Normal                |                      9 |                          0 | —                        |
| Mixed attack          |                      4 |                          0 | —                        |
| Paraphrase attack     |                      6 |                          0 | —                        |
| Perturbation attack   |                      4 |                          0 | —                        |
| Length 64             |                      0 |                          0 | All 20 records abstained |
| Length 128            |                      7 |                          0 | —                        |
| Length 256            |                      9 |                          0 | —                        |
| Length 512            |                      9 |                          0 | —                        |

Because the NLPCC set was used to reject an aggressive Chinese candidate, it is safety/validation evidence rather than an untouched final test. The final rerun took 26,774.5844 ms total, with 105.7009 ms median latency, 424.2804 ms p95 latency, and an observed process RSS high-water sample of 771,649,536 bytes on the same Windows machine.

### Post-freeze NLPCC 2026 AI-refined text audit

After the final v8/v3 policy was frozen, the harness audited the official NLPCC 2026 Task 6 Phase 2 fully labeled data, whose classes are human-written text (HWT, label 0), LLM-generated text (LGT, label 1), and LLM-refined text (HLT, label 2). No threshold was changed after this audit.

The source was repository commit `297c0dd504be7fedfbaa297f1c5ec5fd1b837fdb`, file `data/testp2_testing_label.json`, with reviewed Git blob `7a02fd5271a4e05ed92642bc134547fdd581549d`. The streamed 30-record fixture SHA-256 was `fe0488134c8d24af9aee012fe251a9844a30b102fbd2384192e47f1c6533a44f`.

Selection was deterministic and independent of detector output: 10 records per official class were selected only when they contained at least 120 Han characters and at least as many Han as Latin characters. This transparently excluded the pure-English HLT noise acknowledged by the official dataset. Source text was streamed without persistence. The source terms declare no SPDX license, so this is internal audit evidence rather than redistribution or general commercial-validation evidence.

The binary metrics below use only HWT and LGT, where the official labels map to the detector's binary evaluation:

|  TP |  TN |  FP |  FN | Abstentions | Coverage | Selective accuracy |
| --: | --: | --: | --: | ----------: | -------: | -----------------: |
|   9 |   9 |   0 |   0 |           2 |      90% |               100% |

The length-weighted 35th-percentile evidence ranking statistic produced AUROC `1.0` and average precision approximately `1.0`. Historical reports also calculated Brier score `0.0104606` and expected calibration error `0.0364363`, but those two values are withdrawn as probability-calibration evidence because a document percentile is not a calibrated probability. Production harness schema 8 now returns those fields as `null`.

HLT was audited as a separate outcome distribution rather than forced into binary correct/incorrect labels:

| Official HLT records | Likely AI | Likely human | Inconclusive |
| -------------------: | --------: | -----------: | -----------: |
|                   10 |         0 |            5 |            5 |

The run took 13,143.7682 ms total, with 425.4077 ms median latency, 804.6468 ms p95 latency, and an observed process RSS high-water sample of 748,384,256 bytes.

This small post-freeze audit cannot establish general performance. It shows that, for these 10 Chinese HLT records, the current Chinese model found no sufficiently strong AI-like signal and treated 5 as human-like. DJL therefore cannot claim that it detects AI-refined writing or determines authorship. No license-safe external English HLT dataset has yet been evaluated.

### TXD-22 English challenger-policy evaluation

Later on 2026-07-25, the English model was evaluated with a fixed three-outcome challenger policy: scores at or below `0.015` were likely human; scores at or above `0.9851` were likely AI only when the record had at least 600 eligible characters; every other result was inconclusive. Development, validation, a fresh HC3 partition, and the originally locked TXD-22 partition were opened in that order. AI-refined records were kept outside the binary confusion counts. A command-history audit confirmed that both TXD continuous-score reports came from production-harness schema 6/7, where the score was the document's length-weighted 35th-percentile region statistic. They did not come from the Python evaluator's direct softmax probabilities. AUROC, average precision, and fixed-threshold counts remain ranking evidence. The historical Brier and calibration-error calculations were semantically invalid and are withdrawn.

These historical TXD-22 fixtures used the v1 trimmed-question hash. A later NFKC, case-fold, and whitespace-normalization audit found three canonical prompt clusters crossing their declared roles. Of the 550 groups that would have occupied v2 buckets 8–9, 277 (`50.4%`) had already appeared in the old runs: 105 in old development, 71 in old validation, and 101 in the old partition labeled locked. The following results are therefore observed validation and rejection evidence, not a clean generalization estimate. The corrected sampler exposes TXD-22 development and validation only.

The 600-record TXD-22 development fixture had SHA-256 `e62480920afc8b9f4855652662f75e666cce3d53d899082270ab3836333e46f8`. On its 400-record human/pure-AI subset, the document ranking statistic produced AUROC `0.9176` and average precision `0.93176`. Historical schema 6 also emitted Brier `0.14169` and expected calibration error `0.12497`; those two values are retained only to reproduce the old report and are invalid/withdrawn because the percentile statistic had no probability semantics.

| Partition and fixed policy                                           |  TP |  TN |  FP |  FN | Abstentions | Coverage | Selective accuracy |
| -------------------------------------------------------------------- | --: | --: | --: | --: | ----------: | -------: | -----------------: |
| TXD-22 development; `0.015` / `0.9851`, minimum 600 characters       |  72 |  26 |   0 |   2 |         300 |    25.0% |              98.0% |
| TXD-22 validation; `0.015` / `0.9851`, minimum 600 characters        |  72 |  37 |   0 |   0 |         291 |   27.25% |               100% |
| HC3 English offset 500; `0.015` / `0.9851`, minimum 600 characters   |   5 |   0 |   0 |   0 |          95 |     5.0% |               100% |
| TXD-22 originally locked; `0.015` / `0.9851`, minimum 600 characters | 136 |  42 |   1 |   0 |         621 |  22.375% |            99.441% |

The TXD-22 validation fixture contained 600 records and had SHA-256 `f41d7c3daa12b4baf5b963244268b9214b9bea5f3a3a8a914c770617ecffe2e8`. The fresh HC3 offset-500 check contained 50 English human and 50 English ChatGPT answers; all 50 human answers abstained, while 5 of 50 AI answers were detected.

The originally locked TXD-22 fixture contained 1,200 records and had SHA-256 `11be75ab67e33025c9f6ed1e8404adba688887880d0dacc5e6a99eb14031368a`. Its binary subset contained 400 human and 400 pure-AI records. The single false positive gave an observed false-positive rate of `0.25%` with a row-level Wilson 95% interval of `0.0441%–1.4023%`; true-positive rate was `34%` with a row-level Wilson 95% interval of `29.53%–38.77%`. The document ranking statistic produced AUROC `0.922075` and average precision `0.935463`. Historical schema 7 also emitted Brier `0.131197` and expected calibration error `0.105026`; those two values are invalid/withdrawn because they were computed from the 35th-percentile ranking statistic, not a probability. The run took 94.49 seconds, with 79.1 ms median latency, 116.96 ms p95 latency, and 615 MB peak RSS.

The 400 AI-refined records in that fixture are reported only as a three-outcome distribution, not as binary accuracy:

| AI-refined records | Likely AI | Likely human | Inconclusive |
| -----------------: | --------: | -----------: | -----------: |
|                400 |        21 |           14 |          365 |

Although the locked binary subset had `99.441%` selective accuracy, the Wilson upper bound exceeded the predeclared `1%` false-positive target. The evidence therefore did not support an FPR-at-most-1% claim. The challenger policy was rejected, no threshold was tuned on the observed partition, and production English calibration `djl-en-conservative-length-bands-v8` was retained. Because this TXD-22 partition has now been opened, it is validation evidence and cannot be called untouched in a future model comparison.

### 2026-07-26 scratch-hashing frozen experiment

A deliberately small English baseline was trained from scratch to test whether a fully local model could avoid the unresolved provenance of a downloaded detector. It used no pretrained weights and did not include TXD questions as features. Word 1–2-grams and character 3–5-grams fed 393,216 hashing dimensions, a linear classifier, and a logistic probability calibrator with seed `1729`. The 3,200-record v1 TXD-22 development input was separated by question-group hash into 1,928 training records, 345 calibration records, and 927 operating-point records. Training and calibration took 4.636 seconds.

The operating partition selected and froze threshold `0.8574159185656395`. The artifact was 1,187,434 bytes with SHA-256 `4352c2fe965647b77ccd65a93290e3042b13891ef3a0e625f43b29df4ffc6484`. TXD-22 has no human author identifiers, so every Wilson interval below is a row-level description rather than author-independent inferential support; the development threshold constraint cannot itself establish the advertised population FPR.

| Binary evaluation         | Samples (human / AI) |  TP |  TN |  FP |  FN | FPR (Wilson 95% CI)      | TPR                       |      AUROC |         AP |      Brier |        ECE | AI-positive call rate |
| ------------------------- | -------------------: | --: | --: | --: | --: | ------------------------ | ------------------------- | ---------: | ---------: | ---------: | ---------: | --------------------: |
| TXD development operating |      927 (457 / 470) | 409 | 457 |   0 |  61 | 0% (`0%–0.8336%`)        | 87.0213%                  | `0.992867` | `0.994172` | `0.030895` | `0.016535` |                44.12% |
| TXD validation            |    1,200 (600 / 600) | 525 | 597 |   3 |  75 | 0.5% (`0.1702%–1.4596%`) | 87.5% (`84.6128%–89.91%`) | `0.992258` | `0.993247` | `0.031360` | `0.011911` |                 44.0% |
| HC3 English offset 600    |        100 (50 / 50) |  11 |  42 |   8 |  39 | 16% (`8.3374%–28.5142%`) | 22% (`12.7539%–35.2415%`) |   `0.6016` | `0.569977` | `0.339617` | `0.302816` |                 19.0% |

This was a single-threshold binary experiment: it had no abstention state, so the final column is the fraction of all samples called AI, not three-outcome coverage or selective accuracy. The TXD validation fixture SHA-256 was `bce6bb367a6f86a0855c42235bbea082f2fbcb993976b8fc0f63fc5efac332c0`; its three false positives put the Wilson upper bound above the predeclared 1% FPR gate, so it failed. The HC3 fixture SHA-256 was `2b13e4993f17f4b93f9934f53f73e726fde0066c72a907212c077c758f0e775d`; 8 of 50 human answers were false positives while only 11 of 50 AI answers were detected, triggering the stop-loss.

TXD validation batch scoring took 1.704 seconds (1.420 ms per sample); single-sample mean was 2.123 ms, median was 2.076 ms, and p95 was 3.087 ms. HC3 batch scoring took 91.664 ms (0.917 ms per sample); single-sample mean was 1.588 ms, median was 1.516 ms, and p95 was 2.684 ms. The artifact and fixtures remained under the system temporary directory; the artifact was not added to the repository, production manifest, or release. No threshold was changed and production v8 remained in place. Because the inputs were generated with the flawed v1 TXD grouping, their favorable within-TXD metrics are not clean generalization evidence. The failures still justify rejection. HC3 offset 600 has now been observed and cannot be reused or described as untouched.

### Offline determinism check

The Windows 20-run offline verification re-hashed every installed model artifact, replaced `fetch` with a blocking function, and observed zero network attempts. English and Simplified Chinese each had a score spread of `0`, and the mixed-language check produced one unique displayed report across all 20 recomputations.

### Interpretation and remaining limitations

The measured improvement is in the reliability of results the system is willing to classify and in explicit abstention semantics, not in broad detector accuracy. On the then-untouched HC3 offset-400 locked set, final English recall was `0%`: the current English detector is not demonstrably useful at the selected false-positive safety threshold. Its `100%` selective accuracy covers only 14 human classifications and no detected AI samples. The later TXD-22 run does not change that conclusion: its more permissive English challenger detected 34% of pure-AI records but failed the predeclared false-positive confidence gate and was not shipped. The scratch model also failed both the TXD confidence gate and the HC3 transfer check and was stopped before integration.

Zero observed false positives among only 50 locked human examples per language does not establish zero population false-positive risk. HC3 is small, QA-domain-heavy, and may overlap detector training data. There is still no comparable out-of-domain English evaluation. The NLPCC audits are small, Chinese-only, and governed by source terms with no SPDX license, so they are not redistribution or general commercial-validation evidence.

AI Writing Check remains Beta and a probabilistic screening aid. These measurements must not be used as proof of authorship or as the sole evidence for academic, employment, disciplinary, legal, or other consequential action.

## Release-gate status

- Local runtime, pinned artifact, deterministic aggregation, cache, harness smoke, and the recorded conservative HC3 safety holdout: passed on the machine above.
- The 2026-07-25 then-untouched offset-400 Windows run and external Chinese robustness validation passed the recorded conservative no-observed-false-positive gate, but the locked set contained only 50 human examples per language.
- The later TXD-22 English challenger gate failed: 1 of 400 human records was a false positive and the Wilson 95% upper bound was `1.4023%`, above the predeclared `1%` target. Production v8 was retained.
- The scratch-hashing challenger failed: the frozen threshold exceeded the 1% FPR confidence gate on TXD validation and produced 8 false positives among 50 HC3 offset-600 human answers. Its temporary artifact was not shipped.
- Commercial provenance is not cleared for either current production model: English TMR inherits unresolved RAID source rights, while the Chinese model publishes no training-data inventory and only an Apache metadata declaration. Product/legal confirmation or replacement artifacts are required; see [`model-license-audit.md`](./model-license-audit.md).
- AI-refined and human-LLM collaborative detection capability: not passed. The post-freeze Chinese audit produced no likely-AI result for 10 HLT records, and no license-safe external English HLT audit is available.
- Larger representative external English/Chinese accuracy, native/non-native writing, additional domains and generators, edited/mixed authorship, cross-platform performance, confidence intervals, and independent false-positive review: not yet satisfied. English coverage is explicitly limited.
- Production accuracy claims, removal of Beta, and any claim that the current English detector is generally useful: blocked until those representative gates are documented and pass.
