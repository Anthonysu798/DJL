# DJL AI Writing Check Design

**Date:** 2026-07-15

**Status:** Approved for implementation
**Product brief:** `docs/DJL-AI-Detector.md`

## Outcome

Add a first-class **AI Writing Check** tool to DJL Work, directly below **New task**. It accepts pasted text, TXT, DOCX, and text-based PDF input in English and Simplified Chinese, evaluates eligible prose with locally installed language-specific classifiers, and returns an explainable document summary plus passage-level evidence. The product must consistently describe the output as an estimate, not proof of authorship.

## Product shape

The detector is a standalone Work route rather than a chat task. The initial screen contains a local-processing privacy badge, language selector, paste/file input, model state, and Analyze action. The results screen contains three integer percentages that always sum to 100% for eligible text, a confidence indicator, coverage/exclusion counts, passage highlights, model/calibration metadata, and local HTML/JSON export. A new analysis can be started without creating or mutating a DJL task.

The sidebar action is visible in Work immediately after **New task**. English and Simplified Chinese copy are product-quality. Every other existing DJL locale receives a complete localized catalog entry so locale switching and catalog-equality tests remain sound.

## Architecture decision

Use the existing local DJL server as the inference host and add a dedicated AI detector service. The web UI sends an authenticated, bounded request to a local-only HTTP endpoint and receives NDJSON progress events. Model lifecycle operations use the existing typed WebSocket RPC layer. No submitted text, filename, extracted document, or passage is sent to a third party or written to disk.

The detector uses `@huggingface/transformers` with ONNX Runtime Node. Inference is configured with `allowRemoteModels = false` and a DJL-owned model directory. A separate installer downloads a pinned manifest over HTTPS, validates an allowlisted host, byte limit, SHA-256 checksum, and final file layout, then atomically promotes the installation. The installer is the only detector path that accesses the network.

### Initial model set

| Language           | Runtime model                                                                                                                                                                | License    | Runtime artifact                     |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------ |
| English            | `onnx-community/tmr-ai-text-detector-ONNX` at `b9aa251e5bcda7e429fcc936767d921435945b60`                                                                                     | MIT        | quantized ONNX, approximately 126 MB |
| Simplified Chinese | `Eslzzyl/aigc-detector-zh-onnx` at `e6c77fd62955fac134e76deb5396806f6d35fd30`, converted from `yuchuantian/AIGC_detector_zhv3` at `47695ff451b32c225dd938f4f478f7fdc6aa6bb0` | Apache-2.0 | quantized ONNX, approximately 103 MB |

The English classifier exposes `human` and `ai` labels. The Chinese classifier exposes `[Human_Written, AI_Generated]`. Both are normalized by adapters to a single `aiProbability` value. Model files and tokenizer/config assets are pinned and checksum verified; model metadata and notices are exposed in the UI and documentation.

## Alternatives considered

1. **Native Node ONNX with verified model manifests — selected.** It fits DJL's existing Node/Electron distribution, avoids a Python installation and subprocess lifecycle, supports deterministic local inference, and keeps model download/install behavior explicit.
2. **Bundled Python worker — rejected.** It has a larger packaging and signing surface, more fragile startup/cancellation behavior, and redundant document/inference plumbing.
3. **Ollama, LM Studio, or another generic chat model — rejected.** Chat generation probabilities are not stable detector scores, generic LLMs do not meet the brief's classifier requirement, and a user-managed external runtime would weaken offline and reproducibility guarantees.

## Analysis pipeline

1. Accept UTF-8 text, TXT, DOCX, or text-based PDF within strict byte/character/page limits.
2. Reuse the server's bounded document parser. Reject encrypted, scanned/image-only, macro-enabled, nested-archive, zip-bomb, or malformed inputs with specific messages.
3. Normalize Unicode and line endings while preserving a normalized-to-original offset map.
4. Classify paragraphs as English, Simplified Chinese, mixed/ambiguous, or unsupported.
5. Mark quotations, code, tables, references, headings/metadata, list fragments, and unsupported-language spans as excluded.
6. Segment eligible prose into tokenizer-bounded passages with deterministic overlap and stable identifiers.
7. Lazily load only the required local model, run sequential inference, and check cancellation between passages.
8. Apply versioned conservative thresholds. Scores below the human threshold are **Likely human**, scores above the AI threshold are **Likely AI**, and the middle band is **Uncertain**.
9. Convert overlapping passage predictions into non-overlapping intervals, count each eligible character once, and use largest-remainder rounding so the three headline percentages sum to exactly 100.
10. Cache only a hash key and derived result metadata. Never cache document text, filenames, or raw extracted content.

## Calibration and honesty

The first release uses explicitly versioned conservative bands, not accuracy claims:

- English v1: likely human at `p(ai) <= 0.35`; likely AI at `p(ai) >= 0.75`.
- Simplified Chinese v1: likely human at `p(ai) <= 0.25`; likely AI at `p(ai) >= 0.80`.

The UI reports the exact model, model revision, preprocessing version, calibration version, eligible coverage, excluded coverage, and a confidence level derived from analyzable length, language routing certainty, model availability, and disagreement near thresholds. Mixed-language text is routed paragraph by paragraph. Unsupported spans are excluded rather than silently forced through the wrong model.

The result message always says that detector output is probabilistic and should not be used as sole evidence for academic, employment, disciplinary, legal, or authorship decisions.

## Privacy and security model

- Analysis happens on the loopback DJL server and never invokes a remote inference API.
- The endpoint uses the same authentication and trusted-origin protections as existing local HTTP routes.
- Request bodies, extracted content, and results are excluded from logs and analytics.
- Input and decompression limits are checked before expensive work.
- Model downloads are restricted to the manifest allowlist, bounded, checksum verified, and installed atomically.
- Cache entries contain only a content digest and derived interval/summary data; **Clear cache** removes them.
- Export is an explicit local save. Full analyzed text is omitted by default and included only after the user enables a clearly labeled option.

## Reliability and performance

Model initialization is lazy and single-flight. Only one detector model is resident during ordinary analysis; switching languages disposes the prior session where supported. Analysis is sequential by default to avoid CPU and memory spikes. Requests stream stage progress and remain cancellable. Corrupt or partial installs are never treated as ready. Cache keys include content hash, model artifact hashes, preprocessing version, segmentation version, and calibration version.

## Verification and release gates

Unit tests cover normalization/offsets, language routing, exclusions, token segmentation, calibration boundaries, aggregation/rounding, caching, manifests, checksum rejection, and cancellation. Integration tests cover each accepted file type, unsafe-file rejection, local-only runtime configuration, model state transitions, NDJSON progress, and cache clearing. Web tests cover English and Simplified Chinese flows, keyboard/focus behavior, model-not-installed and failure states, exports, and locale catalogs.

A reproducible benchmark harness records dataset provenance, license, hashes, platform, model artifacts, thresholds, confusion matrices, per-language metrics, abstention/uncertainty rates, throughput, and peak memory. A small repository smoke corpus validates the harness but is never presented as representative accuracy evidence. A production accuracy claim or removal of the Beta label requires a representative, independently reviewed, license-safe evaluation set and documented release thresholds.

## Explicit non-goals

- Proving authorship or misconduct.
- Detecting handwriting, OCR-only/scanned PDFs, images, audio, or arbitrary office formats.
- Training a new detector model inside DJL.
- Sending essays to a cloud API.
- Treating generic local chat models as official detector backends.
- Claiming a universal accuracy rate from a small or synthetic benchmark.
