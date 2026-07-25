You are a principal machine-learning engineer and product-quality reviewer working inside the existing DJL codebase.

Your task is to design, implement, test, package, and document a production-ready local AI Writing Detector for English and Simplified Chinese.

Do not stop after producing UI mockups, placeholder services, architecture notes, or partial prototypes. Inspect the repository, create a concrete implementation plan, then implement the complete vertical slice end to end. Make reasonable decisions from the existing codebase and avoid asking questions unless a genuine blocker makes implementation impossible.

======================================================================

1. # PRODUCT GOAL

Add a new DJL feature called:

English:
DJL AI Writing Check

Simplified Chinese:
DJL AI 写作检测

The feature allows users to:

1. Paste text directly.
2. Upload TXT files.
3. Upload DOCX files.
4. Upload text-based PDF files.
5. Detect English text.
6. Detect Simplified Chinese text.
7. Detect mixed English-Chinese documents.
8. View passage-level detection results.
9. View a stable document-level AI-writing coverage report.
10. Export a private local report.
11. Run the entire analysis locally without uploading the essay.
12. Repeat the same scan and receive the same result when the model and detector version have not changed.

This must not depend on any paid API, hosted AI-detection service, OpenAI API, Anthropic API, GPTZero, Pangram, Turnitin, or any other remote inference provider.

Do not train a detection model from scratch.

Use existing open-source pretrained text-classification models and package them behind a replaceable detector interface.

The system must clearly state that detection results are probabilistic signals and are not proof of authorship, cheating, or academic misconduct.

# ====================================================================== 2. NON-NEGOTIABLE PRODUCT BOUNDARIES

Do not implement:

- “Make this undetectable.”
- “Humanize this text.”
- Automatic rewriting designed to lower an AI-detection score.
- Claims that DJL reproduces Turnitin results.
- Claims that the displayed percentage proves AI usage.
- A server that stores essays.
- Cloud-based document analysis.
- Essay content in analytics, telemetry, logs, crash reports, traces, or error reporting.
- A generic chat LLM generating the official detector percentage.
- Random or temperature-based scoring.
- A single document-wide classification without passage analysis.
- Fake accuracy statistics.
- Hard-coded claims such as “99% accurate” unless supported by a reproducible DJL benchmark report.

The feature is for private writing-risk assessment and educational review, not detector evasion.

# ====================================================================== 3. FIRST ACTIONS: INSPECT BEFORE EDITING

Before changing code:

1. Inspect the complete repository structure.
2. Read all relevant AGENTS.md, CLAUDE.md, README, architecture, build, localization, testing, packaging, and security documentation.
3. Identify:
   - Existing desktop framework.
   - C++/Qt/QML boundaries.
   - Any web frontend embedded in the application.
   - Existing navigation and dropdown architecture.
   - Existing local AI runtime integrations.
   - Existing Ollama or LM Studio integrations.
   - Existing model downloader or model manager.
   - Existing document parsers.
   - Existing localization system.
   - Existing persistence and settings system.
   - Existing analytics and crash-reporting behavior.
   - Existing test infrastructure.
   - Existing release and packaging process.
4. Search for reusable components before creating new abstractions.
5. Preserve unrelated user changes in the working tree.
6. Do not rewrite the application architecture unnecessarily.

Create an implementation plan in:

docs/plans/djl-ai-writing-detector-plan.md

The plan must identify:

- Files to create.
- Files to modify.
- Architecture decisions.
- Model candidates.
- Runtime decision.
- Privacy controls.
- UI integration.
- Test strategy.
- Packaging implications.
- Known limitations.
- Release gates.

After writing the plan, continue implementing it. Do not stop merely to ask me to approve the plan unless an irreversible architectural decision is genuinely blocked.

# ====================================================================== 4. DETECTION ARCHITECTURE

Implement a modular architecture with explicit boundaries.

The final naming may follow existing repository conventions, but the logical components should include:

A. DocumentInputService

- Accept pasted text and supported files.
- Enforce file-size and content limits.
- Return extracted text and document metadata.
- Never persist essay content unless the user explicitly exports a report.

B. DocumentTextExtractor

