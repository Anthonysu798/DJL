import {
  type AutomationCreateInput,
  type AutomationDefinition,
  type AutomationId,
  type AutomationListResult,
  type AutomationMode,
  type AutomationRun,
  type AutomationRunResult,
  type AutomationStreamEvent,
  type AutomationUpdateInput,
  type AutomationWorktreeMode,
  type ModelSelection,
  type ProviderKind,
  type RuntimeMode,
  type ThreadId,
} from "@synara/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { useAppSettings } from "~/appSettings";
import {
  ComposerPickerMenuPopup,
  ComposerPickerMenuSubPopup,
} from "~/components/chat/ComposerPickerMenuPopup";
import { ProviderModelPicker } from "~/components/chat/ProviderModelPicker";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Dialog, DialogPopup, DialogTitle } from "~/components/ui/dialog";
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubTrigger,
  MenuTrigger,
} from "~/components/ui/menu";
import { TimePicker } from "~/components/ui/time-picker";
import { toastManager } from "~/components/ui/toast";
import {
  hasBlockingAutomationDraftWarnings,
  type AutomationDraftWarning,
  type AutomationDraftWarningId,
} from "~/lib/automationDraft";
import {
  acknowledgedRiskIdsForFormWarnings,
  applyScheduleToForm,
  automationFastIntervalLimitMessage,
  buildAutomationFormWarnings,
  createInputFromForm,
  datetimeLocalFromIso,
  defaultModelSelection,
  formatCadence,
  formatClockTime,
  formatDateTime,
  formatSchedule,
  formFromDefinition,
  groupHeartbeatAutomationsByTargetThread,
  heartbeatAutomationsForThread,
  isFormSubmittable,
  isoFromDatetimeLocal,
  modelSelectionForProjectChange,
  projectModelSelection,
  providerOptionsForAutomationEdit,
  providerOptionsForAutomationModelSelection,
  scheduleFromForm,
  scheduleFromKind,
  scheduleKindFromSchedule,
  SCHEDULE_KIND_OPTIONS,
  TIME_OF_DAY_PATTERN,
  updateInputFromForm,
  updateWeeklyScheduleDay,
  updateWeeklyScheduleTime,
  weekdayLabel,
  type AutomationFormState,
  type IntervalUnit,
  type ScheduleKind,
} from "~/lib/automationForm";
import { SkillCubeIcon, WorktreeIcon } from "~/lib/icons";
import { CentralIcon } from "~/lib/central-icons";
import { resolveProviderDiscoveryCwd } from "~/lib/providerDiscovery";
import { cn } from "~/lib/utils";
import { serverConfigQueryOptions } from "~/lib/serverReactQuery";
import { ensureNativeApi } from "~/nativeApi";
import { buildModelSelection } from "~/providerModelOptions";
import { useProviderModelCatalog } from "~/hooks/useProviderModelCatalog";
import { useProviderStatusesForLocalConfig } from "~/hooks/useProviderStatusesForLocalConfig";
import { useStore } from "~/store";
import { resolveThreadPickerTitle } from "./-chatThreadRoute.logic";
import { translateRendererCopy } from "~/i18n";
import { formatLocaleRelativeTime } from "~/i18n/intl";

const automationUiCopy = (key: string, defaultValue: string, values?: Record<string, unknown>) =>
  translateRendererCopy(`work:automations.${key}`, defaultValue, values);

export const automationQueryKey = ["automations"] as const;
export const EMPTY_AUTOMATION_LIST: AutomationListResult = { definitions: [], runs: [] };

type AutomationMutationAction =
  | "create"
  | "update"
  | "delete"
  | "runNow"
  | "cancelRun"
  | "markRead"
  | "archive";

export function automationMutationErrorContent(
  action: AutomationMutationAction,
  error: Error,
  translate: (key: string) => string,
): { readonly title: string; readonly description: string } {
  return {
    title: translate(`automations.errors.${action}`),
    description: error.message,
  };
}

export {
  acknowledgedRiskIdsForFormWarnings,
  applyScheduleToForm,
  automationFastIntervalLimitMessage,
  buildAutomationFormWarnings,
  createInputFromForm,
  datetimeLocalFromIso,
  defaultModelSelection,
  formatCadence,
  formatClockTime,
  formatDateTime,
  formatSchedule,
  formFromDefinition,
  groupHeartbeatAutomationsByTargetThread,
  heartbeatAutomationsForThread,
  isFormSubmittable,
  isoFromDatetimeLocal,
  modelSelectionForProjectChange,
  projectModelSelection,
  providerOptionsForAutomationEdit,
  providerOptionsForAutomationModelSelection,
  scheduleFromForm,
  scheduleFromKind,
  scheduleKindFromSchedule,
  SCHEDULE_KIND_OPTIONS,
  TIME_OF_DAY_PATTERN,
  updateInputFromForm,
  updateWeeklyScheduleDay,
  updateWeeklyScheduleTime,
  weekdayLabel,
  type AutomationFormState,
  type IntervalUnit,
  type ScheduleKind,
};

/** Starter prompts surfaced behind the composer's "Use template" button. */
export const AUTOMATION_TEMPLATES: readonly {
  readonly label: string;
  readonly name: string;
  readonly prompt: string;
}[] = [
  {
    get label() {
      return automationUiCopy("templates.crashes.label", "Triage new crashes");
    },
    get name() {
      return automationUiCopy("templates.crashes.name", "Triage crashes");
    },
    get prompt() {
      return automationUiCopy(
        "templates.crashes.prompt",
        "Look for new crashes in $sentry and open a fix PR for the most impactful one.",
      );
    },
  },
  {
    get label() {
      return automationUiCopy("templates.dependencies.label", "Update dependencies");
    },
    get name() {
      return automationUiCopy("templates.dependencies.name", "Update dependencies");
    },
    get prompt() {
      return automationUiCopy(
        "templates.dependencies.prompt",
        "Check for outdated dependencies, bump the safe minor and patch versions, then run the tests.",
      );
    },
  },
  {
    get label() {
      return automationUiCopy("templates.summary.label", "Daily standup summary");
    },
    get name() {
      return automationUiCopy("templates.summary.name", "Daily summary");
    },
    get prompt() {
      return automationUiCopy(
        "templates.summary.prompt",
        "Summarize what changed on the main branch in the last 24 hours as a short standup update.",
      );
    },
  },
];

