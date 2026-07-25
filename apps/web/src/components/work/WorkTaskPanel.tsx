import type {
  DocumentArtifactPreview,
  DocumentIntelligenceStatus,
  OrchestrationThreadActivity,
  WorkTask,
} from "@synara/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatLocaleDateTime } from "~/i18n/intl";
import type { TimestampFormat } from "~/appSettings";
import { getTimestampFormatOptions } from "~/timestampFormat";

import { cn } from "~/lib/utils";
import { useWorkspaceFileOpener } from "~/lib/workspaceFileOpener";
import { readNativeApi } from "~/nativeApi";
import { Button } from "~/components/ui/button";
import { DisclosureChevron } from "~/components/ui/DisclosureChevron";
import { DisclosureRegion } from "~/components/ui/DisclosureRegion";

import {
  DocumentArtifactPreviewContent,
  needsDocumentReview,
} from "./DocumentArtifactPreviewContent";

import { WORK_TASK_STATUS_TONES } from "./workTaskPresentation";

type JsonRecord = Record<string, unknown>;

export type WorkUiErrorCode =
  | "localServiceConnecting"
  | "desktopConnecting"
  | "documentStatus"
  | "documentInstall"
  | "documentRepair"
  | "loadPreviews"
  | "openFile";

export interface WorkUiError {
  readonly code: WorkUiErrorCode;
  readonly detail: string | null;
}

function workErrorFromCause(code: WorkUiErrorCode, cause?: unknown): WorkUiError {
  return {
    code,
    detail: cause === undefined ? null : cause instanceof Error ? cause.message : String(cause),
  };
}

const WORK_ERROR_KEYS: Record<WorkUiErrorCode, string> = {
  localServiceConnecting: "errors.localServiceConnecting",
  desktopConnecting: "errors.desktopConnecting",
  documentStatus: "documentReader.error.check",
  documentInstall: "documentReader.error.install",
  documentRepair: "documentReader.error.repair",
  loadPreviews: "documents.errors.loadPreviews",
  openFile: "documents.errors.openFile",
};

export function WorkErrorMessage(props: {
  readonly error: WorkUiError;
  readonly className?: string;
}) {
  const { t } = useTranslation("work");
  return (
    <p className={props.className} role="alert">
      <span>{t(WORK_ERROR_KEYS[props.error.code])}</span>
      {props.error.detail ? <span className="block font-mono">{props.error.detail}</span> : null}
    </p>
  );
}

const WORK_STEPS = [
  { phase: "planning", labelKey: "task.phases.planning" },
  { phase: "working", labelKey: "task.phases.working" },
  { phase: "review", labelKey: "task.phases.review" },
  { phase: "complete", labelKey: "task.phases.complete" },
] as const;

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function capturedDeliverables(activities: ReadonlyArray<OrchestrationThreadActivity>) {
  const paths = new Set<string>();
  for (const activity of activities) {
    const payload = asRecord(activity.payload);
    const data = asRecord(payload?.data);
    const files = Array.isArray(data?.files)
      ? data.files
      : Array.isArray(payload?.files)
        ? payload.files
        : [];
    for (const value of files) {
      const file = asRecord(value);
      const path = typeof file?.path === "string" ? file.path.trim() : "";
      if (path) paths.add(path);
      if (paths.size >= 20) return [...paths];
    }
  }
  return [...paths];
}

function hasDocumentIntelligenceBlocker(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): boolean {
  return activities.some(
    (activity) => activity.kind === "work.preparation.needs_document_intelligence",
  );
}

function latestPreparedDocumentActivityId(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): string | null {
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const activity = activities[index];
    if (activity?.kind !== "work.preparation.completed") continue;
    const artifactCount = asRecord(activity.payload)?.artifactCount;
    if (typeof artifactCount === "number" && artifactCount > 0) return activity.id;
  }
  return null;
}

