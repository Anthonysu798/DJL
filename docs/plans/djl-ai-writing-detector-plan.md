# DJL AI Writing Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a private, local English and Simplified Chinese AI writing detector as a first-class DJL Work tool immediately below New task.

**Architecture:** A typed detector domain in `packages/contracts` connects the Work UI to a local Effect service. Model lifecycle methods use DJL's WebSocket RPC layer; document analysis uses a dedicated authenticated loopback HTTP endpoint that streams NDJSON progress and never persists or logs document content. The service reuses DJL's bounded document extraction, routes passages by language, runs pinned checksum-verified ONNX classifiers through `@huggingface/transformers`, applies versioned conservative calibration, aggregates unique eligible characters, and caches only content hashes plus derived results.

**Tech Stack:** TypeScript, Effect, React 19, TanStack Router, i18next, Vitest, Bun, `@huggingface/transformers`, ONNX Runtime Node, PDF.js, JSZip.

## Global Constraints

- Product name is **DJL**; legacy `@synara/*`, `.synara`, and `SYNARA_*` names remain compatibility identifiers only.
- The detector is an estimate and must never be described as proof of authorship or misconduct.
- Document text, filenames, extracted content, and passage text must never leave the local DJL process or enter logs, analytics, persistent caches, or model-download requests.
- Accepted inputs are paste, TXT, DOCX, and text-based PDF; encrypted, scanned/image-only, malformed, unsafe archive, macro-enabled, and over-limit inputs fail explicitly.
- Supported analysis languages are English and Simplified Chinese. Mixed documents are routed paragraph by paragraph; unsupported spans are excluded.
- Headline Likely AI, Uncertain, and Likely human percentages measure unique eligible characters and sum to exactly 100.
- Every model asset is revision-pinned, size-bounded, SHA-256 verified, license-documented, downloaded to a temporary path, and atomically promoted.
- Inference sets `env.allowRemoteModels = false`; only the explicit model installer can use the network.
- No paid API, Python sidecar, Ollama, LM Studio, or generic chat LLM is an official detector backend.
- The UI must be accessible by keyboard, preserve visible focus, and never rely on color alone.
- All new UI copy must use DJL i18n catalogs. English and Simplified Chinese are primary; every shipped locale must contain every added key.
- Do not run `bun test`; use `bun run test`.

---

## File map

### Contracts

- `packages/contracts/src/aiDetector.ts`: schemas and types for languages, models, progress, regions, reports, install/cache operations, and streamed analysis events.
- `packages/contracts/src/index.ts`: public export.
- `packages/contracts/src/ws.ts`: WebSocket method names and RPC schemas for model state/install/cancel/remove/cache clearing.
- `packages/contracts/src/ipc.ts`: `NativeApi.aiDetector` methods consumed by the web client.

### Server

- `apps/server/src/aiDetector/modelManifest.ts`: immutable model revisions, file URLs, sizes, hashes, licenses, label mapping, and calibration versions.
- `apps/server/src/aiDetector/modelManifest.test.ts`: manifest completeness and security invariants.
- `apps/server/src/aiDetector/textPipeline.ts`: normalization with offset mapping, paragraph/language routing, exclusions, passage segmentation, calibration, interval aggregation, and exact rounding.
- `apps/server/src/aiDetector/textPipeline.test.ts`: multilingual and adversarial unit fixtures.
- `apps/server/src/aiDetector/resultCache.ts`: hash-only bounded cache and explicit clearing.
- `apps/server/src/aiDetector/resultCache.test.ts`: no-content persistence and invalidation.
- `apps/server/src/aiDetector/modelInstaller.ts`: allowlisted HTTPS download, progress, cancellation, byte/hash checks, and atomic installation.
- `apps/server/src/aiDetector/modelInstaller.test.ts`: corrupt, partial, oversized, redirected, and canceled install cases.
- `apps/server/src/aiDetector/modelRuntime.ts`: lazy local-only Transformers.js adapters and inference cancellation boundaries.
- `apps/server/src/aiDetector/modelRuntime.test.ts`: fake-session determinism, label mapping, and offline configuration.
- `apps/server/src/aiDetector/AiDetectorManager.ts`: lifecycle orchestration and analysis progress stream.
- `apps/server/src/aiDetector/Services/AiDetectorService.ts`: Effect service contract.
- `apps/server/src/aiDetector/Layers/AiDetectorService.ts`: production layer.
- `apps/server/src/aiDetector/AiDetectorManager.test.ts`: service state and end-to-end fake-model analysis.
- `apps/server/src/work/documentExtraction.ts`: export a bounded in-memory TXT/DOCX/PDF extraction API and preserve existing normalization behavior.
- `apps/server/src/work/documentExtraction.test.ts`: detector-facing accepted and rejected document fixtures.
- `apps/server/src/http.ts`: authenticated loopback NDJSON analysis endpoint with body/type limits and no-content logging.
- `apps/server/src/wsRpc.ts`: model/cache RPC handlers.
- `apps/server/src/serverLayers.ts`: detector production layer.
- `apps/server/package.json` and `bun.lock`: pinned Transformers.js runtime dependency.