export function formatRelativeTime(iso: string | null, locale: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  const options = { numeric: "auto", style: "short" } as const;
  if (seconds < 60) return formatLocaleRelativeTime(0, "second", locale, options);
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return formatLocaleRelativeTime(-minutes, "minute", locale, options);
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return formatLocaleRelativeTime(-hours, "hour", locale, options);
  const days = Math.floor(hours / 24);
  if (days < 7) return formatLocaleRelativeTime(-days, "day", locale, options);
  const weeks = Math.floor(days / 7);
  if (weeks < 4) return formatLocaleRelativeTime(-weeks, "week", locale, options);
  return formatLocaleRelativeTime(-Math.floor(days / 30), "month", locale, options);
}

export function runStatusVariant(
  status: AutomationRun["status"],
): "success" | "warning" | "error" | "info" | "outline" {
  switch (status) {
    case "succeeded":
      return "success";
    case "failed":
    case "cancelled":
    case "interrupted":
      return "error";
    case "waiting-for-approval":
    case "skipped":
      return "warning";
    case "running":
    case "claimed":
    case "pending":
      return "info";
  }
}

/** Status-colored dot/icon class for a single run, shared by the detail history and triage rows. */
export function runStatusDotClassName(status: AutomationRun["status"]): string {
  switch (runStatusVariant(status)) {
    case "success":
      return "text-emerald-500";
    case "error":
      return "text-destructive";
    case "warning":
      return "text-amber-500";
    case "info":
      return "text-blue-500";
    case "outline":
      return "text-muted-foreground/50";
  }
}

/**
 * True when a click/keydown originated from an interactive control nested inside a clickable
 * row (delete button, link, input, etc.) rather than the row surface itself. Row components use
 * it to let inner controls handle their own events without also triggering the row's action.
 */
export function isRowInteractiveEventTarget(
  target: EventTarget | null,
  currentTarget: HTMLElement,
): boolean {
  if (!(target instanceof HTMLElement) || target === currentTarget) {
    return false;
  }
  return Boolean(target.closest("button,a,input,textarea,select,[contenteditable='true']"));
}

/**
 * Leading status glyph for a single run row: a quiet check for success, otherwise a
 * status-colored dot. Shared by the detail history and the list triage rows so both
 * surfaces read identically.
 */
export function RunStatusIndicator({
  status,
  className,
}: {
  readonly status: AutomationRun["status"];
  readonly className?: string;
}) {
  if (runStatusVariant(status) === "success") {
    return (
      <CentralIcon
        name="circle-check"
        className={cn("size-3.5 shrink-0 text-muted-foreground/70", className)}
      />
    );
  }
  return (
    <span
      className={cn(
        "flex size-3.5 shrink-0 items-center justify-center",
        runStatusDotClassName(status),
        className,
      )}
    >
      <span className="block size-1.5 rounded-full bg-current" />
    </span>
  );
}

export function isTriageRun(run: AutomationRun): boolean {
  if (run.result) {
    return isUnresolvedTriageResult(run.result);
  }
  return (
    run.status === "failed" ||
    run.status === "cancelled" ||
    run.status === "interrupted" ||
    run.status === "waiting-for-approval"
  );
}

export function isUnresolvedTriageResult(result: AutomationRunResult | null): boolean {
  return Boolean(result && result.unread && result.archivedAt === null);
}

export function unresolvedTriageRuns(runs: readonly AutomationRun[]): AutomationRun[] {
  return runs.filter((run) => isTriageRun(run));
}

export function allVisibleTriageRuns(runs: readonly AutomationRun[]): AutomationRun[] {
  return runs.filter((run) => {
    if (run.result) {
      return run.result.archivedAt === null;
    }
    return isTriageRun(run);
  });
}

export function automationAttentionCount(runs: readonly AutomationRun[]): number {
  return unresolvedTriageRuns(runs).length;
}

export function runStatusLabel(status: AutomationRun["status"]): string {
  switch (status) {
    case "pending":
      return automationUiCopy("runStatus.pending", "Queued");
    case "claimed":
      return automationUiCopy("runStatus.claimed", "Starting");
    case "running":
      return automationUiCopy("runStatus.running", "Running");
    case "waiting-for-approval":
      return automationUiCopy("runStatus.waitingForApproval", "Waiting for approval");
    case "succeeded":
      return automationUiCopy("runStatus.succeeded", "Completed");
    case "failed":
      return automationUiCopy("runStatus.failed", "Failed");
    case "cancelled":
      return automationUiCopy("runStatus.cancelled", "Cancelled");
    case "interrupted":
      return automationUiCopy("runStatus.interrupted", "Interrupted");
    case "skipped":
      return automationUiCopy("runStatus.skipped", "Skipped");
  }
}

export function runResultSummary(run: AutomationRun): string {
  if (run.result?.summary) return run.result.summary;
  if (run.error) return run.error;
  switch (run.result?.outcome) {
    case "findings":
      return automationUiCopy("result.findings", "Found something to review");
    case "no-findings":
      return automationUiCopy("result.noFindings", "No findings");
    case "changed-files":
      return automationUiCopy("result.changedFiles", "Changed files");
    case "needs-attention":
      return automationUiCopy("result.needsAttention", "Needs attention");
    case "unknown":
      return run.threadId
        ? automationUiCopy("result.completedOpenThread", "Completed; open the thread for the reply")
        : automationUiCopy("runStatus.succeeded", "Completed");
    case undefined:
      return runStatusLabel(run.status);
  }
}