export function PreparedDocumentsPanel(props: {
  readonly artifacts: ReadonlyArray<DocumentArtifactPreview>;
}) {
  const { t } = useTranslation("work");
  const [open, setOpen] = useState(false);
  const reviewCount = props.artifacts.filter(needsDocumentReview).length;

  if (props.artifacts.length === 0) return null;

  return (
    <div className="rounded-lg border border-border/65 bg-background/35">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-9 w-full items-center gap-2 rounded-lg px-3 py-2 text-left outline-none hover:bg-muted/45 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring/60"
      >
        <DisclosureChevron open={open} className="size-3.5" />
        <span className="text-xs font-medium text-foreground">{t("documents.prepared.title")}</span>
        <span className="text-[11px] text-muted-foreground">{props.artifacts.length}</span>
        {reviewCount > 0 ? (
          <span className="ml-auto rounded-full border border-amber-500/30 bg-amber-500/[0.08] px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
            {t("documents.reviewRecommended")}
          </span>
        ) : null}
      </button>
      <DisclosureRegion open={open}>
        <div className="space-y-3 border-t border-border/50 px-3 py-3">
          {props.artifacts.map((artifact) => {
            return (
              <DocumentArtifactPreviewContent
                key={artifact.id}
                artifact={artifact}
                maxBlocks={12}
                compact
              />
            );
          })}
        </div>
      </DisclosureRegion>
    </div>
  );
}

interface DocumentIntelligenceStatusCardProps {
  readonly status: DocumentIntelligenceStatus | null;
  readonly busy: boolean;
  readonly error: WorkUiError | null;
  readonly onInstall: () => void;
  readonly onRepair: () => void;
}