### Web

- `apps/web/src/components/work/aiDetectorClient.ts`: authenticated NDJSON request, event validation, AbortController cancellation, local report rendering, and safe export helpers.
- `apps/web/src/components/work/aiDetectorClient.test.ts`: split-frame parsing, error mapping, cancellation, and HTML escaping.
- `apps/web/src/components/work/AiWritingCheckView.tsx`: responsive input, progress, result, highlights, model manager, cache, export, and disclaimer UI.
- `apps/web/src/components/work/AiWritingCheckView.test.tsx`: English/Simplified Chinese rendering and primary states.
- `apps/web/src/routes/_chat.work.ai-writing-check.tsx`: route registration.
- `apps/web/src/components/Sidebar.tsx`: Work action directly below New task.
- `apps/web/src/i18n/locales/{en,zh-Hans,zh-Hant,ja,ko,es-419,fr}.json`: complete localized detector copy.
- `apps/web/src/i18n/workAutomationLocalization.test.tsx`: route/source/catalog coverage.
- `apps/web/src/routeTree.gen.ts`: generated route tree update.

### Documentation and benchmarking

- `docs/ai-detector/README.md`: user guide and limitations.
- `docs/ai-detector/architecture.md`: component and data flow.
- `docs/ai-detector/privacy-model.md`: local processing and retention.
- `docs/ai-detector/security-review.md`: threats and mitigations.
- `docs/ai-detector/model-licenses.md`: source revisions, artifact hashes, licenses, and notices.
- `docs/ai-detector/runtime-decision.md`: Node ONNX decision and rejected alternatives.
- `docs/ai-detector/benchmark-methodology.md`: reproducible dataset and metric protocol.
- `docs/ai-detector/benchmark-results.md`: measured smoke results, hardware, limitations, and release-gate status.
- `docs/ai-detector/troubleshooting.md`: install, extraction, performance, and offline failures.
- `docs/ai-detector/releasing-model-updates.md`: manifest/calibration update gates and rollback.
- `tools/ai_detector_benchmark/run.ts`: deterministic JSONL benchmark runner.
- `tools/ai_detector_benchmark/fixtures/smoke.jsonl`: small explicitly synthetic harness smoke corpus.
- `tools/ai_detector_benchmark/README.md`: invocation and output schema.

---

### Task 1: Establish typed detector contracts

**Interfaces:**

- Produces `AiDetectorLanguagePreference`, `AiDetectorModelState`, `AiDetectorReport`, `AiDetectorRegion`, `AiDetectorAnalysisEvent`, `AiDetectorGetStateResult`, and model/cache mutation inputs/results.
- Produces `NativeApi.aiDetector.getState()`, `installModel(input)`, `cancelInstall(input)`, `removeModel(input)`, and `clearCache()`.

- [ ] **Step 1: Write failing schema tests** asserting invalid percentages, unknown labels, negative offsets, and malformed progress events are rejected while a complete bilingual report decodes.
- [ ] **Step 2: Run `bun run --cwd packages/contracts test`** and confirm the new import/type failures occur.
- [ ] **Step 3: Add exact schemas** using `Schema.Literal`, bounded `Schema.Number`, immutable arrays, and discriminated event types:

```ts
export const AiDetectorRegion = Schema.Struct({
  start: Schema.NonNegativeInt,
  end: Schema.NonNegativeInt,
  label: Schema.Literal("likely-ai", "uncertain", "likely-human", "excluded"),
  language: Schema.Literal("en", "zh-Hans", "unsupported"),
  score: Schema.optional(Schema.Number.pipe(Schema.between(0, 1))),
  reason: Schema.optional(Schema.String),
});

export const AiDetectorAnalysisEvent = Schema.Union(
  Schema.Struct({
    type: Schema.Literal("progress"),
    stage: AiDetectorStage,
    completed: Schema.NonNegativeInt,
    total: Schema.NonNegativeInt,
  }),
  Schema.Struct({ type: Schema.Literal("result"), report: AiDetectorReport }),
  Schema.Struct({
    type: Schema.Literal("error"),
    code: AiDetectorErrorCode,
    message: Schema.String,
  }),
);
```

- [ ] **Step 4: Wire RPC method constants and `NativeApi` types** without adding raw text to any RPC input.
- [ ] **Step 5: Rerun the contracts tests** and expect PASS.

### Task 2: Lock verified model manifests and the Node ONNX runtime

**Interfaces:**

- Produces `AI_DETECTOR_MODELS`, `getModelManifest(language)`, `verifyManifestFile(path, file)`, `loadDetector(language)`, and `disposeDetector()`.
- A loaded detector exposes `countTokens(text): Promise<number>` and `score(text, signal): Promise<number>`.

- [ ] **Step 1: Add manifest tests** requiring an exact 40-character revision or 64-character SHA-256, HTTPS Hugging Face URLs, nonzero byte limits, recognized licenses, unique paths, and explicit human/AI label indices.
- [ ] **Step 2: Add `@huggingface/transformers@4.2.0`** to `apps/server/package.json` and regenerate `bun.lock` with `bun install`.
- [ ] **Step 3: Populate immutable manifests** for the pinned English and Chinese quantized ONNX artifacts plus tokenizer/config files, using measured byte sizes and hashes.
- [ ] **Step 4: Implement lazy adapters** with:

```ts
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = modelRoot;
env.cacheDir = runtimeCacheRoot;
const classifier = await pipeline("text-classification", installedModelPath, {
  device: "cpu",
  dtype: "q8",
});
```

- [ ] **Step 5: Normalize labels** so both adapters return `aiProbability`, reject non-finite/out-of-range output, serialize initialization, and release the previous language session on model switch.
- [ ] **Step 6: Test with fake pipelines** that repeat output is identical, remote loading is disabled, Chinese label index 1 maps to AI, and English `ai` maps to AI.

### Task 3: Implement secure model installation and state

**Interfaces:**

- Produces `installModel(language, onProgress, signal)`, `removeModel(language)`, `inspectModels()`, and structured install errors.
- Consumes `AI_DETECTOR_MODELS` from Task 2.

- [ ] **Step 1: Write installer tests** with an in-process HTTP fixture for correct, corrupt, too-large, canceled, and untrusted-redirect downloads.
- [ ] **Step 2: Implement the installer** using a unique `.partial-*` directory, `createHash("sha256")`, streamed byte accounting, `fsync`, and same-volume `rename`.
- [ ] **Step 3: Reject every URL** whose protocol is not HTTPS or final hostname is outside the manifest allowlist; cap redirect count and require every redirect target to pass the same check.
- [ ] **Step 4: Write `install.json` last** with manifest version, revisions, file hashes, installed timestamp, and runtime version. Treat missing/mismatched metadata as corrupt.
- [ ] **Step 5: Implement remove and cancel** so active inference is disposed before deletion and partial directories are cleaned on startup.
- [ ] **Step 6: Run focused installer tests** and expect all security cases PASS.

### Task 4: Build the deterministic text pipeline

