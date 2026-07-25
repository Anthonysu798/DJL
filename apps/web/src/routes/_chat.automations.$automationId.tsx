import {
  type AutomationDefinition,
  type AutomationRun,
  type AutomationUpdateInput,
  type AutomationWorktreeMode,
  type ModelSelection,
  type ProviderOptionDescriptor,
} from "@synara/contracts";
import {
  getModelCapabilities,
  getProviderOptionCurrentValue,
  getProviderOptionDescriptors,
} from "@synara/shared/model";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { getProviderStartOptions, useAppSettings, type TimestampFormat } from "~/appSettings";
import { formatLocaleDateTime } from "~/i18n/intl";
import { getTimestampFormatOptions } from "~/timestampFormat";
import {
  CHAT_SURFACE_HEADER_DIVIDER_CLASS_NAME,
  CHAT_SURFACE_HEADER_HEIGHT_CLASS,
  CHAT_SURFACE_HEADER_PADDING_X_CLASS,
} from "~/components/chat/chatHeaderControls";
import { CHAT_BACKGROUND_CLASS_NAME } from "~/components/chat/composerPickerStyles";
import { SidebarHeaderNavigationControls } from "~/components/SidebarHeaderNavigationControls";
import { Button } from "~/components/ui/button";
import { RouteInsetSurface } from "~/components/RouteInsetSurface";
import {
  automationApprovalGaps,
  hasBlockingAutomationDraftWarnings,
  warningIdsForAcknowledgedRisks,
  type AutomationDraftWarning,
  type AutomationDraftWarningId,
} from "~/lib/automationDraft";
import {
  completionPolicyFromStopWhen,
  stopWhenFromCompletionPolicy,
} from "~/lib/automationCompletionPolicy";
import { automationLifecycleState, canPauseAutomation } from "~/lib/automationStatus";
import {
  useDesktopTopBarTrafficLightGutterClassName,
  useDesktopTopBarWindowControlsGutterClassName,
} from "~/hooks/useDesktopTopBarGutter";
import { CentralIcon } from "~/lib/central-icons";
import { cn } from "~/lib/utils";
import {
  buildModelSelection,
  buildNextProviderOptions,
  buildProviderOptionPatch,
  type ProviderOptions,
} from "~/providerModelOptions";
import { ensureNativeApi } from "~/nativeApi";
import { useStore } from "~/store";
import {
  type AutomationFormState,
  AutomationApprovalBanner,
  AutomationDialog,
  AutomationModelPicker,
  acknowledgedRiskIdsForFormWarnings,
  buildAutomationFormWarnings,
  canCancelAutomationRun,
  datetimeLocalFromIso,
  formatRelativeTime,
  formFromDefinition,
  isoFromDatetimeLocal,
  isRowInteractiveEventTarget,
  isTriageRun,
  isFormSubmittable,
  maxIterationOptions,
  providerOptionsForAutomationEdit,
  providerOptionsForAutomationModelSelection,
  runResultSummary,
  runStatusLabel,
  RunStatusIndicator,
  SCHEDULE_KIND_OPTIONS,
  scheduleFromKind,
  scheduleKindFromSchedule,
  updateWeeklyScheduleDay,
  updateWeeklyScheduleTime,
  updateInputFromForm,
  useAutomations,
  weekdayLabel,
} from "./-automations.shared";
import { resolveThreadPickerTitle } from "./-chatThreadRoute.logic";
import { translateRendererCopy } from "~/i18n";

const detailCopy = (key: string, defaultValue: string, values?: Record<string, unknown>) =>
  translateRendererCopy(`work:automations.${key}`, defaultValue, values);

export const Route = createFileRoute("/_chat/automations/$automationId")({
  component: AutomationDetailView,
});

function lastFinishedRun(runs: readonly AutomationRun[]): AutomationRun | null {
  return runs.find((run) => run.finishedAt != null || run.startedAt != null) ?? null;
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

// Reference-style absolute timestamp: "Today at 09:00", "Tomorrow at 12:30", "5 May 2026, 09:05".
function formatRunTimestamp(
  value: string | null,
  locale: string,
  timestampFormat: TimestampFormat,
): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const time = formatLocaleDateTime(
    date,
    locale,
    getTimestampFormatOptions(timestampFormat, false),
  );
  const dayDelta = Math.round((startOfDay(date) - startOfDay(new Date())) / 86_400_000);
  if (dayDelta === 0) return detailCopy("timestamps.today", "Today at {{time}}", { time });
  if (dayDelta === 1) return detailCopy("timestamps.tomorrow", "Tomorrow at {{time}}", { time });
  if (dayDelta === -1) return detailCopy("timestamps.yesterday", "Yesterday at {{time}}", { time });
  return formatLocaleDateTime(date, locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...getTimestampFormatOptions(timestampFormat, false),
  });
}

