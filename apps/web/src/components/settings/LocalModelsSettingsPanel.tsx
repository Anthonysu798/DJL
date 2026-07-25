import type {
  LocalModelInstallInput,
  LocalModelRecommendation,
  LocalModelRuntime,
  LocalModelRuntimeStatus,
  LocalModelsSnapshot,
} from "@synara/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import { isElectron } from "~/env";
import {
  CheckCircle2Icon,
  ChevronRightIcon,
  ExternalLinkIcon,
  Loader2Icon,
  LockIcon,
  RefreshCwIcon,
  SparklesIcon,
  Trash2,
} from "~/lib/icons";
import { disclosureChevronClassName } from "~/lib/disclosureMotion";
import { SettingsLoadError, settingsLoadErrorDetail } from "./SettingsLoadError";
import { providerDiscoveryQueryKeys } from "~/lib/providerDiscoveryReactQuery";
import { cn } from "~/lib/utils";
import { ensureNativeApi } from "~/nativeApi";
import {
  readLocalModelsBrowserCache,
  writeLocalModelsBrowserCache,
} from "~/lib/localModelsBrowserCache";
import {
  SETTINGS_CARD_ROW_DESCRIPTION_CLASS_NAME,
  SETTINGS_CARD_ROW_TITLE_CLASS_NAME,
  SETTINGS_EMPTY_STATE_CLASS_NAME,
  SETTINGS_INSET_LIST_CLASS_NAME,
} from "~/settingsPanelStyles";
import { Button } from "../ui/button";
import { DisclosureRegion } from "../ui/DisclosureRegion";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { toastManager } from "../ui/toast";
import { SettingsListRow, SettingsSection, SettingsSelectPopup } from "./SettingsPanelPrimitives";

const LOCAL_MODELS_QUERY_KEY = ["local-models", "snapshot"] as const;
const LM_STUDIO_MANAGE_URL = "https://lmstudio.ai/docs/app/basics/download-model";
const LOCAL_MODEL_RUNTIMES = ["ollama", "lmstudio"] as const;

export function recommendationSourceForRuntime(
  recommendation: LocalModelRecommendation,
  runtime: LocalModelRuntime,
) {
  return recommendation.sources.find((source) => source.runtime === runtime) ?? null;
}

export function installProgressPercent(downloadedBytes: number, totalBytes: number | null) {
  if (!totalBytes || totalBytes <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)));
}

export function quickSetupViewModel(
  snapshot: LocalModelsSnapshot,
  selectedRuntime: LocalModelRuntime = "ollama",
) {
  const recommendation = snapshot.recommendations.find(
    ({ id }) => id === snapshot.recommendedModelId,
  );
  const runtime = snapshot.runtimes.find((candidate) => candidate.runtime === selectedRuntime);
  const source = recommendation?.sources.find((candidate) => candidate.runtime === selectedRuntime);
  if (!recommendation || !runtime || !source) return null;
  const installed = snapshot.installedModels.some(
    (model) => model.runtime === selectedRuntime && model.modelId === source.modelId,
  );
  const setupJob = snapshot.setupJobs.find(
    (job) => job.runtime === selectedRuntime && job.modelId === source.modelId,
  );
  const estimatedBytes =
    source.estimatedDownloadBytes +
    (runtime.state === "not_installed" ? runtime.estimatedDownloadBytes : 0);
  const requiredBytes = estimatedBytes + Math.max(2 * 1024 ** 3, Math.ceil(estimatedBytes * 0.1));
  return {
    action: installed
      ? ("ready" as const)
      : runtime.state === "not_installed"
        ? ("setup" as const)
        : ("download" as const),
    recommendation,
    runtime,
    source,
    setupJob,
    estimatedBytes,
    requiredBytes,
    insufficientDisk:
      !installed && snapshot.freeDiskBytes !== null && snapshot.freeDiskBytes < requiredBytes,
  };
}

function localizedRecommendationDescription(
  recommendation: LocalModelRecommendation,
  t: TFunction,
) {
  return t(`localModels.recommendations.${recommendation.id}.description`, {
    defaultValue: recommendation.description,
    ns: "settings",
  });
}