- TXT extraction.
- DOCX extraction.
- Text-based PDF extraction.
- Detect scanned or image-only PDFs and return a clear unsupported/OCR-required message.
- Do not add OCR in the initial production scope unless the repository already has a secure local OCR system.

C. TextNormalizer

- Normalize line endings.
- Normalize Unicode safely.
- Remove zero-width and control characters that are not meaningful writing content.
- Preserve offsets between normalized text and original text.
- Do not rewrite grammar, wording, punctuation, or sentence structure.
- Detect and mark headings, references, quotations, code blocks, tables, and metadata.

D. EligibleProseFilter
Exclude or separately classify content that should not materially affect the detector score:

- Bibliographies.
- Reference lists.
- Works cited sections.
- Long direct quotations.
- Page headers and footers.
- Page numbers.
- Tables.
- Code.
- Very short list items.
- Assignment instructions when identifiable.

Preserve excluded text in the document viewer but visually mark it as “not analyzed.”

E. LanguageRouter

- Detect language at passage or paragraph level, not only at document level.
- Support:
  - English.
  - Simplified Chinese.
  - Mixed English and Chinese.
- Route English passages to the English detector.
- Route Chinese passages to the Chinese detector.
- Return unsupported or low-confidence language states clearly.
- Do not translate content before detection.
- Preserve original-language offsets.

F. PassageSegmenter

- Split text on sentence and paragraph boundaries.
- Use tokenizer-aware maximum sequence lengths for each detector.
- Avoid cutting sentences unless required.
- Add configurable overlap between adjacent passages.
- Maintain exact original-character offsets.
- Avoid counting overlapping text twice in the document score.
- Handle documents containing only a small amount of eligible prose.

G. DetectorModelAdapter
Create a stable interface that does not expose Hugging Face, PyTorch, ONNX, or model-specific details to the UI.

Example conceptual interface:

interface DetectorModelAdapter {
ModelMetadata metadata() const;
bool supportsLanguage(Language language) const;
DetectionOutput analyze(const DetectionInput& input);
HealthStatus healthCheck() const;
}

DetectionInput should contain:

- Normalized text.
- Original start and end offsets.
- Language.
- Passage ID.
- Token count.
- Detector configuration version.

DetectionOutput should contain:

- Raw logits.
- Calibrated AI score.
- Classification.
- Confidence band.
- Model ID.
- Model version.
- Model hash.
- Processing duration.
- Error state when applicable.

H. ScoreCalibrator

- Do not expose raw logits directly.
- Apply model-specific calibration.
- Store calibration version separately from model version.
- Make thresholds configurable through signed/versioned model metadata.
- Support separate English and Chinese thresholds.
- Use conservative uncertainty ranges.
- Never silently substitute arbitrary default scores if inference fails.

I. ResultAggregator

- Merge overlapping passage results into non-overlapping document regions.
- Calculate coverage using unique eligible character or token ranges.
- Do not average unrelated model percentages.
- Return:
  - Likely AI coverage.
  - Uncertain coverage.
  - Likely human coverage.
  - Excluded/not-analyzed coverage.
  - Analyzed word or character count.
  - Document confidence.
  - Model disagreement state.
- Ensure percentages sum correctly after rounding.
- Avoid double-counting overlaps.

J. PrivacySafeResultCache

- Use SHA-256 over:
  - Normalized document text.
  - Model hash.
  - Calibration version.
  - Preprocessing version.
  - Segmentation version.
- Cache only when appropriate.
- Do not store the raw essay.
- Do not store extracted passages.
- Do not store user names, assignment titles, filenames, or document metadata unless strictly required and explicitly approved by the user.
- Provide a clear “Clear detector cache” setting.
- Cache must be local only.

K. ModelManager

- Download models on first use instead of silently shipping unknown artifacts.
- Show download size, progress, pause/cancel where practical, retry, and error messages.
- Verify SHA-256 before loading.
- Store:
  - Model ID.
  - Version/revision.
  - Hash.
  - License.
  - Source attribution.
  - Supported languages.
  - Expected tokenizer.
  - Calibration version.