// Presentation for the Status pill: maps the shared lifecycle state to a label and dot color.
// The state decision lives in ~/lib/automationStatus so this pill and the list never drift.
function automationStatusDisplay(definition: AutomationDefinition): {
  readonly label: string;
  readonly dotClassName: string;
} {
  switch (automationLifecycleState(definition)) {
    case "active":
      return { label: detailCopy("lifecycle.active", "Active"), dotClassName: "bg-emerald-500" };
    case "paused":
      return { label: detailCopy("lifecycle.paused", "Paused"), dotClassName: "bg-amber-500" };
    case "scheduled":
      return { label: detailCopy("lifecycle.scheduled", "Scheduled"), dotClassName: "bg-sky-500" };
    case "done":
      return { label: detailCopy("lifecycle.done", "Done"), dotClassName: "bg-muted-foreground" };
  }
}

type SelectOption = { readonly value: string; readonly label: string };

const WORKTREE_OPTIONS: readonly SelectOption[] = [
  {
    value: "auto",
    get label() {
      return detailCopy("worktreeMode.auto", "Auto");
    },
  },
  {
    value: "local",
    get label() {
      return detailCopy("worktreeMode.local", "Local");
    },
  },
  {
    value: "worktree",
    get label() {
      return detailCopy("worktreeMode.worktree", "Worktree");
    },
  },
];

const INTERVAL_PRESETS: readonly SelectOption[] = [
  {
    value: "900",
    get label() {
      return detailCopy("intervalPresets.m15", "Every 15 min");
    },
  },
  {
    value: "1800",
    get label() {
      return detailCopy("intervalPresets.m30", "Every 30 min");
    },
  },
  {
    value: "3600",
    get label() {
      return detailCopy("intervalPresets.h1", "Every hour");
    },
  },
  {
    value: "7200",
    get label() {
      return detailCopy("intervalPresets.h2", "Every 2 hours");
    },
  },
  {
    value: "21600",
    get label() {
      return detailCopy("intervalPresets.h6", "Every 6 hours");
    },
  },
  {
    value: "43200",
    get label() {
      return detailCopy("intervalPresets.h12", "Every 12 hours");
    },
  },
  {
    value: "86400",
    get label() {
      return detailCopy("intervalPresets.h24", "Every 24 hours");
    },
  },
];

function intervalOptions(current: number): readonly SelectOption[] {
  if (INTERVAL_PRESETS.some((option) => option.value === String(current))) {
    return INTERVAL_PRESETS;
  }
  const label = detailCopy(
    current >= 60 && current % 60 === 0 ? "interval.everyMinutes" : "interval.everySeconds",
    current >= 60 && current % 60 === 0 ? "Every {{count}} min" : "Every {{count}} sec",
    { count: current >= 60 && current % 60 === 0 ? current / 60 : current },
  );
  return [{ value: String(current), label }, ...INTERVAL_PRESETS];
}