export function canCancelAutomationRun(run: AutomationRun): boolean {
  return (
    run.status === "pending" ||
    run.status === "claimed" ||
    run.status === "running" ||
    run.status === "waiting-for-approval"
  );
}

export function automationStatusDotClass(
  definition: AutomationDefinition,
  latestRun: AutomationRun | null,
): string {
  if (!definition.enabled) return "text-muted-foreground/40";
  if (
    latestRun?.status === "running" ||
    latestRun?.status === "pending" ||
    latestRun?.status === "claimed"
  ) {
    return "text-blue-500";
  }
  if (latestRun && isTriageRun(latestRun)) return "text-destructive";
  return "text-emerald-500";
}

const deletedAutomationIdsInCache = new Set<string>();

function isNewerTimestamp(candidate: string, existing: string): boolean {
  return candidate.localeCompare(existing) > 0;
}

// Snapshots are reconciliation data, so equal timestamps keep the live cache winner.
function isSameOrNewerTimestamp(candidate: string, existing: string): boolean {
  return candidate.localeCompare(existing) >= 0;
}

function mergeDefinitionsByUpdatedAt(
  snapshotDefinitions: readonly AutomationDefinition[],
  previousDefinitions: readonly AutomationDefinition[],
): AutomationDefinition[] {
  const previousById = new Map(
    previousDefinitions.map((definition) => [definition.id, definition]),
  );
  const seen = new Set<string>();
  const definitions: AutomationDefinition[] = [];
  for (const snapshotDefinition of snapshotDefinitions) {
    if (deletedAutomationIdsInCache.has(snapshotDefinition.id)) {
      continue;
    }
    seen.add(snapshotDefinition.id);
    const previousDefinition = previousById.get(snapshotDefinition.id);
    definitions.push(
      previousDefinition &&
        isSameOrNewerTimestamp(previousDefinition.updatedAt, snapshotDefinition.updatedAt)
        ? previousDefinition
        : snapshotDefinition,
    );
  }
  return definitions;
}

function upsertDefinitionByUpdatedAt(
  definitions: readonly AutomationDefinition[],
  incoming: AutomationDefinition,
): AutomationDefinition[] {
  const existing = definitions.find((definition) => definition.id === incoming.id);
  if (existing && isNewerTimestamp(existing.updatedAt, incoming.updatedAt)) {
    return [...definitions];
  }
  return existing
    ? definitions.map((definition) => (definition.id === incoming.id ? incoming : definition))
    : [incoming, ...definitions];
}

function mergeRunsByUpdatedAt(
  snapshotRuns: readonly AutomationRun[],
  previousRuns: readonly AutomationRun[],
  visibleAutomationIds?: ReadonlySet<AutomationId>,
): AutomationRun[] {
  const previousById = new Map(previousRuns.map((run) => [run.id, run]));
  const runs: AutomationRun[] = [];
  for (const snapshotRun of snapshotRuns) {
    if (
      deletedAutomationIdsInCache.has(snapshotRun.automationId) ||
      (visibleAutomationIds && !visibleAutomationIds.has(snapshotRun.automationId))
    ) {
      continue;
    }
    const previousRun = previousById.get(snapshotRun.id);
    runs.push(
      previousRun && isSameOrNewerTimestamp(previousRun.updatedAt, snapshotRun.updatedAt)
        ? previousRun
        : snapshotRun,
    );
  }
  return runs;
}

function upsertRunByUpdatedAt(
  runs: readonly AutomationRun[],
  incoming: AutomationRun,
): AutomationRun[] {
  const existing = runs.find((run) => run.id === incoming.id);
  if (existing && isNewerTimestamp(existing.updatedAt, incoming.updatedAt)) {
    return [...runs];
  }
  return existing
    ? runs.map((run) => (run.id === incoming.id ? incoming : run))
    : [incoming, ...runs];
}

export function applyAutomationEvent(
  prev: AutomationListResult | undefined,
  event: AutomationStreamEvent,
): AutomationListResult {
  const base = prev ?? EMPTY_AUTOMATION_LIST;
  switch (event.type) {
    case "snapshot": {
      const definitions = mergeDefinitionsByUpdatedAt(event.definitions, base.definitions);
      const visibleAutomationIds = new Set(definitions.map((definition) => definition.id));
      return {
        definitions,
        runs: mergeRunsByUpdatedAt(event.runs, base.runs, visibleAutomationIds),
      };
    }
    case "definition-upserted": {
      if (deletedAutomationIdsInCache.has(event.definition.id)) {
        return base;
      }
      deletedAutomationIdsInCache.delete(event.definition.id);
      const definitions = upsertDefinitionByUpdatedAt(base.definitions, event.definition);
      return { definitions, runs: base.runs };
    }
    case "definition-deleted":
      deletedAutomationIdsInCache.add(event.automationId);
      return {
        definitions: base.definitions.filter((definition) => definition.id !== event.automationId),
        runs: base.runs.filter((run) => run.automationId !== event.automationId),
      };
    case "run-upserted": {
      if (deletedAutomationIdsInCache.has(event.run.automationId)) {
        return base;
      }
      const runs = upsertRunByUpdatedAt(base.runs, event.run);
      return { definitions: base.definitions, runs };
    }
  }
}