**Interfaces:**

- Produces `normalizeWithOffsets`, `classifyParagraphLanguage`, `markEligibleProse`, `segmentPassages`, `calibrateScore`, and `aggregateReport`.
- `aggregateReport` consumes normalized text, excluded spans, passages, and scores and returns a report whose eligible intervals never overlap.

- [ ] **Step 1: Write failing unit fixtures** for CRLF/NFKC offsets, English, Simplified Chinese, mixed paragraphs, quotes, fenced/indented code, Markdown tables, bibliography/reference blocks, headings, short list fragments, emojis, and unsupported scripts.
- [ ] **Step 2: Implement normalization** with a monotonic boundary map from every normalized offset back to the source offset; never search/replace without updating the map.
- [ ] **Step 3: Implement paragraph routing** from Unicode script counts and Latin word evidence. Auto mode selects a model per eligible paragraph; explicit language mode still excludes paragraphs that clearly belong to the other language.
- [ ] **Step 4: Implement deterministic exclusions** with a reason code for every excluded interval and merge adjacent intervals with the same reason.
- [ ] **Step 5: Segment by tokenizer count** with stable maximums, sentence/paragraph preference, and deterministic overlap; each passage carries normalized/source offsets, language, and stable ID.
- [ ] **Step 6: Implement calibration boundaries** exactly as English `<=0.35` human, `>=0.75` AI and Chinese `<=0.25` human, `>=0.80` AI, with the inclusive middle assigned uncertain.
- [ ] **Step 7: Aggregate atomic intervals** by all passage boundaries, average only models valid for that interval/language, count unique eligible characters once, and apply largest-remainder rounding:

```ts
const floors = raw.map(Math.floor);
let remainder = 100 - floors.reduce((sum, value) => sum + value, 0);
for (const index of rankedFractionalRemainders(raw)) {
  if (remainder-- === 0) break;
  floors[index] += 1;
}
```

- [ ] **Step 8: Add confidence and document assessment** based on eligible length, supported-language share, uncertainty share, and score margins; never use confidence wording that implies certainty.
- [ ] **Step 9: Run the focused pipeline test** and verify offsets, no overlaps, deterministic ordering, and exact 100 totals.

### Task 5: Reuse bounded document extraction

**Interfaces:**

- Produces `extractDocumentBytes({ bytes, mediaType, filename }): Promise<ExtractedDocument>` with `{ text, kind, pageCount?, warnings }`.
- Consumes existing ZIP/PDF safety logic; preserves `normalizeDocument` behavior.

- [ ] **Step 1: Add in-memory TXT, DOCX, and generated text-PDF fixtures** plus encrypted/scanned PDF, macro extension, nested archive, path traversal, decompression-ratio, page-count, and character-limit failures.
- [ ] **Step 2: Extract the current private parser** into the public bounded API rather than cloning ZIP or PDF logic.
- [ ] **Step 3: Require content signatures and safe extensions**; do not trust media type or filename alone.
- [ ] **Step 4: Reject image-only PDFs** when no meaningful text is extracted and identify the error as OCR unsupported.
- [ ] **Step 5: Update `normalizeDocument`** to call the shared API and rerun existing work document tests plus the detector fixtures.

### Task 6: Add hash-only caching and detector orchestration

**Interfaces:**

- Produces `AiDetectorManager.getState`, `installModel`, `cancelInstall`, `removeModel`, `clearCache`, and `analyze({ bytes, mediaType, filename, language, signal, emit })`.
- Cache key is SHA-256 of normalized content plus model hashes and pipeline/calibration versions; cached value omits text and filenames.

- [ ] **Step 1: Write cache tests** that inspect the serialized cache and assert sample text/filename substrings are absent; test version invalidation, bounded eviction, corrupt-cache recovery, and clear.
- [ ] **Step 2: Implement an atomic JSON cache** with a fixed entry/byte cap, stable schema version, and `0600` permissions where supported.
- [ ] **Step 3: Write manager tests** covering missing models, single-flight install, cancel, one-model-at-a-time runtime, cache hit, bilingual routing, short-text abstention, and cancellation between passages.
- [ ] **Step 4: Implement manager analysis stages** `extracting`, `normalizing`, `routing`, `scoring`, `aggregating`, and `complete`; emit real completed/total passage counts.
- [ ] **Step 5: Keep raw content request-scoped** and attach it only to the returned report needed for highlights. Strip it before cache persistence.
- [ ] **Step 6: Run manager/cache tests** twice and confirm byte-identical derived output for the same fake-model inputs.

