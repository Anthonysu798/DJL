// FILE: AiDetectorManager.ts
// Purpose: Own model lifecycle, request-scoped analysis, and hash-only caching.

import { createHash } from "node:crypto";
import path from "node:path";

import type {
  AiDetectorAnalysisEvent,
  AiDetectorErrorCode,
  AiDetectorLanguagePreference,
  AiDetectorModelRun,
  AiDetectorModelStatus,
  AiDetectorReport,
  AiDetectorState,
} from "@synara/contracts";

import {
  DocumentExtractionError,
  DocumentOcrRequiredError,
  extractDetectorDocument,
} from "../work/documentExtraction";
import {
  getModelManifest,
  modelArtifactFingerprint,
  modelSizeBytes,
  primaryModelSha256,
  type DetectorModelLanguage,
} from "./modelManifest";
import {
  inspectInstalledModel,
  installDetectorModel,
  recoverModelInstallState,
  removeDetectorModel,
  verifyInstalledModel,
} from "./modelInstaller";
import { DetectorModelIntegrityError, DetectorModelRuntime } from "./modelRuntime";
import { DetectorResultCache } from "./resultCache";
import {
  AI_DETECTOR_PREPROCESSING_VERSION,
  AI_DETECTOR_SEGMENTATION_VERSION,
  aggregateReport,
  normalizeWithOffsets,
  routeEligibleProse,
  segmentPassagesTokenAware,
  type ScoredPassage,
} from "./textPipeline";

export class AiDetectorManagerError extends Error {
  constructor(
    readonly code: AiDetectorErrorCode,
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AiDetectorManagerError";
  }
}

export interface AiDetectorAnalyzeInput {
  readonly bytes: Uint8Array;
  readonly filename?: string;
  readonly mediaType?: string;
  readonly languagePreference: AiDetectorLanguagePreference;
  /**
   * Benchmark-only escape hatch. It prevents both reading and writing the
   * persistent result cache so timing and model identity evidence always comes
   * from a fresh inference pass.
   */
  readonly bypassResultCache?: boolean;
  readonly signal: AbortSignal;
  readonly emit: (event: AiDetectorAnalysisEvent) => void | Promise<void>;
}

type InstallState = {
  state: AiDetectorModelStatus["state"];
  downloadedBytes: number;
  error: string | null;
};

const languages: readonly DetectorModelLanguage[] = ["en", "zh-Hans"];

function extractionWarningCodes(warnings: readonly string[]): string[] {
  return warnings.map((warning) =>
    warning === "External Office relationships were ignored and were not fetched."
      ? "external-relationships-ignored"
      : "document-extraction-warning",
  );
}