- Refuse to load a corrupted or mismatched model.
- Support offline use after installation.
- Never execute arbitrary remote model code.
- Do not enable trust_remote_code unless the implementation has been manually audited and documented.
- Pin exact model revisions instead of following an unversioned latest branch.

# ====================================================================== 5. MODEL STRATEGY

Start with these model candidates, but verify every license, revision, model card, architecture, tokenizer, commercial-use condition, and dependency before production integration.

English candidate:

desklib/ai-text-detector-v1.01

Also evaluate whether the academic variant is preferable for long-form student essays.

Chinese candidate:

AnxForever/chinese-ai-detector-bert

Optional multilingual fallback candidate:

bibbbu/multilingual-ai-human-detector_xlm-roberta-base

Important rules:

1. Do not assume a model is production-safe merely because it is publicly downloadable.
2. Verify the model’s license separately from the repository code license.
3. Record license findings in:
   docs/ai-detector/model-licenses.md
4. If a candidate lacks a sufficiently clear license for DJL distribution, do not bundle or automatically redistribute it.
5. Select a compatible alternative or implement user-triggered model download where legally appropriate.
6. Do not use the multilingual fallback as the primary model without benchmarking it.
7. Do not combine raw model probabilities by averaging them.
8. The English and Chinese detectors require independent calibration.
9. A generic Ollama or LM Studio chat model must not calculate the official detector score.
10. Ollama or LM Studio may later provide an optional explanation of flagged passages, but:
    - It must be clearly labeled as an explanation.
    - It must not change the detector score.
    - It must be disabled when no local LLM is available.
    - It must not upload data.
    - This optional layer must not block the core release.

# ====================================================================== 6. RUNTIME DECISION

Inspect the current DJL architecture and choose the least fragile production approach.

Preferred production direction for a C++/Qt application:

- Export supported classifiers to ONNX.
- Run them locally with ONNX Runtime.
- Use the appropriate execution provider when available.
- Maintain a CPU fallback.
- Keep inference behind DetectorModelAdapter.

Acceptable first implementation when ONNX conversion is genuinely blocked:

- A packaged local Python detector worker.
- Communicate over localhost IPC or a child-process protocol.
- Bind only to loopback.
- Use a random per-session authentication token.
- Never expose the service to the LAN.
- Shut it down with DJL.
- Package the interpreter and dependencies; do not require users to install Python manually.
- Preserve the same DetectorModelAdapter so the worker can later be replaced with ONNX.

Do not call a remote inference endpoint.

Before choosing the runtime:

1. Attempt model loading in a minimal isolated test.
2. Validate tokenizer compatibility.
3. Validate ONNX export.
4. Compare PyTorch and ONNX output within an explicit tolerance.
5. Measure CPU memory, startup latency, and passage inference latency.
6. Document the decision in:
   docs/ai-detector/runtime-decision.md

# ====================================================================== 7. DETERMINISTIC INFERENCE

Repeated analysis must be stable.

Implement:

- Model evaluation mode.
- Dropout disabled.
- Fixed preprocessing.
- Fixed segmentation.
- Fixed tokenizer revision.
- Fixed model revision.
- Fixed calibration configuration.
- Stable aggregation.
- Deterministic CPU path where possible.
- No sampling.
- No temperature.
- No generative scoring.
- No random prompt execution.

Add an automated determinism test:

- Run the same English sample at least 20 times.
- Run the same Chinese sample at least 20 times.
- Run the same mixed-language sample at least 20 times.
- Assert identical classifications.
- Assert identical displayed coverage after rounding.
- Assert raw floating-point results remain within a documented tolerance when different execution providers are used.

The same document with the same detector version should return the same result.

When a model, tokenizer, calibration, preprocessing, or segmentation version changes, label the result as produced by a new detector version rather than pretending it is directly identical to the old result.

# ====================================================================== 8. RESULT SEMANTICS

Do not display a single raw model probability as:

“73% of this document was written by AI.”

Instead display document coverage.

English labels:

- Likely AI-written
- Uncertain
- Likely human-written
- Not analyzed

Chinese labels:

- 可能由 AI 生成
- 无法确定
- 可能由人类撰写
- 未参与检测