function AutomationDetailView() {
  const { t, i18n } = useTranslation(["work", "common"]);
  const { automationId } = Route.useParams();
  const navigate = useNavigate();
  const { settings } = useAppSettings();
  const desktopTopBarTrafficLightGutterClassName = useDesktopTopBarTrafficLightGutterClassName();
  const desktopTopBarWindowControlsGutterClassName =
    useDesktopTopBarWindowControlsGutterClassName();
  const projects = useStore((state) => state.projects);
  const threads = useStore((state) => state.threads);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<AutomationFormState | null>(null);
  const [dialogWarnings, setDialogWarnings] = useState<readonly AutomationDraftWarning[]>([]);
  const [acknowledgedWarningIds, setAcknowledgedWarningIds] = useState<
    ReadonlySet<AutomationDraftWarningId>
  >(() => new Set());

  const {
    data,
    updateMutation,
    deleteMutation,
    runNowMutation,
    cancelRunMutation,
    markRunReadMutation,
    archiveRunMutation,
    runsByAutomationId,
    // Running an automation keeps the user on this info page; the live run surfaces in
    // "Previous runs" (click a run there to open its thread), matching the reference UX.
  } = useAutomations();

  const definition = data.definitions.find((candidate) => candidate.id === automationId) ?? null;
  const runs = useMemo(
    () => runsByAutomationId.get(automationId) ?? [],
    [runsByAutomationId, automationId],
  );
  const providerOptionsForDispatch = useMemo(() => getProviderStartOptions(settings), [settings]);

  useEffect(() => {
    if (!dialogOpen || !form) return;
    setDialogWarnings(buildAutomationFormWarnings(form));
  }, [dialogOpen, form, i18n.resolvedLanguage]);

  if (!definition) {
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
              CHAT_SURFACE_HEADER_PADDING_X_CLASS,
              CHAT_SURFACE_HEADER_DIVIDER_CLASS_NAME,
              "drag-region",
              desktopTopBarTrafficLightGutterClassName,
              desktopTopBarWindowControlsGutterClassName,
            )}
          >
            <div
              className={cn("flex items-center gap-2 sm:gap-3", CHAT_SURFACE_HEADER_HEIGHT_CLASS)}
            >
              <SidebarHeaderNavigationControls />
              <h1 className="truncate font-heading text-sm font-medium">
                {t("automations.title", { ns: "work" })}
              </h1>
            </div>
          </header>
          <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
            {t("automations.detail.notFound", { ns: "work" })}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void navigate({ to: "/automations" })}
            >
              {t("automations.detail.back", { ns: "work" })}
            </Button>
          </main>
        </div>
      </RouteInsetSurface>
    );
  }

  const project = projects.find((candidate) => candidate.id === definition.projectId);
  const targetThread = threads.find((candidate) => candidate.id === definition.targetThreadId);
  const sourceThread = definition.sourceThreadId
    ? threads.find((candidate) => candidate.id === definition.sourceThreadId)
    : null;
  const lastRun = lastFinishedRun(runs);
  const schedule = definition.schedule;
  const status = automationStatusDisplay(definition);
  const stopWhen = stopWhenFromCompletionPolicy(definition.completionPolicy ?? { type: "none" });

  const patch = (input: Omit<AutomationUpdateInput, "id">) =>
    updateMutation.mutate({ id: definition.id, ...input });

  // One-time risk approval surfaced at the top of the panel when an already-created
  // automation still needs it (e.g. created via the API). Persists on the automation.
  const approvalGaps = automationApprovalGaps({
    schedule: definition.schedule,
    enabled: definition.enabled,
    maxIterations: definition.maxIterations,
    mode: definition.mode,
    runtimeMode: definition.runtimeMode,
    worktreeMode: definition.worktreeMode,
    prompt: definition.prompt,
    acknowledgedRisks: definition.acknowledgedRisks,
  });
  const approveAutomationRisks = () =>
    // Records consent and any server-required fast-loop cap. Pause/resume stays separate so
    // approving never silently re-enables an automation the user deliberately paused.
    updateMutation.mutateAsync({
      id: definition.id,
      acknowledgedRisks: approvalGaps.acknowledgedRisks,
      ...(approvalGaps.maxIterations !== undefined
        ? { maxIterations: approvalGaps.maxIterations }
        : {}),
    });
  const handleApproveAndRunNow = async () => {
    try {
      await approveAutomationRisks();
    } catch {
      return; // update failed; the mutation already surfaced the error toast
    }
    runNowMutation.mutate(definition);
  };
  const approvalBusy = updateMutation.isPending || runNowMutation.isPending;

  // Applying a new model selection (model swap or a capability tweak) refreshes the saved
  // provider start options the same way the model picker does, then patches both at once.
  const applyModelSelection = (nextModelSelection: ModelSelection) => {
    const providerOptions = providerOptionsForAutomationModelSelection(
      definition,
      nextModelSelection,
      providerOptionsForDispatch,
    );
    patch({
      modelSelection: nextModelSelection,
      ...(providerOptions ? { providerOptions } : {}),
    });
  };

  const openEditDialog = (overrides: Partial<AutomationFormState> = {}) => {
    const nextForm = {
      ...formFromDefinition(definition, project?.id ?? projects[0]?.id ?? ""),
      ...overrides,
    };
    setForm(nextForm);
    setDialogWarnings(buildAutomationFormWarnings(nextForm));
    setAcknowledgedWarningIds(warningIdsForAcknowledgedRisks(definition.acknowledgedRisks));
    setDialogOpen(true);
  };

  const updateDialogForm = (nextForm: AutomationFormState) => {
    setForm(nextForm);
    setDialogWarnings(buildAutomationFormWarnings(nextForm));
  };

  const toggleWarning = (id: AutomationDraftWarningId, checked: boolean) => {
    setAcknowledgedWarningIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  };

  const submitForm = () => {
    if (!form || !isFormSubmittable(form)) return;
    if (hasBlockingAutomationDraftWarnings(dialogWarnings, acknowledgedWarningIds)) return;
    const acknowledgedRisks = acknowledgedRiskIdsForFormWarnings(
      dialogWarnings,
      acknowledgedWarningIds,
    );
    updateMutation.mutate(
      updateInputFromForm(
        definition,
        form,
        providerOptionsForAutomationEdit(definition, form, providerOptionsForDispatch),
        acknowledgedRisks,
      ),
      {
        onSuccess: () => setDialogOpen(false),
      },
    );
  };

  const togglePause = () => {
    updateMutation.mutate({ id: definition.id, enabled: !definition.enabled });
  };

  const deleteDefinition = async () => {
    const confirmed = await ensureNativeApi().dialogs.confirm(
      t("automations.detail.deleteConfirm", { ns: "work", name: definition.name }),
    );
    if (!confirmed) return;
    deleteMutation.mutate(definition, {
      onSuccess: () => void navigate({ to: "/automations" }),
    });
  };

  return (
    <RouteInsetSurface>
      <div
        className={cn(
          "flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden",
          CHAT_BACKGROUND_CLASS_NAME,
        )}
      >
        {/* Left column: breadcrumb header + the prompt. */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <header
            className={cn(
              CHAT_SURFACE_HEADER_PADDING_X_CLASS,
              CHAT_SURFACE_HEADER_DIVIDER_CLASS_NAME,
              "drag-region",
              desktopTopBarTrafficLightGutterClassName,
            )}
          >
            <div
              className={cn("flex items-center gap-2 sm:gap-3", CHAT_SURFACE_HEADER_HEIGHT_CLASS)}
            >
              <SidebarHeaderNavigationControls />
              <div className="flex min-w-0 flex-1 items-center gap-1.5 text-sm [-webkit-app-region:no-drag]">
                <button
                  type="button"
                  onClick={() => void navigate({ to: "/automations" })}
                  className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                >
                  {t("automations.title", { ns: "work" })}
                </button>
                <CentralIcon
                  name="chevron-right-small"
                  className="size-3.5 shrink-0 text-muted-foreground"
                />
                <span className="truncate font-heading font-medium">{definition.name}</span>
              </div>
            </div>
          </header>

          <main className="min-h-0 flex-1 overflow-y-auto px-6 py-8 sm:px-8">
            <div className="max-w-3xl space-y-4">
              <h1 className="font-heading text-2xl font-normal text-foreground">
                {definition.name}
              </h1>
              <p className="whitespace-pre-wrap text-[0.9375rem] leading-relaxed text-muted-foreground">
                {definition.prompt}
              </p>
            </div>
          </main>
        </div>

        {/* Right column: action header + details panel. The header carries the shared bottom
            hairline (horizontal), and the body below carries the vertical seam — so the vertical
            line starts at the header's bottom edge instead of running up through it. Both use the
            same --app-surface-divider token and meet cleanly at the corner. */}
        <div className="flex min-h-0 w-80 shrink-0 flex-col overflow-hidden">
          <header
            className={cn(
              CHAT_SURFACE_HEADER_PADDING_X_CLASS,
              CHAT_SURFACE_HEADER_DIVIDER_CLASS_NAME,
              "drag-region",
              desktopTopBarWindowControlsGutterClassName,
            )}
          >
            <div
              className={cn(
                "flex items-center justify-end gap-2 sm:gap-3",
                CHAT_SURFACE_HEADER_HEIGHT_CLASS,
              )}
            >
              <div className="flex shrink-0 items-center gap-1 [-webkit-app-region:no-drag]">
                {canPauseAutomation(definition) ? (
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t(
                      definition.enabled
                        ? "automations.actions.pause"
                        : "automations.actions.resume",
                      { ns: "work" },
                    )}
                    title={t(
                      definition.enabled
                        ? "automations.actions.pause"
                        : "automations.actions.resume",
                      { ns: "work" },
                    )}
                    onClick={togglePause}
                  >
                    <CentralIcon name={definition.enabled ? "pause" : "play"} className="size-4" />
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={t("actions.delete", { ns: "common" })}
                  title={t("actions.delete", { ns: "common" })}
                  onClick={() => void deleteDefinition()}
                >
                  <CentralIcon name="trash-can-simple" className="size-4" />
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="ml-1.5"
                  disabled={
                    runNowMutation.isPending ||
                    // Stay disabled while an approval update is in flight: the cache merges
                    // acknowledgedRisks optimistically, so warnings clears before the server
                    // persists and a run dispatched in that window hits the old definition.
                    updateMutation.isPending ||
                    approvalGaps.runBlockingWarnings.length > 0
                  }
                  title={
                    approvalGaps.runBlockingWarnings.length > 0
                      ? t("automations.detail.approveFirst", { ns: "work" })
                      : undefined
                  }
                  onClick={() => runNowMutation.mutate(definition)}
                >
                  <CentralIcon name="play" className="size-4" />
                  {t("automations.actions.runNow", { ns: "work" })}
                </Button>
              </div>
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto border-l border-[var(--app-surface-divider)]">
            <div className="flex flex-col gap-6 px-4 py-8">
              <AutomationApprovalBanner
                warnings={approvalGaps.warnings}
                busy={approvalBusy}
                // Swallow the rejection here; the mutation's onError already toasts. Without
                // this, void-ing the rejected promise would surface an unhandled rejection.
                onApprove={() => void approveAutomationRisks().catch(() => undefined)}
                onApproveAndRun={() => void handleApproveAndRunNow()}
              />
              <DetailGroup title={t("automations.fields.status", { ns: "work" })}>
                <DetailRow label={t("automations.fields.status", { ns: "work" })}>
                  <StatusValue>
                    <span className={cn("size-1.5 rounded-full", status.dotClassName)} />
                    {status.label}
                  </StatusValue>
                </DetailRow>
                <DetailRow label={t("automations.fields.nextRun", { ns: "work" })}>
                  {definition.enabled && definition.nextRunAt ? (
                    <StatusValue tone="muted">
                      {formatRunTimestamp(
                        definition.nextRunAt,
                        i18n.resolvedLanguage || i18n.language,
                        settings.timestampFormat,
                      )}
                    </StatusValue>
                  ) : (
                    "—"
                  )}
                </DetailRow>
                <DetailRow label={t("automations.fields.lastRan", { ns: "work" })}>
                  {lastRun ? (
                    <StatusValue tone="muted">
                      {formatRunTimestamp(
                        lastRun.finishedAt ?? lastRun.startedAt,
                        i18n.resolvedLanguage || i18n.language,
                        settings.timestampFormat,
                      )}
                    </StatusValue>
                  ) : (
                    "—"
                  )}
                </DetailRow>
              </DetailGroup>

              <DetailGroup title={t("automations.detail.details", { ns: "work" })}>
                {definition.mode === "heartbeat" ? (
                  <DetailRow label={t("automations.fields.runsIn", { ns: "work" })}>
                    {t("automations.fields.thread", { ns: "work" })}
                  </DetailRow>
                ) : (
                  <EditRow
                    label={
                      <>
                        {t("automations.fields.runsIn", { ns: "work" })}
                        <CentralIcon
                          name="info-simple"
                          className="size-3 text-muted-foreground/60"
                          aria-label={t("automations.detail.runsInDescription", { ns: "work" })}
                        />
                      </>
                    }
                  >
                    <InlineSelect
                      value={definition.worktreeMode}
                      options={WORKTREE_OPTIONS}
                      onChange={(value) => {
                        if (
                          (value === "local" || value === "auto") &&
                          !definition.acknowledgedRisks.includes("local-checkout")
                        ) {
                          openEditDialog({ worktreeMode: value as AutomationWorktreeMode });
                          return;
                        }
                        patch({ worktreeMode: value as AutomationWorktreeMode });
                      }}
                    />
                  </EditRow>
                )}
                {definition.mode === "heartbeat" ? (
                  <DetailRow label={t("automations.fields.project", { ns: "work" })}>
                    {project?.name ?? t("automations.detail.unknownProject", { ns: "work" })}
                  </DetailRow>
                ) : (
                  <EditRow label={t("automations.fields.project", { ns: "work" })}>
                    <InlineSelect
                      value={definition.projectId}
                      options={projects.map((entry) => ({ value: entry.id, label: entry.name }))}
                      onChange={(value) =>
                        patch({ projectId: value as AutomationDefinition["projectId"] })
                      }
                    />
                  </EditRow>
                )}
                {definition.sourceThreadId ? (
                  <DetailRow label={t("automations.fields.createdFrom", { ns: "work" })}>
                    {sourceThread ? (
                      <button
                        type="button"
                        onClick={() =>
                          void navigate({
                            to: "/$threadId",
                            params: { threadId: sourceThread.id },
                          })
                        }
                        className="min-w-0 truncate text-right text-foreground transition-colors hover:text-primary"
                      >
                        {resolveThreadPickerTitle(sourceThread.title)}
                      </button>
                    ) : (
                      t("automations.detail.threadUnavailable", { ns: "work" })
                    )}
                  </DetailRow>
                ) : null}
                <EditRow label={t("automations.fields.repeats", { ns: "work" })}>
                  <InlineSelect
                    value={scheduleKindFromSchedule(schedule)}
                    options={SCHEDULE_KIND_OPTIONS}
                    onChange={(value) =>
                      patch({
                        schedule: scheduleFromKind(
                          value as (typeof SCHEDULE_KIND_OPTIONS)[number]["value"],
                          schedule,
                        ),
                      })
                    }
                  />
                </EditRow>
                {schedule.type === "interval" && schedule.everySeconds !== 3600 ? (
                  <EditRow label={t("automations.fields.every", { ns: "work" })}>
                    <InlineSelect
                      value={String(schedule.everySeconds)}
                      options={intervalOptions(schedule.everySeconds)}
                      onChange={(value) =>
                        patch({
                          schedule: { type: "interval", everySeconds: Number.parseInt(value, 10) },
                        })
                      }
                    />
                  </EditRow>
                ) : null}
                {schedule.type === "once" ? (
                  <EditRow label={t("automations.fields.runAt", { ns: "work" })}>
                    <input
                      type="datetime-local"
                      value={datetimeLocalFromIso(schedule.runAt)}
                      onChange={(event) =>
                        event.target.value
                          ? patch({
                              schedule: {
                                type: "once",
                                runAt: isoFromDatetimeLocal(event.target.value),
                              },
                            })
                          : undefined
                      }
                      className={INLINE_CONTROL_CLASS}
                    />
                  </EditRow>
                ) : null}
                {schedule.type === "cron" ? (
                  <EditRow label={t("automations.fields.cron", { ns: "work" })}>
                    <InlineCommitTextInput
                      value={schedule.expression}
                      onCommit={(value) =>
                        patch({
                          schedule: {
                            type: "cron",
                            expression: value,
                            timezone: schedule.timezone,
                          },
                        })
                      }
                      className="font-mono"
                    />
                  </EditRow>
                ) : null}
                {schedule.type === "daily" || schedule.type === "weekdays" ? (
                  <EditRow label={t("automations.fields.time", { ns: "work" })}>
                    <InlineTime
                      value={schedule.timeOfDay}
                      onChange={(value) =>
                        value ? patch({ schedule: { ...schedule, timeOfDay: value } }) : undefined
                      }
                    />
                  </EditRow>
                ) : null}
                {schedule.type === "weekly" ? (
                  <>
                    <EditRow label={t("automations.fields.day", { ns: "work" })}>
                      <InlineSelect
                        value={String(schedule.dayOfWeek)}
                        options={[0, 1, 2, 3, 4, 5, 6].map((day) => ({
                          value: String(day),
                          label: weekdayLabel(day),
                        }))}
                        onChange={(value) =>
                          patch({
                            schedule: updateWeeklyScheduleDay(schedule, Number.parseInt(value, 10)),
                          })
                        }
                      />
                    </EditRow>
                    <EditRow label={t("automations.fields.time", { ns: "work" })}>
                      <InlineTime
                        value={schedule.timeOfDay}
                        onChange={(value) =>
                          value
                            ? patch({
                                schedule: updateWeeklyScheduleTime(schedule, value),
                              })
                            : undefined
                        }
                      />
                    </EditRow>
                  </>
                ) : null}
                {(schedule.type === "daily" ||
                  schedule.type === "weekdays" ||
                  schedule.type === "weekly" ||
                  schedule.type === "cron") &&
                schedule.timezone ? (
                  <EditRow label={t("automations.fields.timezone", { ns: "work" })}>
                    <InlineCommitTextInput
                      value={schedule.timezone}
                      onCommit={(value) => patch({ schedule: { ...schedule, timezone: value } })}
                    />
                  </EditRow>
                ) : null}
                <EditRow label={t("automations.fields.model", { ns: "work" })}>
                  <AutomationModelPicker
                    value={definition.modelSelection}
                    projectCwd={project?.cwd ?? null}
                    onChange={applyModelSelection}
                  />
                </EditRow>
                <ModelOptionRows
                  modelSelection={definition.modelSelection}
                  onChange={applyModelSelection}
                />
                <DetailRow label={t("automations.fields.mode", { ns: "work" })}>
                  {t(
                    definition.mode === "heartbeat"
                      ? "automations.mode.heartbeat"
                      : "automations.mode.standalone",
                    { ns: "work" },
                  )}
                </DetailRow>
                {definition.mode === "heartbeat" ? (
                  <EditRow label={t("automations.fields.stopWhen", { ns: "work" })}>
                    <InlineCommitTextInput
                      value={stopWhen}
                      placeholder={t("automations.detail.never", { ns: "work" })}
                      onCommit={(value) =>
                        patch({
                          completionPolicy: completionPolicyFromStopWhen(value),
                        })
                      }
                    />
                  </EditRow>
                ) : null}
                <EditRow label={t("automations.fields.maxIterations", { ns: "work" })}>
                  <InlineSelect
                    value={definition.maxIterations == null ? "" : String(definition.maxIterations)}
                    options={maxIterationOptions(definition.maxIterations)}
                    onChange={(value) =>
                      patch({ maxIterations: value === "" ? null : Number.parseInt(value, 10) })
                    }
                  />
                </EditRow>
                {definition.mode === "heartbeat" ? (
                  <DetailRow label={t("automations.fields.thread", { ns: "work" })}>
                    {targetThread
                      ? resolveThreadPickerTitle(targetThread.title)
                      : t("automations.detail.threadUnavailable", { ns: "work" })}
                  </DetailRow>
                ) : null}
              </DetailGroup>

              <DetailGroup title={t("automations.detail.previousRuns", { ns: "work" })}>
                {runs.length === 0 ? (
                  <div className="px-1.5 py-1 text-xs text-muted-foreground">
                    {t("automations.detail.noRuns", { ns: "work" })}
                  </div>
                ) : (
                  <div className="flex flex-col gap-0.5">
                    {runs.map((run) => (
                      <RunRow
                        key={run.id}
                        run={run}
                        onOpen={(threadId) =>
                          void navigate({ to: "/$threadId", params: { threadId } })
                        }
                        onCancel={() => cancelRunMutation.mutate(run)}
                        onMarkRead={(unread) => markRunReadMutation.mutate({ run, unread })}
                        onArchive={(archived) => archiveRunMutation.mutate({ run, archived })}
                      />
                    ))}
                  </div>
                )}
              </DetailGroup>
            </div>
          </div>
        </div>
      </div>

      {form ? (
        <AutomationDialog
          open={dialogOpen}
          editing
          form={form}
          projects={projects}
          threads={threads}
          warnings={dialogWarnings}
          acknowledgedWarningIds={acknowledgedWarningIds}
          onToggleWarning={toggleWarning}
          onOpenChange={setDialogOpen}
          onFormChange={updateDialogForm}
          onSubmit={submitForm}
          busy={updateMutation.isPending}
        />
      ) : null}
    </RouteInsetSurface>
  );
}

function DetailGroup({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section className="space-y-0.5">
      <h2 className="px-1.5 pb-1 text-xs font-medium text-muted-foreground/70">{title}</h2>
      <div className="flex flex-col">{children}</div>
    </section>
  );
}

function DetailRow({
  label,
  children,
}: {
  readonly label: React.ReactNode;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md px-1.5 py-1.5 text-xs">
      <span className="flex shrink-0 items-center gap-1 text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right text-foreground">{children}</span>
    </div>
  );
}

// Read-only Status group values (Active/Next run/Last ran). The reference renders these as
// plain right-aligned text — the status as foreground, timestamps muted — with no chip behind
// them, so the value column stays quiet and flush to the right.
function StatusValue({
  tone = "default",
  children,
}: {
  readonly tone?: "default" | "muted";
  readonly children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5",
        tone === "muted" ? "text-muted-foreground" : "text-foreground",
      )}
    >
      {children}
    </span>
  );
}

