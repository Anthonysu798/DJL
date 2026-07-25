// FILE: AiWritingCheckView.tsx
// Purpose: Local-first English and Simplified Chinese AI writing assessment UI.

import type {
  AiDetectorLanguagePreference,
  AiDetectorModelStatus,
  AiDetectorRegion,
  AiDetectorReport,
  AiDetectorStage,
  AiDetectorState,
} from "@synara/contracts";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { formatBytes } from "@synara/shared/formatBytes";

import {
  CHAT_SURFACE_HEADER_DIVIDER_CLASS_NAME,
  CHAT_SURFACE_HEADER_HEIGHT_CLASS,
  CHAT_SURFACE_HEADER_PADDING_X_CLASS,
} from "~/components/chat/chatHeaderControls";
import { CHAT_BACKGROUND_CLASS_NAME } from "~/components/chat/composerPickerStyles";
import { RouteInsetSurface } from "~/components/RouteInsetSurface";
import { SidebarHeaderNavigationControls } from "~/components/SidebarHeaderNavigationControls";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  useDesktopTopBarTrafficLightGutterClassName,
  useDesktopTopBarWindowControlsGutterClassName,
} from "~/hooks/useDesktopTopBarGutter";
import {
  CheckIcon,
  DownloadIcon,
  FileIcon,
  Loader2Icon,
  LockIcon,
  SparklesIcon,
  Trash2,
  XIcon,
} from "~/lib/icons";
import { cn } from "~/lib/utils";
import { readNativeApi } from "~/nativeApi";
import { formatLocaleNumber } from "~/i18n/intl";

import {
  AiDetectorAnalysisError,
  DETECTOR_MODEL_LANGUAGES,
  analyzeWriting,
  renderAiDetectorHtmlReport,
  serializeAiDetectorJsonReport,
  type AiDetectorReportExportCopy,
} from "./aiDetectorClient";

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const ACCEPTED_EXTENSIONS = new Set(["txt", "docx", "pdf"]);

const ANALYSIS_ERROR_KEYS = {
  "invalid-input": "aiDetector.errors.server.invalidInput",
  "unsupported-format": "aiDetector.errors.server.unsupportedFormat",
  "unsafe-document": "aiDetector.errors.server.unsafeDocument",
  "ocr-required": "aiDetector.errors.server.ocrRequired",
  "model-not-installed": "aiDetector.errors.server.modelNotInstalled",
  "model-install-failed": "aiDetector.errors.server.modelInstallFailed",
  "local-only": "aiDetector.errors.server.localOnly",
  "analysis-failed": "aiDetector.errors.server.analysisFailed",
  cancelled: "aiDetector.errors.cancelled",
} as const;

function modelFor(
  state: AiDetectorState | null,
  language: "en" | "zh-Hans",
): AiDetectorModelStatus | null {
  return state?.models.find((model) => model.language === language) ?? null;
}

function validateFile(file: File): "type" | "size" | null {
  const extension = file.name.split(".").at(-1)?.toLowerCase() ?? "";
  if (!ACCEPTED_EXTENSIONS.has(extension)) return "type";
  if (file.size <= 0 || file.size > MAX_FILE_BYTES) return "size";
  return null;
}

function regionClass(region: AiDetectorRegion): string {
  switch (region.label) {
    case "likely-ai":
      return "rounded-[2px] bg-destructive/16 text-foreground decoration-destructive/60 underline decoration-1 underline-offset-2";
    case "uncertain":
      return "rounded-[2px] bg-warning/16 text-foreground decoration-warning/70 underline decoration-dotted underline-offset-2";
    case "likely-human":
      return "rounded-[2px] bg-success/12 text-foreground decoration-success/55 underline decoration-1 underline-offset-2";
    case "excluded":
      return "text-muted-foreground/55 decoration-muted-foreground/40 line-through decoration-1";
  }
}