function runtimeStatusDescription(status: LocalModelRuntimeStatus, t: TFunction): string {
  switch (status.state) {
    case "running":
      return t("localModels.connectedOn", { endpoint: status.endpoint.replace("http://", "") });
    case "stopped":
      return t("localModels.runtimeDetails.stopped", { runtime: status.name });
    case "not_installed":
      return t("localModels.runtimeDetails.notInstalled", { runtime: status.name });
    case "update_required":
      return t("localModels.runtimeDetails.updateRequired", { runtime: status.name });
    case "error":
      return status.detail ?? t("localModels.runtimeDetails.error", { runtime: status.name });
  }
}

function formatBytes(bytes: number, t: TFunction): string {
  if (bytes <= 0) return t("localModels.sizeUnavailable", { ns: "settings" });
  const units = ["B", "KB", "MB", "GB", "TB"];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** unitIndex;
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

function runtimeDisplayName(runtime: LocalModelRuntime): string {
  return runtime === "ollama" ? "Ollama" : "LM Studio";
}

function runtimeStateLabel(state: LocalModelRuntimeStatus["state"], t: TFunction): string {
  switch (state) {
    case "running":
      return t("localModels.runtimeStates.running", { ns: "settings" });
    case "stopped":
      return t("localModels.runtimeStates.stopped", { ns: "settings" });
    case "not_installed":
      return t("localModels.runtimeStates.notInstalled", { ns: "settings" });
    case "update_required":
      return t("localModels.runtimeStates.updateRequired", { ns: "settings" });
    case "error":
      return t("localModels.runtimeStates.error", { ns: "settings" });
  }
}

function RuntimeStatusBadge({ status }: { status: LocalModelRuntimeStatus }) {
  const { t } = useTranslation("settings");
  const tone =
    status.state === "running"
      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
      : status.state === "error" || status.state === "update_required"
        ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
        : "bg-muted text-muted-foreground";
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", tone)}>
      {runtimeStateLabel(status.state, t)}
    </span>
  );
}

type LocalModelAction =
  | { readonly type: "refresh" }
  | { readonly type: "install-runtime"; readonly runtime: LocalModelRuntime }
  | { readonly type: "start"; readonly runtime: LocalModelRuntime }
  | { readonly type: "install"; readonly input: LocalModelInstallInput }
  | { readonly type: "cancel"; readonly jobId: string }
  | { readonly type: "start-setup"; readonly runtime?: LocalModelRuntime }
  | { readonly type: "retry-setup"; readonly jobId: string }
  | { readonly type: "cancel-setup"; readonly jobId: string }
  | { readonly type: "remove"; readonly runtime: LocalModelRuntime; readonly modelId: string };