export function useAutomations(onRunStarted?: (threadId: ThreadId) => void) {
  const { t } = useTranslation("work");
  const queryClient = useQueryClient();
  const showMutationError = (key: AutomationMutationAction, error: Error) =>
    toastManager.add({
      type: "error",
      ...automationMutationErrorContent(key, error, (translationKey) => t(translationKey)),
    });

  const automationsQuery = useQuery({
    queryKey: automationQueryKey,
    queryFn: () => ensureNativeApi().automation.list({}),
  });
  const data = automationsQuery.data ?? EMPTY_AUTOMATION_LIST;

  useEffect(() => {
    const api = ensureNativeApi();
    return api.automation.onEvent((event) => {
      queryClient.setQueryData<AutomationListResult>(automationQueryKey, (prev) =>
        applyAutomationEvent(prev, event),
      );
    });
  }, [queryClient]);

  const createMutation = useMutation({
    mutationFn: (input: AutomationCreateInput) => ensureNativeApi().automation.create(input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: automationQueryKey }),
    onError: (error) => showMutationError("create", error),
  });
  const updateMutation = useMutation({
    mutationFn: (input: AutomationUpdateInput) => ensureNativeApi().automation.update(input),
    // Optimistically merge the patch so inline edits on the detail page feel instant; the
    // server's authoritative definition (with recomputed nextRunAt) arrives via the stream.
    onMutate: (input) => {
      const previous = queryClient.getQueryData<AutomationListResult>(automationQueryKey);
      queryClient.setQueryData<AutomationListResult>(automationQueryKey, (prev) => {
        const base = prev ?? EMPTY_AUTOMATION_LIST;
        return {
          definitions: base.definitions.map((definition) =>
            definition.id === input.id
              ? ({ ...definition, ...input } as AutomationDefinition)
              : definition,
          ),
          runs: base.runs,
        };
      });
      return { previous };
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: automationQueryKey }),
    onError: (error, _input, context) => {
      // A failed update would otherwise leave the incomplete optimistic merge in the cache
      // until the next stream tick; restore the pre-edit snapshot so the UI reflects reality.
      if (context?.previous) {
        queryClient.setQueryData<AutomationListResult>(automationQueryKey, context.previous);
      }
      showMutationError("update", error);
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (definition: AutomationDefinition) =>
      ensureNativeApi().automation.delete({ id: definition.id }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: automationQueryKey }),
    onError: (error) => showMutationError("delete", error),
  });
  const runNowMutation = useMutation({
    mutationFn: (definition: AutomationDefinition) =>
      ensureNativeApi().automation.runNow({ automationId: definition.id }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: automationQueryKey });
      if (result.run.threadId) onRunStarted?.(result.run.threadId);
    },
    onError: (error) => showMutationError("runNow", error),
  });
  const cancelRunMutation = useMutation({
    mutationFn: (run: AutomationRun) => ensureNativeApi().automation.cancelRun({ runId: run.id }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: automationQueryKey }),
    onError: (error) => showMutationError("cancelRun", error),
  });
  const markRunReadMutation = useMutation({
    mutationFn: (input: { readonly run: AutomationRun; readonly unread: boolean }) =>
      ensureNativeApi().automation.markRunRead({ runId: input.run.id, unread: input.unread }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: automationQueryKey }),
    onError: (error) => showMutationError("markRead", error),
  });
  const archiveRunMutation = useMutation({
    mutationFn: (input: { readonly run: AutomationRun; readonly archived: boolean }) =>
      ensureNativeApi().automation.archiveRun({ runId: input.run.id, archived: input.archived }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: automationQueryKey }),
    onError: (error) => showMutationError("archive", error),
  });

  const runsByAutomationId = useMemo(() => {
    const map = new Map<string, AutomationRun[]>();
    for (const run of data.runs) {
      const runs = map.get(run.automationId) ?? [];
      runs.push(run);
      map.set(run.automationId, runs);
    }
    for (const runs of map.values()) {
      runs.sort((left, right) => right.scheduledFor.localeCompare(left.scheduledFor));
    }
    return map;
  }, [data.runs]);

  return {
    data,
    isLoading: automationsQuery.isLoading,
    refetch: automationsQuery.refetch,
    createMutation,
    updateMutation,
    deleteMutation,
    runNowMutation,
    cancelRunMutation,
    markRunReadMutation,
    archiveRunMutation,
    runsByAutomationId,
  };
}

/** Subtle labeled pill used in the automation composer toolbar. */
const CHIP_CLASS =
  "gap-1.5 rounded-lg px-2 font-normal text-[var(--color-text-foreground-secondary)]";
type CadenceOption = { readonly value: string; readonly label: string };
type IntervalCadenceOption = {
  readonly amount: string;
  readonly unit: IntervalUnit;
  readonly label: string;
};

/** Interval cadence presets shown by default; second-level intervals are preserved when present. */
const INTERVAL_PRESETS: readonly IntervalCadenceOption[] = [
  {
    amount: "15",
    unit: "minutes",
    get label() {
      return automationUiCopy("intervalPresets.m15", "Every 15 min");
    },
  },
  {
    amount: "30",
    unit: "minutes",
    get label() {
      return automationUiCopy("intervalPresets.m30", "Every 30 min");
    },
  },
  {
    amount: "120",
    unit: "minutes",
    get label() {
      return automationUiCopy("intervalPresets.h2", "Every 2 hours");
    },
  },
  {
    amount: "360",
    unit: "minutes",
    get label() {
      return automationUiCopy("intervalPresets.h6", "Every 6 hours");
    },
  },
  {
    amount: "720",
    unit: "minutes",
    get label() {
      return automationUiCopy("intervalPresets.h12", "Every 12 hours");
    },
  },
  {
    amount: "1440",
    unit: "minutes",
    get label() {
      return automationUiCopy("intervalPresets.h24", "Every 24 hours");
    },
  },
];

function intervalOptionValue(option: Pick<IntervalCadenceOption, "amount" | "unit">): string {
  return `${option.unit}:${option.amount}`;
}

function intervalOptionLabel(amount: string, unit: IntervalUnit): string {
  return unit === "seconds"
    ? automationUiCopy("interval.everySeconds", "Every {{count}} sec", { count: amount })
    : automationUiCopy("interval.everyMinutes", "Every {{count}} min", { count: amount });
}