function ModelCard(props: {
  readonly model: AiDetectorModelStatus | null;
  readonly language: "en" | "zh-Hans";
  readonly busy: boolean;
  readonly onInstall: () => void;
  readonly onCancel: () => void;
  readonly onRemove: () => void;
}) {
  const { t, i18n } = useTranslation("work");
  const model = props.model;
  const state = model?.state ?? "not-installed";
  const progress =
    model && model.sizeBytes > 0
      ? Math.min(100, (model.downloadedBytes / model.sizeBytes) * 100)
      : 0;
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-xl border border-border/70 bg-background/35 p-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-muted/30">
          {state === "ready" ? (
            <CheckIcon className="size-4 text-success" aria-hidden />
          ) : (
            <SparklesIcon className="size-4 text-muted-foreground" aria-hidden />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">
            {t(`aiDetector.models.language.${props.language}`)}
          </p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {model?.displayName ?? t("aiDetector.models.loading")}
          </p>
        </div>
        <Badge
          variant={
            state === "ready"
              ? "success"
              : state === "error"
                ? "error"
                : state === "downloading" || state === "verifying"
                  ? "warning"
                  : "secondary"
          }
        >
          {t(`aiDetector.models.state.${state}`)}
        </Badge>
      </div>
      {model ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-muted-foreground">
          <span>{formatBytes(model.sizeBytes, i18n.language)}</span>
          <span>{model.license}</span>
          <span>{model.revision.slice(0, 8)}</span>
        </div>
      ) : null}
      {state === "downloading" || state === "verifying" ? (
        <div className="space-y-2">
          <div
            className="h-1 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label={t("aiDetector.models.installProgress", {
              language: t(`aiDetector.models.language.${props.language}`),
            })}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress)}
          >
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-200 motion-reduce:transition-none"
              style={{ width: `${progress}%` }}
            />
          </div>
          <Button size="xs" variant="outline" onClick={props.onCancel}>
            {t("aiDetector.actions.cancelInstall")}
          </Button>
        </div>
      ) : state === "ready" ? (
        <Button size="xs" variant="outline" onClick={props.onRemove} disabled={props.busy}>
          <Trash2 className="size-3.5" aria-hidden />
          {t("aiDetector.actions.removeModel")}
        </Button>
      ) : (
        <div className="space-y-2">
          {model?.error ? (
            <p className="text-xs text-destructive" role="alert">
              {t("aiDetector.errors.server.modelInstallFailed")}
            </p>
          ) : null}
          <Button
            size="xs"
            variant="outline"
            onClick={props.onInstall}
            disabled={props.busy || !model}
          >
            <DownloadIcon className="size-3.5" aria-hidden />
            {state === "error"
              ? t("aiDetector.actions.retryInstall")
              : t("aiDetector.actions.installModel")}
          </Button>
        </div>
      )}
    </div>
  );
}

function ScoreCard(props: {
  readonly label: string;
  readonly value: number;
  readonly tone: "ai" | "uncertain" | "human";
}) {
  const tone = {
    ai: "border-destructive/28 bg-destructive/6",
    uncertain: "border-warning/28 bg-warning/6",
    human: "border-success/28 bg-success/6",
  }[props.tone];
  const dot = { ai: "bg-destructive", uncertain: "bg-warning", human: "bg-success" }[props.tone];
  return (
    <div className={cn("min-w-0 rounded-xl border p-4", tone)}>
      <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <span className={cn("size-2 rounded-full", dot)} aria-hidden />
        {props.label}
      </p>
      <p className="mt-3 font-mono text-3xl font-semibold tabular-nums tracking-tight text-foreground">
        {props.value}%
      </p>
    </div>
  );
}

function HighlightedText(props: { readonly report: AiDetectorReport }) {
  const { t } = useTranslation("work");
  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const [index, region] of props.report.regions.entries()) {
    if (region.start > cursor) nodes.push(props.report.normalizedText.slice(cursor, region.start));
    const label = t(`aiDetector.results.region.${region.label}`);
    nodes.push(
      <mark
        key={`${region.start}-${region.end}-${index}`}
        className={cn("bg-transparent", regionClass(region))}
        title={
          region.reason
            ? `${label} · ${t(`aiDetector.results.exclusion.${region.reason}`, { defaultValue: region.reason })}`
            : region.score === undefined
              ? label
              : `${label} · ${Math.round(region.score * 100)}%`
        }
      >
        {props.report.normalizedText.slice(region.start, region.end)}
      </mark>,
    );
    cursor = Math.max(cursor, region.end);
  }
  if (cursor < props.report.normalizedText.length)
    nodes.push(props.report.normalizedText.slice(cursor));
  return (
    <div className="max-h-[34rem] overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-border/70 bg-background/45 p-5 font-sans text-sm leading-7 text-foreground">
      {nodes}
    </div>
  );
}