function EditRow({
  label,
  children,
}: {
  readonly label: React.ReactNode;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md py-px pl-1.5 pr-0.5 text-xs transition-colors hover:bg-foreground/[0.04]">
      <span className="flex shrink-0 items-center gap-1 text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

const INLINE_CONTROL_CLASS =
  "cursor-pointer rounded-md bg-transparent px-2 py-1.5 text-right text-xs text-foreground outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring";

function InlineSelect({
  value,
  options,
  onChange,
}: {
  readonly value: string;
  readonly options: readonly SelectOption[];
  readonly onChange: (value: string) => void;
}) {
  return (
    <div className="relative flex min-w-0 items-center">
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={cn(INLINE_CONTROL_CLASS, "max-w-[11rem] appearance-none truncate pr-5")}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <CentralIcon
        name="chevron-down-small"
        className="pointer-events-none absolute right-1 size-3 text-muted-foreground"
      />
    </div>
  );
}

function InlineToggle({
  value,
  onChange,
}: {
  readonly value: boolean;
  readonly onChange: (value: boolean) => void;
}) {
  const { t } = useTranslation("work");
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={cn(INLINE_CONTROL_CLASS, "min-w-[3rem]")}
    >
      {t(value ? "automations.toggle.on" : "automations.toggle.off")}
    </button>
  );
}

/**
 * Inline edit rows for the selected model's capabilities — reasoning effort, fast mode,
 * thinking, context window, etc. The knobs are derived from the provider's capability
 * descriptors, so each provider surfaces exactly the controls it supports (and none when it
 * supports nothing). Changing a value reuses the same model-selection patch path as the
 * model picker, keeping provider start options in sync.
 */
function ModelOptionRows({
  modelSelection,
  onChange,
}: {
  readonly modelSelection: ModelSelection;
  readonly onChange: (next: ModelSelection) => void;
}) {
  const { provider, model } = modelSelection;
  const caps = getModelCapabilities(provider, model);
  const descriptors = getProviderOptionDescriptors({
    provider,
    caps,
    selections: modelSelection.options as Record<string, unknown> | undefined,
  });
  if (descriptors.length === 0) {
    return null;
  }

  const setOption = (descriptor: ProviderOptionDescriptor, value: string | boolean) => {
    const optionPatch = buildProviderOptionPatch(provider, descriptor.id, value);
    const nextOptions = buildNextProviderOptions(
      provider,
      modelSelection.options as ProviderOptions | undefined,
      optionPatch,
    );
    onChange(buildModelSelection(provider, model, nextOptions));
  };

  return (
    <>
      {descriptors.map((descriptor) => {
        if (descriptor.type === "boolean") {
          return (
            <EditRow key={descriptor.id} label={descriptor.label}>
              <InlineToggle
                value={getProviderOptionCurrentValue(descriptor) === true}
                onChange={(checked) => setOption(descriptor, checked)}
              />
            </EditRow>
          );
        }
        const current = getProviderOptionCurrentValue(descriptor);
        return (
          <EditRow key={descriptor.id} label={descriptor.label}>
            <InlineSelect
              value={typeof current === "string" ? current : ""}
              options={descriptor.options.map((option) => ({
                value: option.id,
                label: option.label,
              }))}
              onChange={(value) => setOption(descriptor, value)}
            />
          </EditRow>
        );
      })}
    </>
  );
}

function InlineTime({
  value,
  onChange,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <input
      type="time"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={INLINE_CONTROL_CLASS}
    />
  );
}

// Keeps free-text schedule fields editable while intermediate cron/timezone text is invalid.
function InlineCommitTextInput({
  value,
  onCommit,
  className,
  placeholder,
}: {
  readonly value: string;
  readonly onCommit: (value: string) => void;
  readonly className?: string;
  readonly placeholder?: string;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commitDraft = () => {
    if (draft !== value) {
      onCommit(draft);
    }
  };

  return (
    <input
      value={draft}
      placeholder={placeholder}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commitDraft}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur();
        } else if (event.key === "Escape") {
          setDraft(value);
          event.currentTarget.blur();
        }
      }}
      className={cn(INLINE_CONTROL_CLASS, className)}
    />
  );
}