Primary report:

English:
AI-writing coverage
Uncertain coverage
Likely human coverage

Chinese:
AI 写作特征覆盖率
不确定覆盖率
可能为人类写作的覆盖率

Example:

AI-writing coverage: 34%
Uncertain coverage: 21%
Likely human coverage: 45%

Overall assessment:
Mixed / Inconclusive

Confidence:
Medium

Method:
Local classifier analysis

Document uploaded:
No

Document stored:
No

Calculate AI-writing coverage from unique eligible ranges classified above the high-confidence AI threshold.

Calculate uncertain coverage from unique eligible ranges between the lower and upper thresholds.

Do not force a confident classification when models disagree or evidence is insufficient.

Possible document-level results:

- Likely human-written.
- Mixed signals.
- Strong AI-writing signals.
- Inconclusive.
- Insufficient eligible text.
- Unsupported language.
- Analysis failed.

Show this disclaimer near the result:

English:
This analysis identifies statistical writing signals. It does not prove who wrote the document or whether academic misconduct occurred.

Chinese:
本检测只分析文本中的统计写作特征，不能证明文本由谁撰写，也不能作为学术不端的确定性证据。

# ====================================================================== 9. SIMPLE UI/UX

The detector interface must be easy and focused. It is not a project dashboard.

Integrate the feature into the existing DJL navigation using the application’s current patterns.

Use a simple layout:

Header:

- DJL AI Writing Check / DJL AI 写作检测
- Privacy status: “Runs locally” / “本地运行”
- Language selector:
  - Auto
  - English
  - 简体中文

Input area:

- Large text area.
- Paste text.
- Upload file.
- Clear.
- Character/word count.
- Analyze button.
- Supported file types.
- Minimum-text guidance.
- Model installation state.

While analyzing:

- Progress indicator.
- Current stage:
  - Extracting text.
  - Detecting language.
  - Analyzing passages.
  - Building report.
- Cancel button.

Results:

- Three simple percentage cards.
- Overall assessment.
- Confidence level.
- Analyzed content count.
- Local model/version.
- Highlighted document viewer.
- Legend for AI, uncertain, human, and excluded content.
- Clicking a result region scrolls to the corresponding passage.
- Export report.
- Start new check.

Do not add:

- Environment panels.
- Git panels.
- Project panels.
- Sources sidebars unrelated to the document.
- Dense developer controls.
- Chat bubbles unless they materially improve the existing DJL product consistency.
- Excessive animations.
- Fake real-time percentages while inference is incomplete.

Support keyboard navigation, screen-reader labels, high contrast, text scaling, and visible focus states.

Do not rely only on red and green. Include labels, icons, and patterns.

# ====================================================================== 10. ENGLISH AND CHINESE LOCALIZATION

Use the repository’s existing localization system.

If no localization system exists, implement a clean resource-based system rather than hard-coded conditionals.

Requirements:

- English locale.
- Simplified Chinese locale.
- Runtime language switching.
- No application restart unless the existing architecture requires it.
- Every detector-facing UI string must be localized.
- Every error message must be localized.
- Every privacy message must be localized.
- Every report label must be localized.
- Exported reports must use the selected UI language.
- English and Chinese text must render correctly in the application’s supported fonts.
- Avoid machine-translated terminology that is unnatural in Chinese.

Create or update:

- en-US localization resources.
- zh-CN localization resources.
- Localization key tests that ensure neither language is missing keys.

Use terminology consistently:

AI Writing Check → AI 写作检测
Likely AI-written → 可能由 AI 生成
Uncertain → 无法确定
Likely human-written → 可能由人类撰写
AI-writing coverage → AI 写作特征覆盖率
Runs locally → 本地运行
Your document never leaves this device → 您的文档不会离开此设备
Insufficient text → 文本内容不足
Analyze → 开始检测
Export report → 导出报告
Clear → 清除
New check → 新建检测

# ====================================================================== 11. PRIVACY AND SECURITY

The strongest product promise should be:

“Your document never leaves this device.”

Make this technically true.

Requirements:

- No essay upload.
- No remote inference.
- No request body logging.
- No passage logging.
- No filenames in telemetry.
- No extracted text in exceptions.
- No extracted text in crash reports.
- No extracted text in analytics.
- No essay content in debug builds unless a developer explicitly enables a local-only diagnostic mode.
- No temporary text files when in-memory processing is practical.
- Securely remove temporary extraction files after use.
- Disable report history by default.
- Reports save only when the user explicitly exports.
- Model downloads may access the network, but document processing must not.
- Clearly separate model-download traffic from document analysis.
- Add a test proving analysis succeeds while outbound network access is blocked after model installation.

File handling:

- Enforce a configurable maximum file size.
- Enforce a configurable maximum extracted-text size.
- Protect DOCX extraction from ZIP bombs and path traversal.
- Reject malformed archives safely.
- Apply PDF parser limits.
- Prevent unbounded memory consumption.
- Prevent model-download path traversal.
- Verify hashes before loading models.
- Do not execute macros, scripts, embedded files, or document links.

Create:

docs/ai-detector/privacy-model.md
docs/ai-detector/security-review.md

# ====================================================================== 12. EXPORTABLE REPORT

Support a local export containing:

- Report language.
- Analysis timestamp.
- Detector version.
- Model versions.
- Model hashes abbreviated for readability.
- Document word or character count.
- Eligible text count.
- Excluded text count.
- AI-writing coverage.
- Uncertain coverage.
- Likely human coverage.
- Overall assessment.
- Confidence.
- Passage-level labels.
- Methodology summary.
- Limitations disclaimer.
- Privacy statement.

Do not include the full document by default.

Provide an explicit checkbox:

English:
Include analyzed text in exported report

Chinese:
在导出的报告中包含检测文本

Default: disabled.

Use the repository’s existing PDF/report technology when available. Otherwise export structured HTML and JSON first, then PDF only if a reliable existing PDF implementation exists.

# ====================================================================== 13. BENCHMARKING AND ACCURACY

Build a reproducible benchmark harness. Do not trust model-card metrics alone.

Create:

tools/ai_detector_benchmark/
docs/ai-detector/benchmark-methodology.md
docs/ai-detector/benchmark-results.md

Benchmark separately for:

- English human writing.
- English AI-generated writing.
- Chinese human writing.
- Chinese AI-generated writing.
- Mixed human/AI documents.
- AI-polished human writing.
- Human-edited AI writing.
- Short documents.
- Long documents.
- Different academic subjects.
- ESL English writing.
- Formal Chinese writing.
- Informal Chinese writing.
- Newer model outputs when legally available.
- Paraphrased text.
- Formatting and Unicode perturbations.

Candidate public evaluation sources may include:

- RAID for English robustness evaluation.
- HC3 or compatible Chinese datasets.
- Independently curated held-out English and Chinese writing samples.

Before using a dataset:

- Verify its license.
- Document its source.
- Check whether the selected model was trained on it.
- Avoid claiming independent generalization when evaluation data overlaps with model training.
- Do not commit restricted or large datasets into the application repository.

Metrics:

- False-positive rate.
- True-positive rate.
- Precision.
- Recall.
- F1.
- AUROC.
- Calibration error.
- Accuracy by language.
- Accuracy by document length.
- Accuracy by writing domain.
- Performance after paraphrasing.
- Performance on unseen generators.
- Passage-level boundary precision.
- Inconclusive rate.
- Average and p95 inference latency.
- Peak memory usage.

Treat false positives as the most serious product risk.

Do not launch with an “accurate” marketing claim unless independently reproduced metrics support it.

Add a release-quality gate:

- Benchmark command runs reproducibly.
- Results are generated from recorded model revisions.
- False-positive performance is documented separately for English and Chinese.
- Any weak language or domain is disclosed in the UI and documentation.
- If confidence is inadequate, return “Inconclusive” instead of forcing a result.

# ====================================================================== 14. TESTING

Implement tests at multiple levels.

Unit tests:

- TXT extraction.
- DOCX extraction.
- PDF extraction.
- Malformed file rejection.
- ZIP-bomb protection.
- Unicode normalization.
- English language routing.
- Chinese language routing.
- Mixed-language routing.
- Sentence segmentation.
- Token-aware chunking.
- Offset preservation.
- Overlap merging.
- Percentage aggregation.
- Percentage rounding.
- Short-text handling.
- Excluded-content handling.
- Cache-key stability.
- Cache clearing.
- Localization key completeness.
- Model manifest parsing.
- Model checksum validation.
- Calibration configuration validation.

Inference tests:

- English model loads.
- Chinese model loads.
- Models reject incompatible tokenizers.
- Known fixture returns valid probabilities.
- PyTorch and ONNX outputs remain within tolerance.
- Determinism across repeated runs.
- CPU fallback works.
- Corrupted model fails visibly.
- Missing model triggers installation UI.
- No fake success response when inference fails.

Integration tests:

- Paste English essay and analyze.
- Paste Chinese essay and analyze.
- Paste mixed-language essay and analyze.
- Upload TXT.
- Upload DOCX.
- Upload PDF.
- Cancel analysis.
- Retry analysis.
- Export report.
- Clear document.
- Switch UI language.
- Restart DJL and use installed models offline.
- Clear cache without deleting models.
- Remove model and reinstall.

Privacy tests:

- Analysis works with outbound network blocked.
- Essay text never appears in application logs.
- Essay text never appears in telemetry events.
- Essay text never appears in crash metadata.
- Temporary files are removed.
- Cache contains hashes/results only.
- Export occurs only after explicit user action.

UI tests:

- Empty state.
- Model-not-installed state.
- Download state.
- Analysis state.
- Success state.
- Inconclusive state.
- Error state.
- Short-text state.
- Unsupported-language state.
- Keyboard-only navigation.
- English screenshot test.
- Chinese screenshot test.

Run all existing repository tests as well as the new tests.

Do not disable, weaken, or delete existing tests merely to make CI pass.

# ====================================================================== 15. PERFORMANCE

Measure before optimizing.

Track:

- Application startup impact.
- Model initialization time.
- First-analysis latency.
- Warm-analysis latency.
- Peak RAM.
- Model disk usage.
- CPU utilization.
- UI responsiveness.
- Passage throughput.

Requirements:

- Model loading must not freeze the UI thread.
- Document extraction must not freeze the UI thread.
- Inference must be cancellable between passages.
- Progress must reflect completed work rather than a fake timer.
- Avoid loading both language models when only one is needed.
- Unload inactive models when memory pressure requires it.
- Reuse loaded tokenizers and sessions.
- Batch passages only when it produces a measured improvement.
- Preserve a reliable CPU path for users without a GPU.

Create a small benchmark command that prints machine-readable JSON performance results.

# ====================================================================== 16. MODEL UPDATE DESIGN

Implement a versioned model manifest.

The manifest should contain:

- Detector component ID.
- Human-readable name.
- Supported language.
- Model source ID.
- Exact revision.
- Download files.
- File sizes.
- SHA-256 hashes.
- Tokenizer revision.
- Runtime format.
- Calibration version.
- Minimum DJL version.
- License metadata.
- Release notes.
- Deprecation state.

Rules:

- Never silently replace a model during analysis.
- Ask the user before downloading a materially larger model.
- Preserve the old model until the new model passes verification.
- Roll back safely if installation fails.
- Mark historical reports with the detector version used.
- Do not compare scores from two detector versions as though they were directly interchangeable.

# ====================================================================== 17. DOCUMENTATION

Create production documentation:

docs/ai-detector/README.md
docs/ai-detector/architecture.md
docs/ai-detector/privacy-model.md
docs/ai-detector/security-review.md
docs/ai-detector/model-licenses.md
docs/ai-detector/runtime-decision.md
docs/ai-detector/benchmark-methodology.md
docs/ai-detector/benchmark-results.md
docs/ai-detector/troubleshooting.md
docs/ai-detector/releasing-model-updates.md

Document:

- What the detector measures.
- What it does not measure.
- Why the result is probabilistic.
- Difference between raw model probability and document coverage.
- English and Chinese model routing.
- Mixed-language handling.
- Local processing.
- Model download behavior.
- Data retention.
- Known limitations.
- How to run tests.
- How to run benchmarks.
- How to update models.
- How to verify model hashes.
- How to reproduce release results.
- How to remove downloaded models.