### Task 7: Expose authenticated local API and model RPCs

**Interfaces:**

- Produces `POST /api/ai-detector/analyze` accepting raw TXT/DOCX/PDF or UTF-8 text plus `x-djl-ai-detector-language` and optional percent-encoded filename.
- Returns `application/x-ndjson`; each line validates as `AiDetectorAnalysisEvent`.

- [ ] **Step 1: Add HTTP integration tests** for missing/invalid auth, untrusted origin, unsupported content type, oversized content length, split progress stream, cancellation, and a successful fake-manager result.
- [ ] **Step 2: Register `AiDetectorServiceLive`** in `serverLayers.ts` and yield it in `wsRpc.ts`.
- [ ] **Step 3: Add typed WS handlers** for state/install/cancel/remove/clear cache and project install progress through the detector's event stream.
- [ ] **Step 4: Implement the HTTP route** with the existing auth/origin policy, bounded `arrayBuffer` reading, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, and no body/result logging.
- [ ] **Step 5: Stream NDJSON** from a bounded queue, abort analysis on client disconnect, write exactly one terminal result/error event, and close the stream.
- [ ] **Step 6: Run focused RPC/HTTP tests** and confirm no raw sample text appears in captured logs.

### Task 8: Implement the Work route and client

**Interfaces:**

- Produces `analyzeDocument(request, onEvent, signal)`, `renderAiDetectorHtmlReport(report, options)`, and the standalone `AiWritingCheckView` route.
- Consumes `NativeApi.aiDetector` for model/cache actions and local HTTP for analysis only.

- [ ] **Step 1: Write client tests** for CRLF/split NDJSON frames, final unterminated line, invalid event, HTTP error, abort, and HTML escaping of `<script>` in report text.
- [ ] **Step 2: Implement the client** using authenticated same-origin fetch, `ReadableStreamDefaultReader`, incremental `TextDecoder`, shared contract decoding, and AbortController.
- [ ] **Step 3: Write component tests** for empty, model-not-installed, installing, ready, analyzing, canceled, failed, insufficient-text, and result states in English and Simplified Chinese.
- [ ] **Step 4: Implement the input view** with privacy badge, language select, textarea, TXT/DOCX/PDF picker, file/type/size display, model cards, install progress, and Analyze disabled until valid.
- [ ] **Step 5: Implement the results view** with 3 exact percentages, confidence, eligible/excluded coverage, model/calibration facts, text highlights, label+pattern legend, disclaimer, export, clear cache, and New check.
- [ ] **Step 6: Implement safe local export** through `dialogs.saveFile`: JSON and standalone HTML, analyzed text omitted by default, explicit inclusion checkbox, and escaped content.
- [ ] **Step 7: Preserve focus** by moving it to the first error, the result heading after completion, or the input heading after New check; expose progress with polite live regions.
- [ ] **Step 8: Add the TanStack route** and regenerate `routeTree.gen.ts` via the normal web build/generator.
- [ ] **Step 9: Add the Sidebar action** immediately after New task and navigate to `/work/ai-writing-check` without creating a thread.

### Task 9: Complete localization and source audits

**Interfaces:**

- Produces a `work.aiDetector` namespace with identical leaf keys in all seven catalogs.