export function DocumentIntelligenceStatusCard(props: DocumentIntelligenceStatusCardProps) {
  const { t } = useTranslation("work");
  const status = props.status;
  const canInstall = status?.state === "not_installed" && status.installAvailable;
  const canRepair = status?.state === "unhealthy" && status.installAvailable;
  const title =
    status === null
      ? t("documentReader.status.checking")
      : status.state === "ready"
        ? t("documentReader.status.ready")
        : status.state === "unhealthy"
          ? t("documentReader.status.needsRepair")
          : status.state === "not_installed"
            ? t("documentReader.status.notInstalled")
            : t("documentReader.status.unavailable");

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.06] p-3 text-xs">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-foreground" aria-live="polite">
            {title}
          </p>
          {status?.detail ? <p className="mt-1 text-muted-foreground">{status.detail}</p> : null}
          <p className="mt-1 text-muted-foreground">{t("documentReader.privacy")}</p>
          {props.error ? (
            <WorkErrorMessage error={props.error} className="mt-1 text-destructive" />
          ) : null}
        </div>
        {canInstall ? (
          <Button size="xs" disabled={props.busy} onClick={props.onInstall}>
            {props.busy
              ? t("documentReader.actions.installing")
              : t("documentReader.actions.install")}
          </Button>
        ) : null}
        {canRepair ? (
          <Button size="xs" disabled={props.busy} onClick={props.onRepair}>
            {props.busy
              ? t("documentReader.actions.repairing")
              : t("documentReader.actions.repair")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function DocumentIntelligenceGate() {
  const [status, setStatus] = useState<DocumentIntelligenceStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<WorkUiError | null>(null);

  useEffect(() => {
    let cancelled = false;
    const api = readNativeApi();
    if (!api) {
      setError(workErrorFromCause("localServiceConnecting"));
      return;
    }
    void api.work.documentIntelligence.status().then(
      (nextStatus) => {
        if (cancelled) return;
        setStatus(nextStatus);
        setError(null);
      },
      (cause: unknown) => {
        if (cancelled) return;
        setError(workErrorFromCause("documentStatus", cause));
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const runAction = useCallback(
    async (action: "install" | "repair") => {
      const api = readNativeApi();
      if (!api || busy) return;
      setBusy(true);
      setError(null);
      try {
        const nextStatus = await api.work.documentIntelligence[action]();
        setStatus(nextStatus);
      } catch (cause) {
        setError(
          workErrorFromCause(action === "install" ? "documentInstall" : "documentRepair", cause),
        );
      } finally {
        setBusy(false);
      }
    },
    [busy],
  );

  return (
    <DocumentIntelligenceStatusCard
      status={status}
      busy={busy}
      error={error}
      onInstall={() => void runAction("install")}
      onRepair={() => void runAction("repair")}
    />
  );
}

export interface WorkTaskPanelProps {
  readonly task: WorkTask;
  readonly activities: ReadonlyArray<OrchestrationThreadActivity>;
  readonly timestampFormat: TimestampFormat;
  readonly busy: boolean;
  readonly onComplete: () => void;
  readonly onRequestChanges: () => void;
  readonly onRetry: () => void;
  readonly onReopen: () => void;
  readonly onCancel: () => void;
  readonly onProvideInput: () => void;
}

export function WorkTaskPanel(props: WorkTaskPanelProps) {
  const { t, i18n } = useTranslation(["work", "common"]);
  const workspaceFileOpener = useWorkspaceFileOpener();
  const [activityOpen, setActivityOpen] = useState(false);
  const [preparedArtifacts, setPreparedArtifacts] = useState<
    ReadonlyArray<DocumentArtifactPreview>
  >([]);
  const [preparedDocumentsLoading, setPreparedDocumentsLoading] = useState(false);
  const [preparedDocumentsError, setPreparedDocumentsError] = useState<WorkUiError | null>(null);
  const [deliverableError, setDeliverableError] = useState<WorkUiError | null>(null);
  const deliverables = useMemo(() => capturedDeliverables(props.activities), [props.activities]);
  const currentStep = WORK_STEPS.findIndex((step) => step.phase === props.task.phase);
  const recentActivities = props.activities.slice(-8).toReversed();
  const documentIntelligenceBlocked =
    props.task.status === "needs_input" && hasDocumentIntelligenceBlocker(props.activities);
  const preparedDocumentActivityId = useMemo(
    () => latestPreparedDocumentActivityId(props.activities),
    [props.activities],
  );

  useEffect(() => {
    let cancelled = false;
    if (preparedDocumentActivityId === null) {
      setPreparedArtifacts([]);
      setPreparedDocumentsError(null);
      setPreparedDocumentsLoading(false);
      return () => {
        cancelled = true;
      };
    }

    const api = readNativeApi();
    if (!api) {
      setPreparedDocumentsError(workErrorFromCause("localServiceConnecting"));
      return () => {
        cancelled = true;
      };
    }

    setPreparedDocumentsLoading(true);
    setPreparedDocumentsError(null);
    void api.work.listPreparedDocuments({ threadId: props.task.threadId }).then(
      (result) => {
        if (cancelled) return;
        setPreparedArtifacts(result.artifacts);
        setPreparedDocumentsLoading(false);
      },
      (cause: unknown) => {
        if (cancelled) return;
        setPreparedDocumentsError(workErrorFromCause("loadPreviews", cause));
        setPreparedDocumentsLoading(false);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [preparedDocumentActivityId, props.task.threadId]);
  const openDeliverable = useCallback(
    async (deliverablePath: string) => {
      if (workspaceFileOpener?.openFile(deliverablePath)) {
        setDeliverableError(null);
        return;
      }
      const api = readNativeApi();
      if (!api) {
        setDeliverableError(workErrorFromCause("desktopConnecting"));
        return;
      }
      try {
        const resolved = await api.work.resolveArtifactPath({
          threadId: props.task.threadId,
          path: deliverablePath,
        });
        if (api.shell.openPath) await api.shell.openPath(resolved.path);
        else await api.shell.showInFolder(resolved.path);
        setDeliverableError(null);
      } catch (cause) {
        setDeliverableError(workErrorFromCause("openFile", cause));
      }
    },
    [props.task.threadId, workspaceFileOpener],
  );

  return (
    <section
      aria-label={t("task.progressLabel", { ns: "work" })}
      className="max-h-[45vh] shrink-0 overflow-y-auto overscroll-contain border-b border-border/65 bg-[color-mix(in_srgb,var(--color-background-surface)_94%,var(--color-background-elevated-secondary)_6%)] px-4 py-3 sm:px-5"
    >
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span
            aria-live="polite"
            className={cn(
              "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium",
              WORK_TASK_STATUS_TONES[props.task.status],
            )}
          >
            {t(`task.status.${props.task.status}`, { ns: "work" })}
          </span>
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {props.task.statusReason ?? t("task.preparing", { ns: "work" })}
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            {props.task.status === "working" ? (
              <Button
                size="xs"
                variant="destructive-outline"
                disabled={props.busy}
                onClick={props.onCancel}
              >
                {t("actions.cancel", { ns: "common" })}
              </Button>
            ) : null}
            {props.task.status === "needs_input" ? (
              <Button
                size="xs"
                variant="primary-outline"
                disabled={props.busy}
                onClick={props.onProvideInput}
              >
                {t("task.actions.provideInput", { ns: "work" })}
              </Button>
            ) : null}
            {props.task.status === "needs_review" ? (
              <>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={props.busy}
                  onClick={props.onRequestChanges}
                >
                  {t("task.actions.requestChanges", { ns: "work" })}
                </Button>
                <Button size="xs" disabled={props.busy} onClick={props.onComplete}>
                  {t("task.actions.complete", { ns: "work" })}
                </Button>
              </>
            ) : null}
            {props.task.status === "failed" || props.task.status === "cancelled" ? (
              <Button size="xs" disabled={props.busy} onClick={props.onRetry}>
                {t("actions.retry", { ns: "common" })}
              </Button>
            ) : null}
            {props.task.status === "complete" ? (
              <Button size="xs" variant="outline" disabled={props.busy} onClick={props.onReopen}>
                {t("task.actions.reopen", { ns: "work" })}
              </Button>
            ) : null}
          </div>
        </div>

        <div
          role="progressbar"
          aria-label={t("task.completionLabel", { ns: "work" })}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={props.task.progress}
          className="h-1.5 overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-200 ease-out motion-reduce:transition-none"
            style={{ width: `${props.task.progress}%` }}
          />
        </div>

        <ol className="grid grid-cols-4 gap-2" aria-label={t("task.phasesLabel", { ns: "work" })}>
          {WORK_STEPS.map((step, index) => {
            const reached = index <= currentStep;
            const current = index === currentStep && props.task.phase !== "complete";
            return (
              <li
                key={step.phase}
                aria-current={current ? "step" : undefined}
                className={cn(
                  "flex min-w-0 items-center gap-1.5 text-[11px]",
                  reached ? "text-foreground" : "text-muted-foreground/65",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    reached ? "bg-primary" : "bg-muted-foreground/30",
                  )}
                />
                <span className="truncate">{t(step.labelKey, { ns: "work" })}</span>
              </li>
            );
          })}
        </ol>

        {documentIntelligenceBlocked ? <DocumentIntelligenceGate /> : null}

        {preparedDocumentsLoading ? (
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {t("documents.loadingPreviews", { ns: "work" })}
          </p>
        ) : null}
        {preparedDocumentsError ? (
          <WorkErrorMessage error={preparedDocumentsError} className="text-xs text-destructive" />
        ) : null}
        <PreparedDocumentsPanel artifacts={preparedArtifacts} />

        {deliverables.length > 0 ? (
          <div className="border-t border-border/50 pt-3">
            <h3 className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t("task.deliverables", { ns: "work" })}
            </h3>
            <ul className="space-y-1 text-xs">
              {deliverables.map((path) => (
                <li key={path}>
                  <button
                    type="button"
                    onClick={() => void openDeliverable(path)}
                    className="block w-full truncate rounded px-1 py-0.5 text-left font-mono text-[11px] text-foreground/85 outline-none hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring/60"
                    title={t("documents.openNamed", { ns: "work", name: path })}
                  >
                    {path}
                  </button>
                </li>
              ))}
            </ul>
            {deliverableError ? (
              <WorkErrorMessage
                error={deliverableError}
                className="mt-1 text-[11px] text-destructive"
              />
            ) : null}
          </div>
        ) : null}

        {recentActivities.length > 0 ? (
          <div className="border-t border-border/50 pt-2">
            <button
              type="button"
              aria-expanded={activityOpen}
              onClick={() => setActivityOpen((open) => !open)}
              className="flex min-h-7 items-center gap-1.5 rounded-md px-1 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring/60"
            >
              <DisclosureChevron open={activityOpen} className="size-3" />
              {t("task.activityCount", { ns: "work", count: recentActivities.length })}
            </button>
            <DisclosureRegion open={activityOpen}>
              <ol className="space-y-1 pb-1 pl-5 pt-1 text-[11px] text-muted-foreground">
                {recentActivities.map((activity) => (
                  <li key={activity.id} className="flex items-baseline gap-2">
                    <span className="truncate text-foreground/85">{activity.summary}</span>
                    <time
                      className="ml-auto shrink-0"
                      data-testid="work-activity-timestamp"
                      dateTime={activity.createdAt}
                    >
                      {formatLocaleDateTime(
                        activity.createdAt,
                        i18n.resolvedLanguage || i18n.language,
                        {
                          ...getTimestampFormatOptions(props.timestampFormat, false),
                        },
                      )}
                    </time>
                  </li>
                ))}
              </ol>
            </DisclosureRegion>
          </div>
        ) : null}
      </div>
    </section>
  );
}