export function LocalModelsSettingsPanel() {
  const { t } = useTranslation(["settings", "common"]);
  const queryClient = useQueryClient();
  const [customRuntime, setCustomRuntime] = useState<LocalModelRuntime>("ollama");
  const [customModelId, setCustomModelId] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [quickSetupRuntime, setQuickSetupRuntime] = useState<LocalModelRuntime>("ollama");
  const inventoryFingerprint = useRef("");
  const cachedSnapshot = readLocalModelsBrowserCache();
  const snapshotQuery = useQuery({
    queryKey: LOCAL_MODELS_QUERY_KEY,
    queryFn: async () => {
      const snapshot = await ensureNativeApi().localModels.getSnapshot();
      writeLocalModelsBrowserCache(snapshot);
      return snapshot;
    },
    enabled: isElectron,
    initialData: cachedSnapshot?.data,
    ...(cachedSnapshot ? { initialDataUpdatedAt: cachedSnapshot.updatedAt } : {}),
    staleTime: 5_000,
  });

  const actionMutation = useMutation({
    mutationFn: async (action: LocalModelAction) => {
      const api = ensureNativeApi().localModels;
      switch (action.type) {
        case "refresh":
          return api.refresh();
        case "install-runtime":
          return api.installRuntime({ runtime: action.runtime });
        case "start":
          return api.startRuntime({ runtime: action.runtime });
        case "install":
          return api.installModel(action.input);
        case "cancel":
          return api.cancelInstall({ jobId: action.jobId });
        case "start-setup":
          return api.startSetup(action.runtime ? { runtime: action.runtime } : {});
        case "retry-setup":
          return api.retrySetup({ jobId: action.jobId });
        case "cancel-setup":
          return api.cancelSetup({ jobId: action.jobId });
        case "remove":
          return action.runtime === "ollama"
            ? api.removeModel({ runtime: "ollama", modelId: action.modelId })
            : api.removeModel({ runtime: "lmstudio", modelId: action.modelId });
      }
    },
    onSuccess: async (_, action) => {
      await queryClient.invalidateQueries({ queryKey: LOCAL_MODELS_QUERY_KEY });
      if (action.type === "install") {
        toastManager.add({ type: "success", title: t("localModels.toasts.downloadStarted") });
      } else if (action.type === "install-runtime") {
        toastManager.add({
          type: "success",
          title: t("localModels.toasts.runtimeReady", {
            runtime: runtimeDisplayName(action.runtime),
          }),
        });
      } else if (action.type === "remove") {
        toastManager.add({ type: "success", title: t("localModels.toasts.removed") });
      }
    },
    onError: (error) =>
      toastManager.add({
        type: "error",
        title: t("localModels.toasts.actionFailed"),
        description: t("localModels.toasts.actionFailedWithDetail", {
          detail: error instanceof Error ? error.message : t("localModels.toasts.runtimeRejected"),
        }),
      }),
  });

  useEffect(() => {
    if (!isElectron) return;
    return ensureNativeApi().localModels.onEvent((event) => {
      writeLocalModelsBrowserCache(event.snapshot);
      queryClient.setQueryData(LOCAL_MODELS_QUERY_KEY, event.snapshot);
    });
  }, [queryClient]);

  const snapshot = snapshotQuery.data;
  const runtimesById = useMemo(
    () => new Map(snapshot?.runtimes.map((runtime) => [runtime.runtime, runtime]) ?? []),
    [snapshot?.runtimes],
  );
  const installedKeys = useMemo(
    () =>
      new Set(snapshot?.installedModels.map((model) => `${model.runtime}:${model.modelId}`) ?? []),
    [snapshot?.installedModels],
  );
  const quickSetup = snapshot ? quickSetupViewModel(snapshot, quickSetupRuntime) : null;
  const quickSetupIsActive =
    quickSetup?.setupJob !== undefined &&
    !["ready", "failed", "cancelled"].includes(quickSetup.setupJob.state);
  const currentInventoryFingerprint = useMemo(
    () =>
      snapshot?.installedModels
        .map(({ runtime, modelId }) => `${runtime}:${modelId}`)
        .toSorted()
        .join("|") ?? "",
    [snapshot?.installedModels],
  );

  useEffect(() => {
    if (
      inventoryFingerprint.current &&
      inventoryFingerprint.current !== currentInventoryFingerprint
    ) {
      void queryClient.invalidateQueries({ queryKey: providerDiscoveryQueryKeys.all });
    }
    inventoryFingerprint.current = currentInventoryFingerprint;
  }, [currentInventoryFingerprint, queryClient]);

  const openExternal = async (url: string) => {
    try {
      await ensureNativeApi().shell.openExternal(url);
    } catch (error) {
      toastManager.add({
        type: "error",
        title: t("localModels.toasts.openLinkFailed"),
        description: error instanceof Error ? error.message : url,
      });
    }
  };

  const installCustomModel = () => {
    const modelId = customModelId.trim();
    if (!modelId) return;
    actionMutation.mutate({
      type: "install",
      input: { runtime: customRuntime, modelId } as LocalModelInstallInput,
    });
    setCustomModelId("");
  };

  if (!isElectron) {
    return (
      <div
        className={cn(SETTINGS_EMPTY_STATE_CLASS_NAME, "px-5 py-8 text-sm text-muted-foreground")}
      >
        {t("localModels.desktopOnly")}
      </div>
    );
  }

  if (snapshotQuery.isLoading) {
    return (
      <div
        className={cn(
          SETTINGS_EMPTY_STATE_CLASS_NAME,
          "flex items-center gap-2 px-5 py-8 text-sm text-muted-foreground",
        )}
      >
        <Loader2Icon className="size-4 animate-spin" />
        {t("localModels.checking")}
      </div>
    );
  }

  if (!snapshot || snapshotQuery.isError) {
    return (
      <SettingsLoadError
        className={SETTINGS_EMPTY_STATE_CLASS_NAME}
        summary={t("localModels.statusUnavailable")}
        detail={settingsLoadErrorDetail(
          snapshotQuery.error,
          t("localModelsStatusUnavailableDetail"),
        )}
        actionLabel={t("actions.retry", { ns: "common" })}
        onAction={() => void snapshotQuery.refetch()}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-xl border border-emerald-500/20 bg-emerald-500/[0.045] px-5 py-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <LockIcon className="size-4" />
          </div>
          <div>
            <h2 className="text-sm font-medium text-foreground">{t("localModels.privacyTitle")}</h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {t("localModels.privacyDescription")}
            </p>
          </div>
        </div>
      </div>

      {quickSetup ? (
        <div className="overflow-hidden rounded-xl border border-primary/20 bg-primary/[0.035]">
          <div className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                {quickSetup.action === "ready" ? (
                  <CheckCircle2Icon className="size-4.5" />
                ) : (
                  <SparklesIcon className="size-4.5" />
                )}
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-medium text-foreground">
                  {quickSetup.action === "ready"
                    ? t("localModels.quick.readyTitle", { runtime: quickSetup.runtime.name })
                    : t("localModels.quick.title", { runtime: quickSetup.runtime.name })}
                </h2>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {quickSetup.action === "ready"
                    ? t("localModels.quick.readyDescription", {
                        model: quickSetup.recommendation.name,
                        runtime: quickSetup.runtime.name,
                      })
                    : t("localModels.quick.description", {
                        runtime: quickSetup.runtime.name,
                        model: quickSetup.recommendation.name,
                        size: formatBytes(quickSetup.estimatedBytes, t),
                      })}
                </p>
                {quickSetup.insufficientDisk ? (
                  <p className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-400">
                    {t("localModels.quick.insufficientDisk", {
                      size: formatBytes(quickSetup.requiredBytes, t),
                    })}
                  </p>
                ) : null}
                <div
                  className="mt-3 flex flex-wrap items-center gap-2"
                  role="group"
                  aria-label={t("localModels.quick.runtimeLabel")}
                >
                  {LOCAL_MODEL_RUNTIMES.map((runtime) => (
                    <Button
                      key={runtime}
                      type="button"
                      size="xs"
                      variant={quickSetupRuntime === runtime ? "secondary" : "outline"}
                      aria-pressed={quickSetupRuntime === runtime}
                      disabled={quickSetupIsActive || actionMutation.isPending}
                      onClick={() => setQuickSetupRuntime(runtime)}
                    >
                      {runtimeDisplayName(runtime)}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {quickSetup.setupJob?.state === "failed" ? (
                <Button
                  size="sm"
                  disabled={actionMutation.isPending}
                  onClick={() =>
                    actionMutation.mutate({
                      type: "retry-setup",
                      jobId: quickSetup.setupJob!.id,
                    })
                  }
                >
                  {t("localModels.quick.retry")}
                </Button>
              ) : quickSetup.setupJob &&
                !["ready", "failed", "cancelled"].includes(quickSetup.setupJob.state) ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={actionMutation.isPending}
                  onClick={() =>
                    actionMutation.mutate({
                      type: "cancel-setup",
                      jobId: quickSetup.setupJob!.id,
                    })
                  }
                >
                  <Loader2Icon className="size-3.5 animate-spin" />
                  {t("actions.cancel", { ns: "common" })}
                </Button>
              ) : quickSetup.action === "ready" ? (
                <Button size="sm" onClick={() => window.history.back()}>
                  {t("localModels.quick.useInChat")}
                </Button>
              ) : (
                <Button
                  size="sm"
                  disabled={quickSetup.insufficientDisk || actionMutation.isPending}
                  onClick={() =>
                    actionMutation.mutate({
                      type: "start-setup",
                      runtime: quickSetup.runtime.runtime,
                    })
                  }
                >
                  {actionMutation.isPending ? (
                    <Loader2Icon className="size-3.5 animate-spin" />
                  ) : null}
                  {quickSetup.action === "download"
                    ? t("localModels.quick.download", {
                        model: quickSetup.recommendation.name,
                        size: formatBytes(quickSetup.source.estimatedDownloadBytes, t),
                      })
                    : t("localModels.quick.setup", {
                        model: quickSetup.recommendation.name,
                        size: formatBytes(quickSetup.estimatedBytes, t),
                      })}
                </Button>
              )}
            </div>
          </div>
          {quickSetup.setupJob ? (
            <div className="border-t border-border/60 px-5 py-3">
              <div className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
                <span>{quickSetup.setupJob.message ?? quickSetup.setupJob.state}</span>
                {installProgressPercent(
                  quickSetup.setupJob.downloadedBytes,
                  quickSetup.setupJob.totalBytes,
                ) !== null ? (
                  <span>
                    {installProgressPercent(
                      quickSetup.setupJob.downloadedBytes,
                      quickSetup.setupJob.totalBytes,
                    )}
                    %
                  </span>
                ) : null}
              </div>
              {!["ready", "failed", "cancelled"].includes(quickSetup.setupJob.state) ? (
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      "h-full rounded-full bg-primary transition-[width]",
                      installProgressPercent(
                        quickSetup.setupJob.downloadedBytes,
                        quickSetup.setupJob.totalBytes,
                      ) === null && "w-1/3 animate-pulse",
                    )}
                    style={
                      installProgressPercent(
                        quickSetup.setupJob.downloadedBytes,
                        quickSetup.setupJob.totalBytes,
                      ) === null
                        ? undefined
                        : {
                            width: `${installProgressPercent(
                              quickSetup.setupJob.downloadedBytes,
                              quickSetup.setupJob.totalBytes,
                            )}%`,
                          }
                    }
                  />
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <Button
        variant="ghost"
        size="sm"
        className="px-1 text-muted-foreground"
        aria-expanded={advancedOpen}
        onClick={() => setAdvancedOpen((open) => !open)}
      >
        <ChevronRightIcon className={disclosureChevronClassName(advancedOpen)} />
        {t("localModels.quick.chooseAnother")}
      </Button>

      <DisclosureRegion open={advancedOpen}>
        <div className="space-y-6 pt-1">
          <SettingsSection title={t("localModels.runtimesTitle")}>
            {snapshot.runtimes.map((status) => {
              const runtimeInstall = snapshot.runtimeInstallJobs.find(
                ({ runtime }) => runtime === status.runtime,
              );
              const runtimeInstallActive =
                runtimeInstall &&
                runtimeInstall.state !== "completed" &&
                runtimeInstall.state !== "failed";
              const runtimeProgress = runtimeInstall
                ? installProgressPercent(runtimeInstall.downloadedBytes, runtimeInstall.totalBytes)
                : null;
              return (
                <SettingsListRow
                  key={status.runtime}
                  title={
                    <span className="flex items-center gap-2">
                      {status.name}
                      <RuntimeStatusBadge status={status} />
                    </span>
                  }
                  description={
                    <div>
                      <span>
                        {runtimeInstall?.state === "failed"
                          ? runtimeInstall.message
                          : runtimeInstall && runtimeInstallActive
                            ? runtimeInstall.message
                            : runtimeStatusDescription(status, t)}
                      </span>
                      {runtimeInstall && runtimeInstallActive ? (
                        <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-muted">
                          <span
                            className={cn(
                              "block h-full rounded-full bg-primary transition-[width]",
                              runtimeProgress === null && "w-1/3 animate-pulse",
                            )}
                            style={
                              runtimeProgress === null
                                ? undefined
                                : { width: `${runtimeProgress}%` }
                            }
                          />
                        </span>
                      ) : null}
                    </div>
                  }
                  actions={
                    <>
                      {status.state === "not_installed" ? (
                        <Button
                          size="sm"
                          disabled={Boolean(runtimeInstallActive) || actionMutation.isPending}
                          onClick={() =>
                            actionMutation.mutate({
                              type: "install-runtime",
                              runtime: status.runtime,
                            })
                          }
                        >
                          {runtimeInstallActive ? (
                            <Loader2Icon className="size-3.5 animate-spin" />
                          ) : null}
                          {runtimeInstallActive
                            ? runtimeProgress === null
                              ? t("localModels.installingRuntime", { runtime: status.name })
                              : t("localModels.installingRuntimeProgress", {
                                  runtime: status.name,
                                  progress: runtimeProgress,
                                })
                            : runtimeInstall?.state === "failed"
                              ? t("localModels.retryInstall")
                              : t("localModels.installRuntime", { runtime: status.name })}
                        </Button>
                      ) : status.capabilities.canStart ? (
                        <Button
                          size="sm"
                          disabled={actionMutation.isPending}
                          onClick={() =>
                            actionMutation.mutate({ type: "start", runtime: status.runtime })
                          }
                        >
                          {t("localModels.startServer")}
                        </Button>
                      ) : status.state === "update_required" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void openExternal(status.installerUrl)}
                        >
                          {t("localModels.updateRuntime")}
                          <ExternalLinkIcon className="size-3.5" />
                        </Button>
                      ) : null}
                    </>
                  }
                />
              );
            })}
            <SettingsListRow
              title={t("localModels.runtimeStatusTitle")}
              description={t("localModels.runtimeStatusDescription")}
              actions={
                <Button
                  size="sm"
                  variant="outline"
                  disabled={snapshotQuery.isFetching || actionMutation.isPending}
                  onClick={() => actionMutation.mutate({ type: "refresh" })}
                >
                  <RefreshCwIcon
                    className={cn(
                      "size-3.5",
                      (snapshotQuery.isFetching || actionMutation.isPending) && "animate-spin",
                    )}
                  />
                  {t("actions.refresh", { ns: "common" })}
                </Button>
              }
            />
          </SettingsSection>

          <SettingsSection title={t("localModels.recommendedTitle")}>
            {snapshot.recommendations.map((recommendation) => {
              const recommended = recommendation.id === snapshot.recommendedModelId;
              return (
                <div key={recommendation.id} className="px-4 py-3.5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className={SETTINGS_CARD_ROW_TITLE_CLASS_NAME}>
                          {recommendation.name}
                        </div>
                        {recommended ? (
                          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                            {t("localModels.bestFit")}
                          </span>
                        ) : null}
                      </div>
                      <p className={SETTINGS_CARD_ROW_DESCRIPTION_CLASS_NAME}>
                        {localizedRecommendationDescription(recommendation, t)}
                      </p>
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        {t("localModels.memoryTier", {
                          size: formatBytes(recommendation.minimumMemoryBytes, t),
                        })}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      {LOCAL_MODEL_RUNTIMES.map((runtime) => {
                        const source = recommendationSourceForRuntime(recommendation, runtime);
                        const runtimeStatus = runtimesById.get(runtime);
                        if (!source || !runtimeStatus) return null;
                        const installed = installedKeys.has(`${runtime}:${source.modelId}`);
                        return (
                          <Button
                            key={runtime}
                            size="xs"
                            variant={recommended && runtime === "ollama" ? "default" : "outline"}
                            disabled={
                              installed ||
                              !runtimeStatus.capabilities.canInstallModels ||
                              actionMutation.isPending
                            }
                            title={
                              runtimeStatus.state !== "running"
                                ? t("localModels.startFirst", { runtime: runtimeStatus.name })
                                : source.modelId
                            }
                            onClick={() =>
                              actionMutation.mutate({
                                type: "install",
                                input: source as LocalModelInstallInput,
                              })
                            }
                          >
                            {installed
                              ? t("localModels.installed")
                              : t("localModels.installWith", { runtime: runtimeStatus.name })}
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </SettingsSection>

          <SettingsSection title={t("localModels.installAnotherTitle")}>
            <div className="px-4 py-3.5">
              <div className="flex flex-col gap-2 sm:flex-row">
                <Select
                  value={customRuntime}
                  onValueChange={(value) => setCustomRuntime(value as LocalModelRuntime)}
                >
                  <SelectTrigger
                    size="sm"
                    className="sm:w-32"
                    aria-label={t("localModels.runtimeAriaLabel")}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SettingsSelectPopup>
                    <SelectItem value="ollama">Ollama</SelectItem>
                    <SelectItem value="lmstudio">LM Studio</SelectItem>
                  </SettingsSelectPopup>
                </Select>
                <Input
                  size="sm"
                  variant="soft"
                  value={customModelId}
                  onChange={(event) => setCustomModelId(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") installCustomModel();
                  }}
                  placeholder={
                    customRuntime === "ollama" ? "qwen3-coder:30b" : "publisher/model-name"
                  }
                  spellCheck={false}
                />
                <Button
                  size="sm"
                  disabled={
                    !customModelId.trim() ||
                    !runtimesById.get(customRuntime)?.capabilities.canInstallModels ||
                    actionMutation.isPending
                  }
                  onClick={installCustomModel}
                >
                  {t("localModels.installModel")}
                </Button>
              </div>
              <p className={cn(SETTINGS_CARD_ROW_DESCRIPTION_CLASS_NAME, "mt-2")}>
                {t("localModels.installHint")}
              </p>
            </div>
          </SettingsSection>

          {snapshot.installJobs.length > 0 ? (
            <SettingsSection title={t("localModels.downloadsTitle")}>
              {snapshot.installJobs.map((job) => {
                const progress = installProgressPercent(job.downloadedBytes, job.totalBytes);
                const active = job.state === "queued" || job.state === "downloading";
                return (
                  <div key={job.id} className="px-4 py-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className={cn(SETTINGS_CARD_ROW_TITLE_CLASS_NAME, "truncate")}>
                          {job.modelId}
                        </div>
                        <p className={SETTINGS_CARD_ROW_DESCRIPTION_CLASS_NAME}>
                          {job.message ?? job.state} ·{" "}
                          {job.runtime === "ollama" ? "Ollama" : "LM Studio"}
                        </p>
                        {active ? (
                          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                            <div
                              className={cn(
                                "h-full rounded-full bg-primary transition-[width]",
                                progress === null && "w-1/3 animate-pulse",
                              )}
                              style={progress === null ? undefined : { width: `${progress}%` }}
                            />
                          </div>
                        ) : null}
                      </div>
                      {active ? (
                        job.runtime === "ollama" ? (
                          <Button
                            size="xs"
                            variant="outline"
                            disabled={actionMutation.isPending}
                            onClick={() => actionMutation.mutate({ type: "cancel", jobId: job.id })}
                          >
                            {t("actions.cancel", { ns: "common" })}
                          </Button>
                        ) : (
                          <Button
                            size="xs"
                            variant="outline"
                            onClick={() => void openExternal(LM_STUDIO_MANAGE_URL)}
                          >
                            {t("localModels.manageLmStudio")}
                          </Button>
                        )
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </SettingsSection>
          ) : null}

          <SettingsSection title={t("localModels.installedModelsTitle")}>
            {snapshot.installedModels.length === 0 ? (
              <div className="px-4 py-5 text-xs text-muted-foreground">
                {t("localModels.installedEmpty")}
              </div>
            ) : (
              snapshot.installedModels.map((model) => (
                <SettingsListRow
                  key={`${model.runtime}:${model.modelId}`}
                  title={model.name}
                  description={`${model.runtime === "ollama" ? "Ollama" : "LM Studio"} · ${formatBytes(model.sizeBytes, t)} · ${model.modelId}`}
                  actions={
                    model.runtime === "ollama" ? (
                      <Button
                        size="icon-xs"
                        variant="destructive-outline"
                        aria-label={t("localModels.removeAriaLabel", { model: model.name })}
                        disabled={actionMutation.isPending}
                        onClick={async () => {
                          const confirmed = await ensureNativeApi().dialogs.confirm(
                            t("localModels.removeConfirmation", { model: model.name }),
                          );
                          if (confirmed) {
                            actionMutation.mutate({
                              type: "remove",
                              runtime: "ollama",
                              modelId: model.modelId,
                            });
                          }
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    ) : (
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => void openExternal(LM_STUDIO_MANAGE_URL)}
                      >
                        {t("localModels.manageLmStudio")}
                      </Button>
                    )
                  }
                />
              ))
            )}
          </SettingsSection>

          <div
            className={cn(
              SETTINGS_INSET_LIST_CLASS_NAME,
              "px-4 py-3 text-[11px] leading-relaxed text-muted-foreground",
            )}
          >
            {t("localModels.networkPrivacy")}
          </div>
        </div>
      </DisclosureRegion>
    </div>
  );
}