/** Heartbeat run-count presets ("" = unlimited). */
const MAX_ITERATION_PRESETS: readonly CadenceOption[] = [
  {
    value: "",
    get label() {
      return automationUiCopy("maxIterations.unlimited", "Unlimited");
    },
  },
  {
    value: "10",
    get label() {
      return automationUiCopy("maxIterations.runs", "{{count}} runs", { count: 10 });
    },
  },
  {
    value: "25",
    get label() {
      return automationUiCopy("maxIterations.runs", "{{count}} runs", { count: 25 });
    },
  },
  {
    value: "50",
    get label() {
      return automationUiCopy("maxIterations.runs", "{{count}} runs", { count: 50 });
    },
  },
  {
    value: "100",
    get label() {
      return automationUiCopy("maxIterations.runs", "{{count}} runs", { count: 100 });
    },
  },
  {
    value: "250",
    get label() {
      return automationUiCopy("maxIterations.runs", "{{count}} runs", { count: 250 });
    },
  },
];

function maxIterationLabel(value: string): string {
  const count = Number(value);
  return automationUiCopy("maxIterations.runs", count === 1 ? "{{count}} run" : "{{count}} runs", {
    count,
  });
}

export function maxIterationOptions(
  currentValue: string | number | null | undefined,
): readonly { readonly value: string; readonly label: string }[] {
  const value = currentValue == null ? "" : String(currentValue).trim();
  if (!/^\d+$/.test(value) || MAX_ITERATION_PRESETS.some((preset) => preset.value === value)) {
    return MAX_ITERATION_PRESETS;
  }
  return [{ value, label: maxIterationLabel(value) }, ...MAX_ITERATION_PRESETS];
}

// Shown at the top of an automation's detail panel when saving or manual run actions need
// one-time risk approval.
export function AutomationApprovalBanner({
  warnings,
  busy,
  onApprove,
  onApproveAndRun,
}: {
  readonly warnings: readonly AutomationDraftWarning[];
  readonly busy: boolean;
  readonly onApprove: () => void;
  readonly onApproveAndRun: () => void;
}) {
  const { t } = useTranslation("work");
  if (warnings.length === 0) {
    return null;
  }
  return (
    <Alert variant="warning">
      <AlertTitle>{t("automations.approval.title")}</AlertTitle>
      <AlertDescription>
        <span>{t("automations.approval.description")}</span>
        <ul className="flex flex-col gap-1.5">
          {warnings.map((warning) => (
            <li key={warning.id} className="text-xs">
              <span className="font-medium text-foreground/90">{warning.title}</span>
              <span className="block">{warning.detail}</span>
            </li>
          ))}
        </ul>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onApprove}>
            {t("automations.approval.approve")}
          </Button>
          <Button type="button" size="sm" disabled={busy} onClick={onApproveAndRun}>
            {t("automations.approval.approveAndRun")}
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}

export function AutomationModelPicker({
  value,
  projectCwd,
  onChange,
}: {
  readonly value: ModelSelection;
  readonly projectCwd: string | null;
  readonly onChange: (value: ModelSelection) => void;
}) {
  const { settings } = useAppSettings();
  const serverConfigQuery = useQuery(serverConfigQueryOptions());
  const providerStatuses = useProviderStatusesForLocalConfig();
  const [open, setOpen] = useState(false);
  const modelHintByProvider = useMemo<Partial<Record<ProviderKind, string | null>>>(
    () => ({ [value.provider]: value.model }),
    [value.model, value.provider],
  );
  const providerModelDiscoveryCwd = resolveProviderDiscoveryCwd({
    activeThreadWorktreePath: null,
    activeProjectCwd: projectCwd,
    serverCwd: serverConfigQuery.data?.cwd ?? null,
  });
  const { modelOptionsByProvider, loadingModelProviders } = useProviderModelCatalog({
    selectedProvider: value.provider,
    discoveryEnabled: open,
    cwd: providerModelDiscoveryCwd,
    modelHintByProvider,
  });

  return (
    <ProviderModelPicker
      compact
      provider={value.provider}
      model={value.model}
      lockedProvider={null}
      providers={providerStatuses}
      modelOptionsByProvider={modelOptionsByProvider}
      loadingModelProviders={loadingModelProviders}
      hiddenProviders={settings.hiddenProviders}
      providerOrder={settings.providerOrder}
      open={open}
      onOpenChange={setOpen}
      onProviderModelChange={(provider, model) => onChange(buildModelSelection(provider, model))}
    />
  );
}