export class AiDetectorManager {
  private readonly modelRoot: string;
  private readonly cache: DetectorResultCache;
  private readonly runtime: DetectorModelRuntime;
  private readonly initialization: Promise<void>;
  private readonly installStates = new Map<DetectorModelLanguage, InstallState>();
  private readonly installControllers = new Map<DetectorModelLanguage, AbortController>();
  private readonly installTasks = new Map<DetectorModelLanguage, Promise<void>>();
  private readonly integrityChecks = new Map<DetectorModelLanguage, Promise<boolean>>();
  private activeAnalyses = 0;
  private readonly analysisIdleWaiters = new Set<() => void>();
  private progressPublishTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    stateDir: string,
    private readonly onState?: (state: AiDetectorState) => void | Promise<void>,
  ) {
    this.modelRoot = path.join(stateDir, "ai-detector", "models");
    this.cache = new DetectorResultCache(stateDir);
    this.runtime = new DetectorModelRuntime(this.modelRoot);
    this.initialization = Promise.all(
      languages.map((language) => recoverModelInstallState(this.modelRoot, language)),
    ).then(() => undefined);
  }

  async getState(): Promise<AiDetectorState> {
    await this.initialization;
    const models: AiDetectorModelStatus[] = [];
    for (const language of languages) {
      const manifest = getModelManifest(language);
      const active = this.installStates.get(language);
      const inspected = await inspectInstalledModel(this.modelRoot, language);
      const installed = inspected ? await this.verifyModelOnce(language) : false;
      const integrityError = inspected && !installed;
      models.push({
        language,
        displayName: manifest.displayName,
        state: active?.state ?? (installed ? "ready" : integrityError ? "error" : "not-installed"),
        revision: manifest.revision,
        license: manifest.license,
        sizeBytes: modelSizeBytes(manifest),
        downloadedBytes: active?.downloadedBytes ?? (installed ? modelSizeBytes(manifest) : 0),
        error:
          active?.error ??
          (integrityError
            ? "The installed model is corrupted or does not match its pinned checksum."
            : null),
      });
    }
    const cache = await this.cache.status();
    return { models, cacheEntries: cache.entries, cacheBytes: cache.bytes };
  }

  private verifyModelOnce(language: DetectorModelLanguage): Promise<boolean> {
    const existing = this.integrityChecks.get(language);
    if (existing) return existing;
    const check = verifyInstalledModel(this.modelRoot, language).catch(() => false);
    this.integrityChecks.set(language, check);
    return check;
  }

  private async waitForAnalysisIdle(): Promise<void> {
    if (this.activeAnalyses === 0) return;
    await new Promise<void>((resolve) => this.analysisIdleWaiters.add(resolve));
  }

  private finishAnalysis(): void {
    this.activeAnalyses -= 1;
    if (this.activeAnalyses !== 0) return;
    for (const resolve of this.analysisIdleWaiters) resolve();
    this.analysisIdleWaiters.clear();
  }

  private scheduleProgressStatePublish(): void {
    if (this.progressPublishTimer) return;
    this.progressPublishTimer = setTimeout(() => {
      this.progressPublishTimer = null;
      void this.publishState();
    }, 100);
    this.progressPublishTimer.unref?.();
  }

  private cancelScheduledProgressPublish(): void {
    if (!this.progressPublishTimer) return;
    clearTimeout(this.progressPublishTimer);
    this.progressPublishTimer = null;
  }

  private async publishState(): Promise<AiDetectorState> {
    const state = await this.getState();
    await this.onState?.(state);
    return state;
  }

  async installModel(language: DetectorModelLanguage): Promise<AiDetectorState> {
    await this.initialization;
    if (this.installControllers.has(language)) {
      throw new AiDetectorManagerError("model-install-failed", "This model is already installing.");
    }
    await this.waitForAnalysisIdle();
    if (this.installControllers.has(language)) {
      throw new AiDetectorManagerError("model-install-failed", "This model is already installing.");
    }
    const controller = new AbortController();
    this.integrityChecks.delete(language);
    this.installControllers.set(language, controller);
    this.installStates.set(language, { state: "downloading", downloadedBytes: 0, error: null });
    const state = await this.publishState();
    const task = this.runModelInstall(language, controller);
    this.installTasks.set(language, task);
    void task.finally(() => {
      if (this.installTasks.get(language) === task) {
        this.installTasks.delete(language);
      }
    });
    return state;
  }

  private async runModelInstall(
    language: DetectorModelLanguage,
    controller: AbortController,
  ): Promise<void> {
    try {
      await this.runtime.dispose();
      await installDetectorModel({
        modelRoot: this.modelRoot,
        language,
        signal: controller.signal,
        onProgress: (progress) => {
          this.installStates.set(language, {
            state: progress.state,
            downloadedBytes: progress.downloadedBytes,
            error: null,
          });
          this.scheduleProgressStatePublish();
        },
      });
      this.cancelScheduledProgressPublish();
      this.integrityChecks.set(language, Promise.resolve(true));
      this.installStates.delete(language);
      await this.publishState();
    } catch (error) {
      this.cancelScheduledProgressPublish();
      const cancelled = controller.signal.aborted;
      if (cancelled) {
        this.installStates.delete(language);
        this.integrityChecks.delete(language);
      } else {
        this.installStates.set(language, {
          state: "error",
          downloadedBytes: 0,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      await this.publishState();
    } finally {
      if (this.installControllers.get(language) === controller) {
        this.installControllers.delete(language);
      }
    }
  }

  async cancelInstall(language: DetectorModelLanguage): Promise<AiDetectorState> {
    await this.initialization;
    this.installControllers.get(language)?.abort();
    await this.installTasks.get(language);
    return this.publishState();
  }

  async removeModel(language: DetectorModelLanguage): Promise<AiDetectorState> {
    await this.initialization;
    this.installControllers.get(language)?.abort();
    await this.installTasks.get(language);
    await this.waitForAnalysisIdle();
    await this.runtime.dispose();
    await removeDetectorModel(this.modelRoot, language);
    this.integrityChecks.delete(language);
    this.installStates.delete(language);
    return this.publishState();
  }

  async clearCache(): Promise<AiDetectorState> {
    await this.initialization;
    await this.cache.clear();
    return this.publishState();
  }

  private cacheKey(contentHash: string, preference: AiDetectorLanguagePreference): string {
    return createHash("sha256")
      .update(
        JSON.stringify({
          contentHash,
          preference,
          preprocessing: AI_DETECTOR_PREPROCESSING_VERSION,
          segmentation: AI_DETECTOR_SEGMENTATION_VERSION,
          models: languages.map((language) => {
            const manifest = getModelManifest(language);
            return [
              language,
              manifest.revision,
              modelArtifactFingerprint(manifest),
              {
                version: manifest.calibrationVersion,
                humanThreshold: manifest.humanThreshold,
                aiThreshold: manifest.aiThreshold,
                bands: manifest.calibrationBands,
              },
              manifest.output,
            ];
          }),
        }),
      )
      .digest("hex");
  }

  async analyze(input: AiDetectorAnalyzeInput): Promise<AiDetectorReport> {
    await this.initialization;
    await Promise.all(this.installTasks.values());
    this.activeAnalyses += 1;
    const emit = async (event: AiDetectorAnalysisEvent) => input.emit(event);
    try {
      input.signal.throwIfAborted();
      await emit({ type: "progress", stage: "extracting", completed: 0, total: 1 });
      const extracted = await extractDetectorDocument(input);
      await emit({ type: "progress", stage: "extracting", completed: 1, total: 1 });
      input.signal.throwIfAborted();

      await emit({ type: "progress", stage: "normalizing", completed: 0, total: 1 });
      const normalized = normalizeWithOffsets(extracted.text);
      const contentHash = createHash("sha256").update(normalized.text).digest("hex");
      await emit({ type: "progress", stage: "normalizing", completed: 1, total: 1 });

      const key = this.cacheKey(contentHash, input.languagePreference);
      const cacheLookup = input.bypassResultCache
        ? { report: null, generation: 0 }
        : await this.cache.getWithGeneration(key, normalized.text);
      if (cacheLookup.report) {
        await emit({ type: "progress", stage: "complete", completed: 1, total: 1 });
        return {
          ...cacheLookup.report,
          warnings: [
            ...cacheLookup.report.warnings.filter(
              (warning) =>
                warning !== "external-relationships-ignored" &&
                warning !== "document-extraction-warning",
            ),
            ...extractionWarningCodes(extracted.warnings),
          ],
        };
      }

      await emit({ type: "progress", stage: "routing", completed: 0, total: 1 });
      const routed = routeEligibleProse(normalized.text, input.languagePreference);
      const requiredLanguages: DetectorModelLanguage[] = [];
      for (const span of routed) {
        if (
          span.excludedReason === undefined &&
          span.language !== "unsupported" &&
          !requiredLanguages.includes(span.language)
        ) {
          requiredLanguages.push(span.language);
        }
      }
      await Promise.all(
        requiredLanguages.flatMap((language) => {
          const task = this.installTasks.get(language);
          return task ? [task] : [];
        }),
      );
      for (const language of requiredLanguages) {
        if (!(await inspectInstalledModel(this.modelRoot, language))) {
          throw new AiDetectorManagerError(
            "model-not-installed",
            language === "en"
              ? "Install the English detector model before analyzing this text."
              : "Install the Simplified Chinese detector model before analyzing this text.",
          );
        }
      }
      const passages = await segmentPassagesTokenAware(
        normalized.text,
        routed,
        (passageLanguage, text, signal) => this.runtime.countTokens(passageLanguage, text, signal),
        input.signal,
      );
      await emit({ type: "progress", stage: "routing", completed: 1, total: 1 });

      const scored: ScoredPassage[] = [];
      let completedPassages = 0;
      for (const language of requiredLanguages) {
        for (const passage of passages.filter((candidate) => candidate.language === language)) {
          input.signal.throwIfAborted();
          await emit({
            type: "progress",
            stage: "scoring",
            completed: completedPassages,
            total: passages.length,
          });
          const aiProbability = await this.runtime.score(
            passage.language,
            passage.text,
            input.signal,
          );
          scored.push({ ...passage, aiProbability });
          completedPassages += 1;
        }
      }
      await emit({
        type: "progress",
        stage: "scoring",
        completed: passages.length,
        total: passages.length,
      });
      await emit({ type: "progress", stage: "aggregating", completed: 0, total: 1 });
      const aggregated = aggregateReport({ text: normalized.text, routed, passages: scored });
      const modelRuns: AiDetectorModelRun[] = requiredLanguages.map((language) => {
        const manifest = getModelManifest(language);
        return {
          language,
          model: manifest.id,
          revision: manifest.revision,
          modelSha256: primaryModelSha256(manifest),
          calibrationVersion: manifest.calibrationVersion,
          passages: scored.filter((passage) => passage.language === language).length,
        };
      });
      const warnings = extractionWarningCodes(extracted.warnings);
      if (aggregated.assessment === "insufficient") {
        warnings.push("insufficient-prose");
      } else if (aggregated.assessment === "unsupported") {
        warnings.push("unsupported-language");
      }
      const report: AiDetectorReport = {
        schemaVersion: 1,
        normalizedText: normalized.text,
        languagePreference: input.languagePreference,
        scores: aggregated.scores,
        assessment: aggregated.assessment,
        confidence: aggregated.confidence,
        eligibleCharacters: aggregated.eligibleCharacters,
        excludedCharacters: aggregated.excludedCharacters,
        totalCharacters: normalized.text.length,
        regions: [...aggregated.regions],
        modelRuns,
        preprocessingVersion: AI_DETECTOR_PREPROCESSING_VERSION,
        segmentationVersion: AI_DETECTOR_SEGMENTATION_VERSION,
        contentHash,
        cacheHit: false,
        warnings,
      };
      if (!input.bypassResultCache) {
        const cacheUpdated = await this.cache.setIfGeneration(key, report, cacheLookup.generation);
        if (cacheUpdated) await this.publishState();
      }
      await emit({ type: "progress", stage: "aggregating", completed: 1, total: 1 });
      await emit({ type: "progress", stage: "complete", completed: 1, total: 1 });
      return report;
    } catch (error) {
      if (input.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
        throw new AiDetectorManagerError("cancelled", "Analysis cancelled.", error);
      }
      if (error instanceof AiDetectorManagerError) throw error;
      if (error instanceof DetectorModelIntegrityError) {
        this.integrityChecks.set(error.language, Promise.resolve(false));
        this.installStates.set(error.language, {
          state: "error",
          downloadedBytes: 0,
          error: "The installed model is corrupted or does not match its pinned checksum.",
        });
        await this.publishState();
        throw new AiDetectorManagerError(
          "model-install-failed",
          "The local detector model is corrupted or does not match its pinned manifest.",
          error,
        );
      }
      if (error instanceof DocumentOcrRequiredError) {
        throw new AiDetectorManagerError(
          "ocr-required",
          "This PDF has no readable text. Scanned PDFs and OCR are not supported by AI Writing Check.",
          error,
        );
      }
      if (error instanceof DocumentExtractionError) {
        const unsafe = [
          "invalid_archive",
          "archive_limit",
          "macro_rejected",
          "nested_archive_rejected",
        ].includes(error.code);
        throw new AiDetectorManagerError(
          unsafe
            ? "unsafe-document"
            : error.code === "unsupported_format"
              ? "unsupported-format"
              : "invalid-input",
          error.message,
          error,
        );
      }
      throw new AiDetectorManagerError(
        "analysis-failed",
        error instanceof Error ? error.message : "Local analysis failed.",
        error,
      );
    } finally {
      this.finishAnalysis();
    }
  }
}