function RunRow({
  run,
  onOpen,
  onCancel,
  onMarkRead,
  onArchive,
}: {
  readonly run: AutomationRun;
  readonly onOpen: (threadId: NonNullable<AutomationRun["threadId"]>) => void;
  readonly onCancel: () => void;
  readonly onMarkRead: (unread: boolean) => void;
  readonly onArchive: (archived: boolean) => void;
}) {
  const { t, i18n } = useTranslation(["work", "common"]);
  const active = canCancelAutomationRun(run);
  const archived = run.result?.archivedAt !== null && run.result?.archivedAt !== undefined;
  const triageActionable = run.result !== null || isTriageRun(run);
  const unread = run.result ? run.result.unread : triageActionable;
  const openable = run.threadId != null;
  const open = () => {
    if (run.threadId) {
      onOpen(run.threadId as NonNullable<AutomationRun["threadId"]>);
    }
  };
  return (
    // The whole row opens its thread (the run's chat history); inline actions stop
    // propagation so they don't also navigate.
    <div
      role={openable ? "button" : undefined}
      tabIndex={openable ? 0 : undefined}
      onClick={openable ? open : undefined}
      onKeyDown={
        openable
          ? (event) => {
              if (isRowInteractiveEventTarget(event.target, event.currentTarget)) {
                return;
              }
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                open();
              }
            }
          : undefined
      }
      className={cn(
        "group flex items-center gap-2 rounded-md px-1.5 py-1.5 text-xs transition-colors",
        openable ? "cursor-pointer hover:bg-foreground/[0.03]" : undefined,
      )}
    >
      <RunStatusIndicator status={run.status} />
      <div className="min-w-0 flex-1 truncate">
        <span className="text-foreground/90">{runStatusLabel(run.status)}</span>
        <span className="text-muted-foreground"> · {runResultSummary(run)}</span>
      </div>
      {triageActionable ? (
        <div className="flex shrink-0 items-center gap-1.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onMarkRead(!unread);
            }}
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            {t(unread ? "automations.actions.markRead" : "automations.actions.markUnread", {
              ns: "work",
            })}
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onArchive(!archived);
            }}
            title={
              run.permissionSnapshot.worktreeMode === "local"
                ? undefined
                : t("automations.detail.archiveWorktreeNote", { ns: "work" })
            }
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            {archived
              ? t("automations.actions.unarchive", { ns: "work" })
              : t("actions.archive", { ns: "common" })}
          </button>
        </div>
      ) : null}
      {active ? (
        <Button
          type="button"
          size="icon-chip"
          variant="ghost"
          aria-label={t("automations.actions.cancelRun", { ns: "work" })}
          onClick={(event) => {
            event.stopPropagation();
            onCancel();
          }}
        >
          <CentralIcon name="stop" className="size-3.5" />
        </Button>
      ) : null}
      <span className="shrink-0 tabular-nums text-muted-foreground">
        {formatRelativeTime(
          run.finishedAt ?? run.startedAt ?? run.scheduledFor,
          i18n.resolvedLanguage || i18n.language,
        )}
      </span>
    </div>
  );
}