export function AiWritingCheckView() {
  const { t, i18n } = useTranslation("work");
  const desktopTopBarTrafficLightGutterClassName = useDesktopTopBarTrafficLightGutterClassName();
  const desktopTopBarWindowControlsGutterClassName =
    useDesktopTopBarWindowControlsGutterClassName();
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [language, setLanguage] = useState<AiDetectorLanguagePreference>("auto");
  const [state, setState] = useState<AiDetectorState | null>(null);
  const [progress, setProgress] = useState<{
    stage: AiDetectorStage;
    completed: number;
    total: number;
  } | null>(null);
  const [report, setReport] = useState<AiDetectorReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [includeText, setIncludeText] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const resultHeadingRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    return () => controllerRef.current?.abort();
  }, []);

  const refreshState = useCallback(async () => {
    try {
      const api = readNativeApi();
      if (!api) return;
      setState(await api.aiDetector.getState());
    } catch {
      setError(t("aiDetector.errors.server.analysisFailed"));
    }
  }, [t]);

  useEffect(() => {
    const api = readNativeApi();
    if (!api) return;
    void refreshState();
    return api.aiDetector.onEvent((event) => setState(event.state));
  }, [refreshState]);

  useEffect(() => {
    if (report) resultHeadingRef.current?.focus();
  }, [report]);

  const acceptFile = useCallback(
    (next: File) => {
      const issue = validateFile(next);
      if (issue) {
        setError(t(`aiDetector.errors.file.${issue}`));
        return;
      }
      setFile(next);
      setText("");
      setReport(null);
      setError(null);
    },
    [t],
  );

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    const dropped = event.dataTransfer.files[0];
    if (dropped) acceptFile(dropped);
  };

  const runAnalysis = async () => {
    const data = file ?? text.trim();
    if (!data || (typeof data === "string" && data.length === 0)) {
      setError(t("aiDetector.errors.empty"));
      return;
    }
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy(true);
    setReport(null);
    setError(null);
    setProgress({ stage: "extracting", completed: 0, total: 1 });
    try {
      const next = await analyzeWriting({
        document: { data, languagePreference: language },
        signal: controller.signal,
        onEvent: (event) => {
          if (event.type === "progress") setProgress(event);
        },
      });
      setReport(next);
    } catch (cause) {
      if (controller.signal.aborted) {
        setError(t("aiDetector.errors.cancelled"));
      } else if (cause instanceof AiDetectorAnalysisError) {
        setError(t(ANALYSIS_ERROR_KEYS[cause.code]));
      } else {
        setError(t("aiDetector.errors.server.analysisFailed"));
      }
    } finally {
      controllerRef.current = null;
      setBusy(false);
    }
  };

  const mutateModel = async (
    action: "installModel" | "cancelInstall" | "removeModel",
    modelLanguage: "en" | "zh-Hans",
  ) => {
    const api = readNativeApi();
    if (!api) return;
    setError(null);
    try {
      setState(await api.aiDetector[action]({ language: modelLanguage }));
    } catch {
      setError(
        t(
          action === "installModel"
            ? "aiDetector.errors.server.modelInstallFailed"
            : "aiDetector.errors.server.analysisFailed",
        ),
      );
    }
  };

  const clearDetectorCache = async () => {
    const api = readNativeApi();
    if (!api) return;
    setError(null);
    try {
      setState(await api.aiDetector.clearCache());
    } catch {
      setError(t("aiDetector.errors.server.analysisFailed"));
    }
  };

  const exportReport = async (format: "html" | "json") => {
    if (!report) return;
    const api = readNativeApi();
    const exclusionLabels = Object.fromEntries(
      report.regions.flatMap((region) =>
        region.reason
          ? [
              [
                region.reason,
                t(`aiDetector.results.exclusion.${region.reason}`, {
                  defaultValue: region.reason,
                }),
              ],
            ]
          : [],
      ),
    );
    const copy = {
      title: t("aiDetector.title"),
      privacy: t("aiDetector.before.itemLocal"),
      methodology: t("aiDetector.description"),
      disclaimer: t("aiDetector.results.disclaimer"),
      assessment: t(`aiDetector.results.assessment.${report.assessment}`),
      confidenceLabel: t("aiDetector.results.confidence"),
      confidence: t(`aiDetector.results.confidenceLevel.${report.confidence}`),
      likelyAi: t("aiDetector.results.likelyAi"),
      uncertain: t("aiDetector.results.uncertain"),
      likelyHuman: t("aiDetector.results.likelyHuman"),
      eligible: t("aiDetector.results.eligible"),
      excluded: t("aiDetector.results.excluded"),
      evidence: t("aiDetector.results.evidence"),
      technicalDetails: t("aiDetector.results.technicalDetails"),
      analyzedText: t("aiDetector.input.textLabel"),
      preprocessing: t("aiDetector.results.preprocessing"),
      segmentation: t("aiDetector.results.segmentation"),
      digest: t("aiDetector.results.digest"),
      regionLabels: {
        "likely-ai": t("aiDetector.results.region.likely-ai"),
        uncertain: t("aiDetector.results.region.uncertain"),
        "likely-human": t("aiDetector.results.region.likely-human"),
        excluded: t("aiDetector.results.region.excluded"),
      },
      exclusionLabels,
    } satisfies AiDetectorReportExportCopy;
    const options = {
      includeText,
      reportLanguage: i18n.resolvedLanguage ?? i18n.language,
      generatedAt: new Date().toISOString(),
      copy,
    };
    const contents =
      format === "html"
        ? renderAiDetectorHtmlReport(report, options)
        : serializeAiDetectorJsonReport(report, options);
    try {
      await api?.dialogs.saveFile?.({
        defaultFilename: `djl-ai-writing-check.${format}`,
        contents,
        filters: [
          {
            name: format === "html" ? t("aiDetector.export.html") : t("aiDetector.export.json"),
            extensions: [format],
          },
        ],
      });
    } catch {
      setError(t("aiDetector.errors.server.analysisFailed"));
    }
  };

  const reset = () => {
    controllerRef.current?.abort();
    setText("");
    setFile(null);
    setReport(null);
    setError(null);
    setProgress(null);
    setIncludeText(false);
  };

  const inputCount = file ? file.size : text.length;
  const progressPercent =
    progress && progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;
  const requiredModelsReady = useMemo(() => {
    if (language === "en") return modelFor(state, "en")?.state === "ready";
    if (language === "zh-Hans") return modelFor(state, "zh-Hans")?.state === "ready";
    return state?.models.some((model) => model.state === "ready") ?? false;
  }, [language, state]);

  return (
    <RouteInsetSurface>
      <div
        className={cn(
          "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
          CHAT_BACKGROUND_CLASS_NAME,
        )}
      >
        <header
          className={cn(
            CHAT_SURFACE_HEADER_DIVIDER_CLASS_NAME,
            CHAT_SURFACE_HEADER_PADDING_X_CLASS,
            "drag-region",
            desktopTopBarTrafficLightGutterClassName,
            desktopTopBarWindowControlsGutterClassName,
          )}
        >
          <div className={cn("flex items-center gap-2 sm:gap-3", CHAT_SURFACE_HEADER_HEIGHT_CLASS)}>
            <SidebarHeaderNavigationControls />
            <div className="min-w-0 flex-1" />
            {report ? (
              <Button
                size="sm"
                variant="outline"
                className="[-webkit-app-region:no-drag]"
                onClick={reset}
              >
                {t("aiDetector.actions.newCheck")}
              </Button>
            ) : null}
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-7 px-5 pb-16 pt-8 sm:px-8">
            <section className="flex flex-col gap-4 border-b border-border/60 pb-7 sm:flex-row sm:items-end sm:justify-between">
              <div className="max-w-2xl">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">
                    <LockIcon className="size-3" aria-hidden />
                    {t("aiDetector.privacyBadge")}
                  </Badge>
                  <Badge variant="warning">{t("aiDetector.betaBadge")}</Badge>
                </div>
                <h1 className="font-heading text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                  {t("aiDetector.title")}
                </h1>
                <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
                  {t("aiDetector.description")}
                </p>
              </div>
              <label className="flex min-w-48 flex-col gap-1.5 text-xs font-medium text-muted-foreground">
                {t("aiDetector.language.label")}
                <select
                  value={language}
                  onChange={(event) =>
                    setLanguage(event.target.value as AiDetectorLanguagePreference)
                  }
                  disabled={busy}
                  className="h-9 rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="auto">{t("aiDetector.language.auto")}</option>
                  <option value="en">{t("aiDetector.language.en")}</option>
                  <option value="zh-Hans">{t("aiDetector.language.zh-Hans")}</option>
                </select>
              </label>
            </section>

            {error ? (
              <div
                className="flex items-start gap-3 rounded-xl border border-destructive/28 bg-destructive/6 px-4 py-3 text-sm text-destructive"
                role="alert"
              >
                <XIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span className="min-w-0 break-words">{error}</span>
              </div>
            ) : null}

            {!report ? (
              <>
                <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
                  <div className="space-y-3">
                    <div
                      onDragEnter={(event) => {
                        event.preventDefault();
                        setDragActive(true);
                      }}
                      onDragOver={(event) => event.preventDefault()}
                      onDragLeave={() => setDragActive(false)}
                      onDrop={handleDrop}
                      className={cn(
                        "relative overflow-hidden rounded-2xl border bg-background/40 transition-colors",
                        dragActive ? "border-primary bg-primary/4" : "border-border/70",
                      )}
                    >
                      {file ? (
                        <div className="flex min-h-64 flex-col items-center justify-center gap-4 p-8 text-center">
                          <div className="flex size-12 items-center justify-center rounded-xl border border-border bg-muted/30">
                            <FileIcon className="size-5 text-muted-foreground" aria-hidden />
                          </div>
                          <div>
                            <p className="max-w-md break-all text-sm font-medium text-foreground">
                              {file.name}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {formatBytes(file.size, i18n.language)}
                            </p>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setFile(null)}
                            disabled={busy}
                          >
                            {t("aiDetector.input.removeFile")}
                          </Button>
                        </div>
                      ) : (
                        <textarea
                          value={text}
                          onChange={(event) => setText(event.target.value)}
                          disabled={busy}
                          maxLength={500_000}
                          placeholder={t("aiDetector.input.placeholder")}
                          aria-label={t("aiDetector.input.textLabel")}
                          className="min-h-64 w-full resize-y bg-transparent p-5 text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground/60 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
                        />
                      )}
                      {dragActive ? (
                        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/90 text-sm font-medium text-foreground">
                          {t("aiDetector.input.dropNow")}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-3 px-1 text-xs text-muted-foreground">
                      <span>
                        {file
                          ? t("aiDetector.input.fileCount", {
                              size: formatBytes(inputCount, i18n.language),
                            })
                          : t("aiDetector.input.characterCount", { count: inputCount })}
                      </span>
                      <div className="flex items-center gap-2">
                        <span>{t("aiDetector.input.accepted")}</span>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept=".txt,.docx,.pdf,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                          className="sr-only"
                          onChange={(event) => {
                            const next = event.target.files?.[0];
                            if (next) acceptFile(next);
                            event.currentTarget.value = "";
                          }}
                        />
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={busy}
                        >
                          {t("aiDetector.input.chooseFile")}
                        </Button>
                      </div>
                    </div>
                  </div>

                  <aside className="flex flex-col gap-4 rounded-2xl border border-border/70 bg-muted/15 p-5">
                    <div>
                      <h2 className="text-sm font-medium text-foreground">
                        {t("aiDetector.before.title")}
                      </h2>
                      <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
                        {t("aiDetector.before.description")}
                      </p>
                    </div>
                    <ul className="space-y-2 text-xs leading-5 text-muted-foreground">
                      <li className="flex gap-2">
                        <span aria-hidden>—</span>
                        {t("aiDetector.before.itemLocal")}
                      </li>
                      <li className="flex gap-2">
                        <span aria-hidden>—</span>
                        {t("aiDetector.before.itemCoverage")}
                      </li>
                      <li className="flex gap-2">
                        <span aria-hidden>—</span>
                        {t("aiDetector.before.itemEstimate")}
                      </li>
                    </ul>
                    <div className="mt-auto space-y-3 border-t border-border/60 pt-4">
                      {busy && progress ? (
                        <div className="space-y-2" aria-live="polite">
                          <div className="flex items-center justify-between gap-2 text-xs">
                            <span className="flex items-center gap-2 text-foreground">
                              <Loader2Icon
                                className="size-3.5 animate-spin motion-reduce:animate-none"
                                aria-hidden
                              />
                              {t(`aiDetector.progress.${progress.stage}`)}
                            </span>
                            <span className="font-mono text-muted-foreground">
                              {progress.stage === "scoring"
                                ? `${progress.completed}/${progress.total}`
                                : `${progressPercent}%`}
                            </span>
                          </div>
                          <div className="h-1 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full rounded-full bg-primary transition-[width] duration-200 motion-reduce:transition-none"
                              style={{ width: `${progressPercent}%` }}
                            />
                          </div>
                          <Button
                            className="w-full"
                            variant="outline"
                            onClick={() => controllerRef.current?.abort()}
                          >
                            {t("aiDetector.actions.cancelAnalysis")}
                          </Button>
                        </div>
                      ) : (
                        <Button
                          className="w-full"
                          size="lg"
                          onClick={() => void runAnalysis()}
                          disabled={!requiredModelsReady || inputCount === 0}
                        >
                          <SparklesIcon aria-hidden />
                          {t("aiDetector.actions.analyze")}
                        </Button>
                      )}
                      {!requiredModelsReady ? (
                        <p className="text-center text-[11px] leading-4 text-warning">
                          {t("aiDetector.models.installRequired")}
                        </p>
                      ) : null}
                    </div>
                  </aside>
                </section>

                <section className="space-y-3 border-t border-border/60 pt-6">
                  <div>
                    <h2 className="text-sm font-medium text-foreground">
                      {t("aiDetector.models.title")}
                    </h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t("aiDetector.models.description")}
                    </p>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    {DETECTOR_MODEL_LANGUAGES.map((modelLanguage) => (
                      <ModelCard
                        key={modelLanguage}
                        language={modelLanguage}
                        model={modelFor(state, modelLanguage)}
                        busy={busy}
                        onInstall={() => void mutateModel("installModel", modelLanguage)}
                        onCancel={() => void mutateModel("cancelInstall", modelLanguage)}
                        onRemove={() => void mutateModel("removeModel", modelLanguage)}
                      />
                    ))}
                  </div>
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2 text-xs text-muted-foreground">
                    <span>
                      {t("aiDetector.cache.status", {
                        count: state?.cacheEntries ?? 0,
                        size: formatBytes(state?.cacheBytes ?? 0, i18n.language),
                      })}
                    </span>
                    <Button size="xs" variant="ghost" onClick={() => void clearDetectorCache()}>
                      {t("aiDetector.actions.clearCache")}
                    </Button>
                  </div>
                </section>
              </>
            ) : (
              <section className="space-y-7">
                <div>
                  <h2
                    ref={resultHeadingRef}
                    tabIndex={-1}
                    className="font-heading text-xl font-semibold tracking-tight text-foreground outline-none"
                  >
                    {t("aiDetector.results.title")}
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t(`aiDetector.results.assessment.${report.assessment}`)}
                  </p>
                </div>
                {report.eligibleCharacters > 0 ? (
                  <div className="grid gap-3 sm:grid-cols-3">
                    <ScoreCard
                      tone="ai"
                      label={t("aiDetector.results.likelyAi")}
                      value={report.scores.likelyAi}
                    />
                    <ScoreCard
                      tone="uncertain"
                      label={t("aiDetector.results.uncertain")}
                      value={report.scores.uncertain}
                    />
                    <ScoreCard
                      tone="human"
                      label={t("aiDetector.results.likelyHuman")}
                      value={report.scores.likelyHuman}
                    />
                  </div>
                ) : null}
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-border/70 p-4">
                    <p className="text-xs text-muted-foreground">
                      {t("aiDetector.results.confidence")}
                    </p>
                    <p className="mt-1 text-sm font-medium text-foreground">
                      {t(`aiDetector.results.confidenceLevel.${report.confidence}`)}
                    </p>
                  </div>
                  <div className="rounded-xl border border-border/70 p-4">
                    <p className="text-xs text-muted-foreground">
                      {t("aiDetector.results.eligible")}
                    </p>
                    <p className="mt-1 font-mono text-sm font-medium tabular-nums text-foreground">
                      {formatLocaleNumber(report.eligibleCharacters, i18n.language)}
                    </p>
                  </div>
                  <div className="rounded-xl border border-border/70 p-4">
                    <p className="text-xs text-muted-foreground">
                      {t("aiDetector.results.excluded")}
                    </p>
                    <p className="mt-1 font-mono text-sm font-medium tabular-nums text-foreground">
                      {formatLocaleNumber(report.excludedCharacters, i18n.language)}
                    </p>
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="text-sm font-medium text-foreground">
                      {t("aiDetector.results.evidence")}
                    </h3>
                    <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                      <span className="flex items-center gap-1.5">
                        <span className="size-2 rounded-full bg-destructive" />
                        {t("aiDetector.results.likelyAi")}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="size-2 rounded-full bg-warning" />
                        {t("aiDetector.results.uncertain")}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="size-2 rounded-full bg-success" />
                        {t("aiDetector.results.likelyHuman")}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="h-px w-3 bg-muted-foreground" />
                        {t("aiDetector.results.excluded")}
                      </span>
                    </div>
                  </div>
                  <HighlightedText report={report} />
                </div>
                {report.warnings.length > 0 ? (
                  <div className="rounded-xl border border-warning/28 bg-warning/6 p-4">
                    <h3 className="text-xs font-medium text-warning">
                      {t("aiDetector.results.notes")}
                    </h3>
                    <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-5 text-muted-foreground">
                      {report.warnings.map((warning) => (
                        <li key={warning}>
                          {t(`aiDetector.results.warning.${warning}`, {
                            defaultValue: t(
                              "aiDetector.results.warning.document-extraction-warning",
                            ),
                          })}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <div className="rounded-xl border border-border/70 bg-muted/15 p-5">
                  <p className="text-sm font-medium text-foreground">
                    {t("aiDetector.results.disclaimerTitle")}
                  </p>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">
                    {t("aiDetector.results.disclaimer")}
                  </p>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <label className="mr-auto flex items-center gap-2 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={includeText}
                        onChange={(event) => setIncludeText(event.target.checked)}
                        className="size-4 rounded border-border"
                      />
                      {t("aiDetector.export.includeText")}
                    </label>
                    <Button size="sm" variant="outline" onClick={() => void exportReport("json")}>
                      <DownloadIcon aria-hidden />
                      {t("aiDetector.export.json")}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => void exportReport("html")}>
                      <DownloadIcon aria-hidden />
                      {t("aiDetector.export.html")}
                    </Button>
                  </div>
                </div>
                <details className="rounded-xl border border-border/70 px-4 py-3 text-xs text-muted-foreground">
                  <summary className="cursor-pointer font-medium text-foreground">
                    {t("aiDetector.results.technicalDetails")}
                  </summary>
                  <div className="mt-3 space-y-2 font-mono text-[10px]">
                    <p>
                      {t("aiDetector.results.digest")}: {report.contentHash}
                    </p>
                    <p>
                      {t("aiDetector.results.preprocessing")}: {report.preprocessingVersion}
                    </p>
                    <p>
                      {t("aiDetector.results.segmentation")}: {report.segmentationVersion}
                    </p>
                    {report.modelRuns.map((run) => (
                      <p key={run.language}>
                        {run.language}: {run.model}@{run.revision.slice(0, 12)} ·{" "}
                        {run.calibrationVersion} · {run.passages}
                      </p>
                    ))}
                  </div>
                </details>
              </section>
            )}
          </div>
        </main>
      </div>
    </RouteInsetSurface>
  );
}