export function AutomationDialog({
  open,
  editing,
  form,
  projects,
  threads,
  warnings = [],
  acknowledgedWarningIds = new Set(),
  onOpenChange,
  onFormChange,
  onToggleWarning,
  onSubmit,
  busy,
}: {
  readonly open: boolean;
  readonly editing: boolean;
  readonly form: AutomationFormState;
  readonly projects: ReturnType<typeof useStore.getState>["projects"];
  readonly threads: ReturnType<typeof useStore.getState>["threads"];
  readonly warnings?: readonly AutomationDraftWarning[];
  readonly acknowledgedWarningIds?: ReadonlySet<AutomationDraftWarningId>;
  readonly onOpenChange: (open: boolean) => void;
  readonly onFormChange: (form: AutomationFormState) => void;
  readonly onToggleWarning?: (id: AutomationDraftWarningId, checked: boolean) => void;
  readonly onSubmit: () => void;
  readonly busy: boolean;
}) {
  const { t, i18n } = useTranslation(["work", "common"]);
  const { settings } = useAppSettings();
  const setField = <K extends keyof AutomationFormState>(key: K, value: AutomationFormState[K]) =>
    onFormChange({ ...form, [key]: value });
  const projectThreads = threads.filter((thread) => thread.projectId === form.projectId);
  const selectedProject = projects.find((project) => project.id === form.projectId);
  const schedule = scheduleFromForm(form);
  const fastIntervalLimitMessage = automationFastIntervalLimitMessage(form);
  const hasBlockingWarning = hasBlockingAutomationDraftWarnings(warnings, acknowledgedWarningIds);
  const submittable = isFormSubmittable(form) && !hasBlockingWarning;
  const intervalValue = intervalOptionValue({
    amount: form.intervalAmount,
    unit: form.intervalUnit,
  });
  const maxIterationPresets = maxIterationOptions(form.maxIterations);
  const intervalPresets = INTERVAL_PRESETS.some(
    (preset) => intervalOptionValue(preset) === intervalValue,
  )
    ? INTERVAL_PRESETS
    : [
        {
          amount: form.intervalAmount,
          unit: form.intervalUnit,
          label: intervalOptionLabel(form.intervalAmount, form.intervalUnit),
        },
        ...INTERVAL_PRESETS,
      ];

  const chooseProject = (projectId: string) => {
    const targetStillMatches =
      form.targetThreadId.length > 0 &&
      threads.some((thread) => thread.id === form.targetThreadId && thread.projectId === projectId);
    onFormChange({
      ...form,
      projectId,
      modelSelection: modelSelectionForProjectChange(
        projects,
        form.projectId,
        projectId,
        form.modelSelection,
      ),
      targetThreadId: targetStillMatches ? form.targetThreadId : "",
    });
  };

  const applyTemplate = (template: (typeof AUTOMATION_TEMPLATES)[number]) =>
    onFormChange({
      ...form,
      name: form.name.trim() ? form.name : template.name,
      prompt: template.prompt,
    });

  const submit = () => {
    if (busy || !submittable) return;
    onSubmit();
  };
  const handleOpenChange = (nextOpen: boolean) => {
    if (busy && !nextOpen) return;
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogPopup surface="solid" showCloseButton={false} className="max-w-3xl">
        <DialogTitle className="sr-only">
          {editing
            ? t("automations.dialog.edit", { ns: "work" })
            : t("automations.dialog.new", { ns: "work" })}
        </DialogTitle>

        <div className="flex items-start gap-3 px-5 pt-5">
          <input
            value={form.name}
            onChange={(event) => setField("name", event.target.value)}
            placeholder={t("automations.dialog.titlePlaceholder", { ns: "work" })}
            aria-label={t("automations.dialog.titlePlaceholder", { ns: "work" })}
            autoFocus
            className="min-w-0 flex-1 bg-transparent py-1 font-system-ui text-lg font-medium text-foreground outline-none placeholder:text-muted-foreground/50"
          />
          <div className="flex shrink-0 items-center gap-1.5">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("automations.dialog.aboutLabel", { ns: "work" })}
              title={t("automations.dialog.aboutDescription", { ns: "work" })}
            >
              <CentralIcon name="info-simple" className="size-4" />
            </Button>
            <Menu>
              <MenuTrigger render={<Button variant="outline" size="sm" />}>
                {t("automations.dialog.useTemplate", { ns: "work" })}
              </MenuTrigger>
              <ComposerPickerMenuPopup align="end" className="w-52">
                {AUTOMATION_TEMPLATES.map((template) => (
                  <MenuItem key={template.label} onClick={() => applyTemplate(template)}>
                    {template.label}
                  </MenuItem>
                ))}
              </ComposerPickerMenuPopup>
            </Menu>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("actions.close", { ns: "common" })}
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              <CentralIcon name="cross-small" className="size-4" />
            </Button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-3">
          <textarea
            value={form.prompt}
            onChange={(event) => setField("prompt", event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                submit();
              }
            }}
            placeholder={t("automations.dialog.promptPlaceholder", { ns: "work" })}
            aria-label={t("automations.dialog.promptLabel", { ns: "work" })}
            className="min-h-[15rem] w-full flex-1 resize-none overflow-y-auto bg-transparent font-system-ui text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/50"
          />

          {warnings.length > 0 ? (
            <div className="mt-2 flex flex-col gap-1.5 border-t border-border/50 pt-3">
              {warnings.map((warning) => (
                <label
                  key={warning.id}
                  className="flex items-start gap-2 text-xs text-muted-foreground"
                >
                  {warning.requiresAcknowledgement ? (
                    <input
                      type="checkbox"
                      checked={acknowledgedWarningIds.has(warning.id)}
                      onChange={(event) => onToggleWarning?.(warning.id, event.target.checked)}
                      className="mt-0.5"
                    />
                  ) : (
                    <span className="mt-1 size-1.5 shrink-0 rounded-full bg-amber-500" />
                  )}
                  <span className="min-w-0">
                    <span className="font-medium text-foreground">{warning.title}</span>
                    <span className="block">{warning.detail}</span>
                  </span>
                </label>
              ))}
            </div>
          ) : null}
          {fastIntervalLimitMessage ? (
            <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-700 dark:text-amber-300">
              {fastIntervalLimitMessage}
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2 px-4 pb-4 pt-1">
          <div className="flex flex-1 flex-wrap items-center gap-0.5">
            {form.mode === "standalone" ? (
              <Menu>
                <MenuTrigger render={<Button variant="ghost" size="sm" className={CHIP_CLASS} />}>
                  <WorktreeIcon className="size-4" />
                  <span>{t(`automations.worktreeMode.${form.worktreeMode}`, { ns: "work" })}</span>
                  <CentralIcon name="chevron-down-small" className="size-3.5 opacity-60" />
                </MenuTrigger>
                <ComposerPickerMenuPopup align="start" className="w-40">
                  <MenuRadioGroup
                    value={form.worktreeMode}
                    onValueChange={(value) =>
                      setField("worktreeMode", value as AutomationWorktreeMode)
                    }
                  >
                    {(["auto", "worktree", "local"] as const).map((value) => (
                      <MenuRadioItem key={value} value={value}>
                        <span>{t(`automations.worktreeMode.${value}`, { ns: "work" })}</span>
                      </MenuRadioItem>
                    ))}
                  </MenuRadioGroup>
                </ComposerPickerMenuPopup>
              </Menu>
            ) : null}

            <Menu>
              <MenuTrigger render={<Button variant="ghost" size="sm" className={CHIP_CLASS} />}>
                <CentralIcon name="folder-2" className="size-4" />
                <span className="max-w-[10rem] truncate">
                  {selectedProject?.name ?? t("automations.dialog.selectProject", { ns: "work" })}
                </span>
                <CentralIcon name="chevron-down-small" className="size-3.5 opacity-60" />
              </MenuTrigger>
              <ComposerPickerMenuPopup align="start" className="w-56">
                <MenuRadioGroup value={form.projectId} onValueChange={chooseProject}>
                  {projects.map((project) => (
                    <MenuRadioItem key={project.id} value={project.id}>
                      <span className="truncate">{project.name}</span>
                    </MenuRadioItem>
                  ))}
                </MenuRadioGroup>
              </ComposerPickerMenuPopup>
            </Menu>

            <AutomationModelPicker
              value={form.modelSelection}
              projectCwd={selectedProject?.cwd ?? null}
              onChange={(value) => setField("modelSelection", value)}
            />

            <Menu>
              <MenuTrigger render={<Button variant="ghost" size="sm" className={CHIP_CLASS} />}>
                <CentralIcon name="clock" className="size-4" />
                <span>
                  {formatCadence(
                    schedule,
                    i18n.resolvedLanguage || i18n.language,
                    settings.timestampFormat,
                  )}
                </span>
                <CentralIcon name="chevron-down-small" className="size-3.5 opacity-60" />
              </MenuTrigger>
              <ComposerPickerMenuPopup align="start" className="w-56">
                <MenuGroup>
                  <MenuGroupLabel>
                    {t("automations.fields.schedule", { ns: "work" })}
                  </MenuGroupLabel>
                  <MenuRadioGroup
                    value={form.scheduleKind}
                    onValueChange={(value) => setField("scheduleKind", value as ScheduleKind)}
                  >
                    {SCHEDULE_KIND_OPTIONS.map((option) => (
                      <MenuRadioItem key={option.value} value={option.value}>
                        {option.label}
                      </MenuRadioItem>
                    ))}
                  </MenuRadioGroup>
                </MenuGroup>
                {form.scheduleKind === "custom" ? (
                  <>
                    <MenuSeparator />
                    <MenuGroup>
                      <MenuGroupLabel>
                        {t("automations.fields.every", { ns: "work" })}
                      </MenuGroupLabel>
                      <MenuRadioGroup
                        value={intervalValue}
                        onValueChange={(value) => {
                          const [unit, amount] = value.split(":");
                          if (unit === "seconds" || unit === "minutes") {
                            onFormChange({
                              ...form,
                              intervalUnit: unit,
                              intervalAmount: amount ?? "1",
                            });
                          }
                        }}
                      >
                        {intervalPresets.map((preset) => (
                          <MenuRadioItem
                            key={intervalOptionValue(preset)}
                            value={intervalOptionValue(preset)}
                          >
                            {preset.label}
                          </MenuRadioItem>
                        ))}
                      </MenuRadioGroup>
                    </MenuGroup>
                  </>
                ) : null}
                {form.scheduleKind === "once" ? (
                  <>
                    <MenuSeparator />
                    <MenuGroup>
                      <MenuGroupLabel>
                        {t("automations.fields.runAt", { ns: "work" })}
                      </MenuGroupLabel>
                      <div className="px-2 py-1">
                        <input
                          type="datetime-local"
                          step={1}
                          value={form.onceRunAt}
                          onChange={(event) => setField("onceRunAt", event.target.value)}
                          className="w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        />
                      </div>
                    </MenuGroup>
                  </>
                ) : null}
                {form.scheduleKind === "cron" ? (
                  <>
                    <MenuSeparator />
                    <MenuGroup>
                      <MenuGroupLabel>
                        {t("automations.fields.cron", { ns: "work" })}
                      </MenuGroupLabel>
                      <div className="px-2 py-1">
                        <input
                          value={form.cronExpression}
                          onChange={(event) => setField("cronExpression", event.target.value)}
                          placeholder="0 9 * * *"
                          className="w-full rounded-md border border-border bg-transparent px-2 py-1.5 font-mono text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        />
                      </div>
                    </MenuGroup>
                  </>
                ) : null}
                {form.scheduleKind === "weekly" ? (
                  <>
                    <MenuSeparator />
                    <MenuGroup>
                      <MenuGroupLabel>{t("automations.fields.day", { ns: "work" })}</MenuGroupLabel>
                      <MenuRadioGroup
                        value={form.dayOfWeek}
                        onValueChange={(value) => setField("dayOfWeek", value)}
                      >
                        {[0, 1, 2, 3, 4, 5, 6].map((value) => (
                          <MenuRadioItem key={value} value={String(value)}>
                            {weekdayLabel(value)}
                          </MenuRadioItem>
                        ))}
                      </MenuRadioGroup>
                    </MenuGroup>
                  </>
                ) : null}
                {form.scheduleKind === "daily" ||
                form.scheduleKind === "weekdays" ||
                form.scheduleKind === "weekly" ? (
                  <>
                    <MenuSeparator />
                    <MenuSub>
                      <MenuSubTrigger>
                        {t("automations.fields.time", { ns: "work" })}
                        <span className="ml-auto pr-1 tabular-nums text-muted-foreground">
                          {form.timeOfDay}
                        </span>
                      </MenuSubTrigger>
                      <ComposerPickerMenuSubPopup>
                        <div className="p-1">
                          <TimePicker
                            className="w-44"
                            value={form.timeOfDay}
                            onChange={(value) => setField("timeOfDay", value)}
                          />
                        </div>
                      </ComposerPickerMenuSubPopup>
                    </MenuSub>
                  </>
                ) : null}
                {form.scheduleKind === "daily" ||
                form.scheduleKind === "weekdays" ||
                form.scheduleKind === "weekly" ||
                form.scheduleKind === "cron" ? (
                  <>
                    <MenuSeparator />
                    <MenuGroup>
                      <MenuGroupLabel>
                        {t("automations.fields.timezone", { ns: "work" })}
                      </MenuGroupLabel>
                      <div className="px-2 py-1">
                        <input
                          value={form.timezone}
                          onChange={(event) => setField("timezone", event.target.value)}
                          placeholder="Europe/Rome"
                          className="w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        />
                      </div>
                    </MenuGroup>
                  </>
                ) : null}
              </ComposerPickerMenuPopup>
            </Menu>

            <Menu>
              <MenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("automations.fields.runMode", { ns: "work" })}
                    title={t("automations.fields.runMode", { ns: "work" })}
                    className="rounded-lg text-[var(--color-text-foreground-secondary)]"
                  />
                }
              >
                <SkillCubeIcon className="size-4" />
              </MenuTrigger>
              <ComposerPickerMenuPopup align="start" className="w-56">
                <MenuGroup>
                  <MenuGroupLabel>{t("automations.fields.mode", { ns: "work" })}</MenuGroupLabel>
                  <MenuRadioGroup
                    value={form.mode}
                    onValueChange={(value) => setField("mode", value as AutomationMode)}
                  >
                    <MenuRadioItem value="standalone">
                      {t("automations.mode.standalone", { ns: "work" })}
                    </MenuRadioItem>
                    <MenuRadioItem value="heartbeat">
                      {t("automations.mode.heartbeat", { ns: "work" })}
                    </MenuRadioItem>
                  </MenuRadioGroup>
                </MenuGroup>
                {form.mode === "heartbeat" ? (
                  <>
                    <MenuSeparator />
                    <MenuGroup>
                      <MenuGroupLabel>
                        {t("automations.fields.targetThread", { ns: "work" })}
                      </MenuGroupLabel>
                      {projectThreads.length === 0 ? (
                        <MenuItem disabled>
                          {t("automations.dialog.noProjectThreads", { ns: "work" })}
                        </MenuItem>
                      ) : (
                        <MenuRadioGroup
                          value={form.targetThreadId}
                          onValueChange={(value) => setField("targetThreadId", value)}
                        >
                          {projectThreads.map((thread) => (
                            <MenuRadioItem key={thread.id} value={thread.id}>
                              <span className="truncate">
                                {resolveThreadPickerTitle(thread.title)}
                              </span>
                            </MenuRadioItem>
                          ))}
                        </MenuRadioGroup>
                      )}
                    </MenuGroup>
                    <MenuSeparator />
                    <MenuGroup>
                      <MenuGroupLabel>
                        {t("automations.fields.stopWhen", { ns: "work" })}
                      </MenuGroupLabel>
                      <div className="px-2 py-1">
                        <input
                          value={form.stopWhen}
                          onChange={(event) => setField("stopWhen", event.target.value)}
                          placeholder={t("automations.dialog.stopWhenPlaceholder", { ns: "work" })}
                          className="w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        />
                      </div>
                    </MenuGroup>
                    <MenuSeparator />
                    <MenuCheckboxItem
                      checked={form.stopOnError}
                      onCheckedChange={(checked) => setField("stopOnError", checked)}
                    >
                      {t("automations.fields.stopOnError", { ns: "work" })}
                    </MenuCheckboxItem>
                  </>
                ) : null}
                <MenuSeparator />
                <MenuGroup>
                  <MenuGroupLabel>
                    {t("automations.fields.maxIterations", { ns: "work" })}
                  </MenuGroupLabel>
                  <MenuRadioGroup
                    value={form.maxIterations}
                    onValueChange={(value) => setField("maxIterations", value)}
                  >
                    {maxIterationPresets.map((preset) => (
                      <MenuRadioItem key={preset.value || "unlimited"} value={preset.value}>
                        {preset.label}
                      </MenuRadioItem>
                    ))}
                  </MenuRadioGroup>
                </MenuGroup>
              </ComposerPickerMenuPopup>
            </Menu>

            <Menu>
              <MenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("automations.fields.permissions", { ns: "work" })}
                    title={t("automations.fields.permissions", { ns: "work" })}
                    className="rounded-lg text-[var(--color-text-foreground-secondary)]"
                  />
                }
              >
                <CentralIcon name="brain" className="size-4" />
              </MenuTrigger>
              <ComposerPickerMenuPopup align="start" className="w-48">
                <MenuRadioGroup
                  value={form.runtimeMode}
                  onValueChange={(value) => setField("runtimeMode", value as RuntimeMode)}
                >
                  <MenuRadioItem value="approval-required">
                    {t("automations.permissions.approvalRequired", { ns: "work" })}
                  </MenuRadioItem>
                  <MenuRadioItem value="full-access">
                    {t("automations.permissions.fullAccess", { ns: "work" })}
                  </MenuRadioItem>
                </MenuRadioGroup>
              </ComposerPickerMenuPopup>
            </Menu>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              {t("actions.cancel", { ns: "common" })}
            </Button>
            <Button type="button" onClick={submit} disabled={busy || !submittable}>
              {editing
                ? t("actions.save", { ns: "common" })
                : t("automations.dialog.create", { ns: "work" })}
            </Button>
          </div>
        </div>
      </DialogPopup>
    </Dialog>
  );
}