- [ ] **Step 1: Add all English copy** for navigation, input, file validation, model lifecycle, stages, results, regions, coverage, confidence, export, privacy, disclaimers, and errors.
- [ ] **Step 2: Add native Simplified Chinese copy** using `AI 写作检测`, `疑似 AI`, `不确定`, `疑似人工`, and clear non-accusatory privacy/disclaimer language.
- [ ] **Step 3: Translate every leaf** into Traditional Chinese, Japanese, Korean, Latin American Spanish, and French; do not copy English leaves into secondary catalogs.
- [ ] **Step 4: Extend source-audit tests** so the detector Work route cannot introduce hardcoded visible English and so catalog leaf equality remains enforced.
- [ ] **Step 5: Run the i18n tests** and expect every locale/catalog audit PASS.

### Task 10: Add reproducible benchmarking and product documentation

**Interfaces:**

- Benchmark input is JSONL `{ id, language, label, text, provenance, license }`.
- Benchmark output includes run timestamp, git revision, OS/CPU/memory, model/runtime artifacts, dataset hash/counts, confusion matrix, precision/recall/F1 by language/class, uncertainty rate, throughput, latency percentiles, peak RSS, failures, and configuration.

- [ ] **Step 1: Add the benchmark harness** that invokes the same pipeline/model adapters as production and rejects fixtures without provenance/license fields.
- [ ] **Step 2: Add a tiny synthetic smoke fixture** created for DJL and clearly mark it unsuitable for accuracy claims.
- [ ] **Step 3: Run the smoke benchmark** on the pinned installed models and save the measured JSON plus a human-readable summary in `benchmark-results.md`.
- [ ] **Step 4: Document architecture, privacy, security, runtime choice, model notices/licenses/hashes, benchmark methodology/results, troubleshooting, and model-update release steps** in the files listed above.
- [ ] **Step 5: State unresolved limitations**: short text, edited/paraphrased AI, domain shift, non-native English, mixed authorship, Chinese regional/domain variation, and the absence of a representative independent release benchmark.

### Task 11: Verification and packaging gate

**Interfaces:** None; this task validates the complete product.

- [ ] **Step 1: Run focused detector tests** with `bun run test -- <detector test filters>` where supported and fix all detector failures.
- [ ] **Step 2: Run the complete test suite once** with `bun run test`; expected exit code 0.
- [ ] **Step 3: Run the heavyweight workspace checks once as a final bundle:**

```bash
bun fmt
bun lint
bun typecheck
```

Expected: all commands exit 0. Do not repeatedly rerun the full trio for small corrections; use the smallest affected check until the final confirmation.

- [ ] **Step 4: Run `bun run build`** and expect all packages to build.
- [ ] **Step 5: Dry-run an isolated app instance** with the repository's documented non-default ports/home directory and verify the browser connects to that server, not an existing desktop instance.
- [ ] **Step 6: Manually exercise** paste/TXT/DOCX/PDF, English/Chinese/mixed/unsupported text, install/cancel/retry/remove, analyze/cancel/retry/cache hit/clear, exports with and without text, offline analysis, and restart persistence.
- [ ] **Step 7: Build the host-platform desktop artifact** with `bun run dist:desktop:artifact` and verify the app launches, model installation writes only to the user state directory, analysis works offline after installation, and no model/document is bundled into app resources unexpectedly.
- [ ] **Step 8: Review `git diff --check`, `git status --short`, and the final diff** to ensure no generated model, benchmark cache, user document, credential, unrelated change, or temporary artifact is included.

## Self-review record

- **Spec coverage:** The tasks cover Work navigation, English/Simplified Chinese UI, all four inputs, deterministic preprocessing, separate local models, pinned and verified delivery, local-only inference, cancellation/progress, aggregation/coverage, report/export, cache control, privacy/security, benchmark harness/results, docs, tests, build, and packaging.
- **Known release gate:** The repository smoke corpus proves harness wiring only. Product copy remains Beta and makes no accuracy percentage claim until representative, license-safe English and Chinese benchmark datasets pass an independently reviewed release threshold.
- **Placeholder scan:** No implementation step delegates unspecified error handling or testing. Every boundary has named files, interfaces, failure cases, and verification commands.
- **Type consistency:** Model/cache state uses WS RPC; raw document analysis uses NDJSON HTTP; `AiDetectorReport` is the shared result type throughout; the cache strips raw text while the request-scoped report may carry it for highlights and optional export.