Add an end-user privacy explanation in both English and Chinese.

# ====================================================================== 18. IMPLEMENTATION PHASES

Execute in this order while keeping the branch buildable:

Phase 1: Repository integration

- Inspect architecture.
- Add feature route/navigation.
- Add types and stable detector interfaces.
- Add localized empty-state UI.

Phase 2: English vertical slice

- Paste text.
- English language detection.
- English detector.
- Passage segmentation.
- Stable result aggregation.
- Basic highlighted report.

Phase 3: Chinese support

- Chinese detector.
- Chinese segmentation.
- Chinese calibration.
- Chinese UI.
- Mixed-language routing.

Phase 4: Documents

- TXT.
- DOCX.
- Text-based PDF.
- Offset mapping.
- Excluded-content handling.

Phase 5: Local model management

- Download.
- Version pinning.
- Checksum verification.
- Offline use.
- Error and recovery flows.

Phase 6: Privacy and security

- Logging audit.
- Telemetry audit.
- Temporary-file audit.
- Parser protections.
- Network-isolation test.

Phase 7: Export and accessibility

- Local report export.
- Keyboard support.
- Screen-reader labels.
- Contrast review.
- English and Chinese localization review.

Phase 8: Benchmarking

- Benchmark harness.
- Reproducible metrics.
- Threshold and calibration review.
- Document limitations.

Phase 9: Packaging and release verification

- Package runtime and required dependencies.
- Test clean installation.
- Test first model download.
- Test offline analysis.
- Run full CI.
- Produce release notes.

# ====================================================================== 19. REQUIRED ENGINEERING QUALITY

Follow the existing repository’s conventions.

Requirements:

- Strong typing.
- No broad exception swallowing.
- No silent failures.
- No placeholder success values.
- No duplicated parsing or scoring logic.
- No `any` or unsafe type casts without a documented reason.
- No blocking work on the UI thread.
- No hidden network calls.
- No unverified model files.
- No hard-coded English UI strings.
- No test-only logic leaking into production.
- No giant files containing unrelated responsibilities.
- No unrelated refactors.
- No TODO comments left for core behavior.
- No fake implementation where the UI displays sample percentages.
- No claims that work is complete until builds and tests have actually passed.

Add meaningful logs for operational errors, but never include document content.

# ====================================================================== 20. DEFINITION OF DONE

The task is complete only when all of the following are true:

1. DJL has a visible AI Writing Check feature.
2. The UI is simple and focused.
3. English and Simplified Chinese UI are complete.
4. English text detection works locally.
5. Chinese text detection works locally.
6. Mixed English-Chinese documents are handled.
7. TXT, DOCX, and text-based PDF inputs work.
8. Passage-level highlighting works.
9. Coverage percentages are calculated without overlap duplication.
10. Repeated scans are deterministic.
11. No paid service or remote inference is used.
12. Essays do not leave the device.
13. Essays are not stored by default.
14. Essay content does not enter logs, telemetry, or crash reports.
15. Models are version-pinned and checksum-verified.
16. Model licenses are documented.
17. The application works offline after models are installed.
18. Exported reports work in English and Chinese.
19. Unit, integration, privacy, determinism, and UI tests pass.
20. Existing project tests still pass.
21. Benchmark tooling exists and produces reproducible output.
22. Limitations and false-positive risks are clearly documented.
23. Packaging works on the operating systems currently supported by DJL.
24. No core placeholder, TODO, mocked detector score, or unfinished screen remains.
25. The final response includes:
    - Architecture implemented.
    - Files changed.
    - Models selected and why.
    - License findings.
    - Tests run and exact results.
    - Benchmark results that were actually measured.
    - Remaining limitations.
    - Packaging instructions.
    - Screenshots of English and Chinese UI.
    - Explicit confirmation of whether any essay data can leave the device.

Begin by inspecting the repository. Then write the plan, implement the feature, run the complete verification suite, fix failures, and report only evidence-backed results.
