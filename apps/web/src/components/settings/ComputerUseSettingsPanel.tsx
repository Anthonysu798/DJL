import {
  decodeComputerUseRequest,
  decodeComputerUseResponse,
  type ComputerUseHistorySettings,
  type ComputerActivitySemanticSummary,
  type ComputerUseRequest,
  type ComputerUseResponse,
} from "@djl/contracts";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { ReviewSuggestionResult } from "../../lib/historySuggestionDraft";
import {
  computerHistoryClearScope,
  type HistoryClearRange,
} from "../../lib/computerHistoryClearScope";
import { Trans, useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { SettingsListRow, SettingsSection } from "./SettingsPanelPrimitives";

export interface ComputerUseSettingsPanelProps {
  historyOnly?: boolean;
  suggestionDraft?: {
    pending: boolean;
    result: ReviewSuggestionResult | null;
    review: (summary: ComputerActivitySemanticSummary) => Promise<ReviewSuggestionResult>;
    recover: () => Promise<ReviewSuggestionResult>;
    resumeExistingDraft?: () => Promise<void>;
  };
  request: (request: ComputerUseRequest) => Promise<ComputerUseResponse>;
  /** The renderer bridge supplies the privileged, global Stop operation. */
  stopAll?: () => Promise<void>;
  /** Subscribe to real manager events; no polling or simulated activity. */
  subscribe?: (listener: () => void) => () => void;
}

type Success<M extends ComputerUseRequest["method"]> = Extract<
  ComputerUseResponse,
  { method: M; result: unknown }
>;

type HistoryFormDraft = Partial<
  Pick<
    ComputerUseHistorySettings,
    | "retentionDays"
    | "intervalSeconds"
    | "includedBundleIds"
    | "includedDomains"
    | "excludedBundleIds"
    | "excludedDomains"
  >
>;
type HistoryControlPatch = Partial<
  Pick<
    ComputerUseHistorySettings,
    "enabled" | "interactionCaptureEnabled" | "semanticSummariesEnabled"
  >
>;

export function ComputerUseSettingsPanel({
  request,
  historyOnly = false,
  suggestionDraft,
  stopAll,
  subscribe,
}: ComputerUseSettingsPanelProps) {
  const { t, i18n } = useTranslation("settings");
  const client = useQueryClient();
  const recoveryButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!suggestionDraft?.pending && suggestionDraft?.result?.status === "retained") {
      recoveryButton.current?.focus();
    }
  }, [suggestionDraft?.pending, suggestionDraft?.result?.status]);
  const instance = useId();
  const queryKey = useMemo(() => ["computer-use-settings", instance] as const, [instance]);
  const [clearSource, setClearSource] = useState<"agent" | "passive" | null>(null);
  const [clearCutoff, setClearCutoff] = useState(() => new Date());
  const [clearRange, setClearRange] = useState<HistoryClearRange>("all");
  const [clearBundle, setClearBundle] = useState("");
  const [clearSince, setClearSince] = useState("");
  const [clearUntil, setClearUntil] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [draft, setDraft] = useState<HistoryFormDraft | null>(null);
  const invoke = useCallback(
    async <M extends ComputerUseRequest["method"]>(
      input: Extract<ComputerUseRequest, { method: M }>,
    ): Promise<Success<M>["result"]> => {
      const response = decodeComputerUseResponse(await request(decodeComputerUseRequest(input)));
      if (response.method !== input.method) throw new Error(t("computerUse.invalidResponse"));
      if ("error" in response) throw new Error(response.error.message);
      return response.result as Success<M>["result"];
    },
    [request, t],
  );
  const status = useQuery({
    queryKey: [...queryKey, "status"],
    queryFn: () => invoke({ method: "status" }),
    retry: false,
  });
  const apps = useQuery({
    queryKey: [...queryKey, "apps"],
    enabled: !historyOnly,
    queryFn: () => invoke({ method: "apps.list" }),
    retry: false,
  });
  const settings = useQuery({
    queryKey: [...queryKey, "history.settings"],
    queryFn: () => invoke({ method: "history.settings" }),
    retry: false,
  });
  const [source, setSource] = useState<"agent" | "passive">("agent");
  const history = useInfiniteQuery({
    queryKey: [...queryKey, "history"],
    enabled: source === "agent",
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      invoke({
        method: "history.list",
        source: "agent",
        limit: 50,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    getNextPageParam: (last) => last.nextCursor,
    retry: false,
  });
  const [passiveView, setPassiveView] = useState<"ai" | "context" | "counts">("ai");
  const activity = useInfiniteQuery({
    queryKey: [...queryKey, "activity"],
    enabled: source === "passive" && passiveView !== "ai",
    staleTime: Infinity,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      invoke({ method: "activity.list", limit: 50, ...(pageParam ? { cursor: pageParam } : {}) }),
    getNextPageParam: (last) => last.nextCursor,
    retry: false,
  });
  const semantic = useInfiniteQuery({
    queryKey: [...queryKey, "activity.semantic"],
    enabled: source === "passive" && passiveView === "ai",
    staleTime: Infinity,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      invoke({
        method: "activity.list",
        limit: 50,
        ...(pageParam ? { semanticCursor: pageParam } : {}),
      }),
    getNextPageParam: (last) => last.nextSemanticCursor,
    retry: false,
  });
  const selectedHistory = source === "agent" ? history : passiveView === "ai" ? semantic : activity;
  const activityPage = (passiveView === "ai" ? semantic : activity).data?.pages[0];
  const semanticSummaries = useMemo(() => {
    const summaries = semantic.data?.pages.flatMap((page) => page.semanticSummaries ?? []) ?? [];
    return [...new Map(summaries.map((summary) => [summary.id, summary])).values()];
  }, [semantic.data]);
  const recordedContext = useMemo(() => {
    const records =
      activity.data?.pages.flatMap((page) => [
        ...page.snapshots.map((record) => ({ type: "snapshot" as const, record })),
        ...(page.events ?? []).map((record) => ({ type: "event" as const, record })),
      ]) ?? [];
    const unique = new Map<string, (typeof records)[number]>();
    for (const item of records) {
      const key = `${item.type}:${item.record.id}`;
      if (!unique.has(key)) unique.set(key, item);
    }
    return [...unique.values()].sort((a, b) => {
      const byTime = b.record.capturedAt.localeCompare(a.record.capturedAt);
      if (byTime) return byTime;
      if (a.record.id !== b.record.id) return a.record.id < b.record.id ? -1 : 1;
      return a.type < b.type ? -1 : a.type > b.type ? 1 : 0;
    });
  }, [activity.data]);
  const refresh = useCallback(() => client.invalidateQueries({ queryKey }), [client, queryKey]);
  useEffect(() => subscribe?.(() => void refresh()), [subscribe, refresh]);
  const discardClearPages = async (method: "history.clear" | "activity.clear") => {
    const keys = method === "activity.clear" ? ["activity", "activity.semantic"] : ["history"];
    // A failed clear can have committed part of its durable recovery intent.
    // Never keep deleted evidence visible if the authoritative read then fails.
    await Promise.all(
      keys.map((key) => client.cancelQueries({ queryKey: [...queryKey, key], exact: true })),
    );
    for (const key of keys) void client.resetQueries({ queryKey: [...queryKey, key], exact: true });
  };
  const mutation = useMutation({
    mutationFn: async (input: ComputerUseRequest) => {
      const response = decodeComputerUseResponse(await request(decodeComputerUseRequest(input)));
      if (response.method !== input.method) throw new Error(t("computerUse.invalidResponse"));
      if ("error" in response) throw new Error(response.error.message);
      return response;
    },
    onSuccess: async (response) => {
      if (response.method === "history.clear" || response.method === "activity.clear") {
        await discardClearPages(response.method);
        setClearSource(null);
        setFeedback(t("computerUse.cleared"));
      }
      if (
        (response.method === "history.configure" || response.method === "history.pause") &&
        "result" in response
      ) {
        client.setQueryData([...queryKey, "history.settings"], response.result);
      }
      void refresh();
    },
    onError: async (_error, input) => {
      if (input.method === "history.clear" || input.method === "activity.clear") {
        await discardClearPages(input.method);
      }
    },
  });
  const stop = useMutation({
    mutationFn: async () => {
      if (stopAll) await stopAll();
      else await invoke({ method: "stop" });
    },
    onSuccess: () => {
      setFeedback(t("computerUse.stopped"));
      void refresh();
    },
  });
  const saved = settings.data;
  // Readback metadata belongs to the host, never to configure or native policy.
  const savedSettings = saved
    ? (({ pauseResumeAt: _deadline, pauseResumeError: _error, ...policy }) => policy)(saved)
    : undefined;
  const current = saved ? { ...saved, ...draft } : undefined;
  const busy = mutation.isPending || stop.isPending;
  const clearRequest =
    clearSource === "agent"
      ? { method: "history.clear" as const, source: "agent" as const }
      : computerHistoryClearScope({
          range: clearRange,
          cutoff: clearCutoff,
          bundleId: clearBundle,
          since: clearSince,
          until: clearUntil,
        });
  const updateDraft = (patch: HistoryFormDraft) => {
    setDraft((previous) => ({ ...previous, ...patch }));
  };
  const configureControls = (patch: HistoryControlPatch) => {
    if (savedSettings)
      mutation.mutate({ method: "history.configure", settings: { ...savedSettings, ...patch } });
  };
  const saveDraft = () => {
    if (!savedSettings || !draft) return;
    const submitted = draft;
    mutation.mutate(
      { method: "history.configure", settings: { ...savedSettings, ...submitted } },
      {
        onSuccess: () => setDraft((latest) => (latest === submitted ? null : latest)),
      },
    );
  };
  const interactionStatus = activityPage?.interactionStatus;
  const semanticStatus = activityPage?.semanticStatus;
  const errors = [
    ["status", status.error],
    ["apps", apps.error],
    ["settings", settings.error],
    ["history", selectedHistory.error],
    ["mutation", clearSource ? null : mutation.error],
    ["stop", stop.error],
  ] as const;
  const permissionLabels = {
    accessibility: t("computerUse.accessibility"),
    screenRecording: t("computerUse.screenRecording"),
  };
  const permissionStates = {
    granted: t("computerUse.granted"),
    denied: t("computerUse.denied"),
    "not-determined": t("computerUse.notDetermined"),
    unsupported: t("computerUse.unsupported"),
  };
  const actionLabels = {
    click: t("computerUse.actions.click"),
    drag: t("computerUse.actions.drag"),
    type: t("computerUse.actions.type"),
    paste: t("computerUse.actions.paste"),
    pressKey: t("computerUse.actions.pressKey"),
    scroll: t("computerUse.actions.scroll"),
    selectText: t("computerUse.actions.selectText"),
    setValue: t("computerUse.actions.setValue"),
    performAction: t("computerUse.actions.performAction"),
  };
  const eventLabels = {
    "session-opened": t("computerUse.events.opened"),
    "session-closed": t("computerUse.events.closed"),
    stopped: t("computerUse.events.stopped"),
    action: t("computerUse.events.action"),
    "passive-observation": t("computerUse.events.observation"),
  };
  const acknowledgementLabels = {
    dispatched: t("computerUse.dispatched"),
    rejected: t("computerUse.rejected"),
    cancelled: t("computerUse.cancelled"),
  };
  const effectLabels = {
    unverified: t("computerUse.unverified"),
    "observed-change": t("computerUse.observedChange"),
    "observed-no-change": t("computerUse.observedNoChange"),
  };
  return (
    <div className="min-w-0 space-y-6">
      {!historyOnly && (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="max-w-lg text-sm text-muted-foreground">{t("computerUse.description")}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void refresh()}
              disabled={status.isFetching}
            >
              {t("computerUse.refresh")}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => stop.mutate()}
              disabled={stop.isPending}
            >
              {stopAll ? t("computerUse.stopAll") : t("computerUse.stop")}
            </Button>
          </div>
        </div>
      )}
      {errors
        .filter(([, error]) => error)
        .map(([key, error]) => (
          <p key={key} role="alert" className="break-words text-sm text-destructive">
            {error?.message}
          </p>
        ))}
      {feedback && (
        <p role="status" className="text-sm text-muted-foreground">
          {feedback}
        </p>
      )}
      {suggestionDraft && (
        <div className="space-y-2">
          <p
            role={suggestionDraft.result?.status === "failed" ? "alert" : "status"}
            className="text-sm text-muted-foreground"
          >
            {t(
              `computerUse.suggestionDraft.${suggestionDraft.pending ? "pending" : (suggestionDraft.result?.status ?? "unsent")}`,
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            {suggestionDraft.result?.status === "retained" && (
              <Button
                ref={recoveryButton}
                type="button"
                size="sm"
                variant="outline"
                disabled={suggestionDraft.pending}
                onClick={async () => {
                  await suggestionDraft.recover();
                  if (recoveryButton.current?.isConnected) recoveryButton.current.focus();
                }}
              >
                {t("computerUse.suggestionDraft.recover")}
              </Button>
            )}
            {suggestionDraft.resumeExistingDraft && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={suggestionDraft.pending}
                onClick={() => void suggestionDraft.resumeExistingDraft?.()}
              >
                {t("computerUse.suggestionDraft.resume")}
              </Button>
            )}
          </div>
        </div>
      )}
      {!historyOnly && (
        <SettingsSection title={t("computerUse.permissions")}>
          <SettingsListRow
            title={t("computerUse.nativeStatus")}
            description={
              status.isPending
                ? t("computerUse.loading")
                : status.data?.available
                  ? t("computerUse.available")
                  : t("computerUse.unavailable")
            }
          />
          {status.data &&
            (["accessibility", "screenRecording"] as const).map((permission) => (
              <SettingsListRow
                key={permission}
                title={permissionLabels[permission]}
                description={permissionStates[status.data.permissions[permission]]}
                actions={
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label={t("computerUse.requestPermission", {
                      permission: permissionLabels[permission],
                    })}
                    disabled={
                      busy ||
                      !status.data.available ||
                      ["granted", "unsupported"].includes(status.data.permissions[permission])
                    }
                    onClick={() => mutation.mutate({ method: "permissions.request", permission })}
                  >
                    {t("computerUse.requestAccess")}
                  </Button>
                }
              />
            ))}
          {status.data && (
            <SettingsListRow
              title={t("computerUse.capabilities")}
              description={t("computerUse.capabilityDescription")}
              actions={
                <span className="text-xs text-muted-foreground">{status.data.platform}</span>
              }
            />
          )}
          {status.data && (
            <div className="flex flex-wrap gap-2 px-4 py-3 text-xs text-muted-foreground">
              {[
                [t("computerUse.observation"), status.data.capabilities.observation],
                [t("computerUse.screenshots"), status.data.capabilities.screenshots],
                [t("computerUse.virtualCursor"), status.data.capabilities.virtualCursor],
              ].map(([label, supported]) => (
                <span key={String(label)} className="rounded-md border px-2 py-1">
                  {label}: {supported ? t("computerUse.available") : t("computerUse.unavailable")}
                </span>
              ))}
              <span className="basis-full break-words">
                {t("computerUse.backgroundActions")}:{" "}
                {status.data.capabilities.backgroundActions
                  .map((action) => actionLabels[action])
                  .join(", ") || t("computerUse.none")}
              </span>
            </div>
          )}
        </SettingsSection>
      )}
      <SettingsSection title={t("computerUse.passiveHistory")}>
        {status.isPending ? (
          <SettingsListRow title={t("computerUse.loading")} />
        ) : !status.data?.capabilities.passiveHistory ? (
          <SettingsListRow
            title={t("computerUse.unavailable")}
            description={t("computerUse.passiveUnavailable")}
          />
        ) : current ? (
          <>
            <SettingsListRow
              title={t("computerUse.recording")}
              description={t("computerUse.passivePrivacy")}
              actions={
                <Switch
                  aria-label={t("computerUse.recording")}
                  checked={current.enabled}
                  disabled={busy}
                  onCheckedChange={(enabled) => configureControls({ enabled })}
                />
              }
            />
            <SettingsListRow
              title={current.paused ? t("computerUse.paused") : t("computerUse.recordingState")}
              description={
                current.paused ? (
                  saved?.pauseResumeError ? (
                    t("computerUse.pauseChangeFailed")
                  ) : saved?.pauseResumeAt ? (
                    <Trans
                      t={t}
                      i18nKey="computerUse.pauseResumeScheduled"
                      values={{ time: new Date(saved.pauseResumeAt).toLocaleString(i18n.language) }}
                      components={{ time: <time dateTime={saved.pauseResumeAt} /> }}
                    />
                  ) : (
                    t("computerUse.pauseManualStatus")
                  )
                ) : undefined
              }
              actions={
                <div className="flex min-w-0 flex-wrap gap-2">
                  {current.paused && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy || !current.enabled}
                      onClick={() => mutation.mutate({ method: "history.pause", action: "resume" })}
                    >
                      {t("computerUse.resume")}
                    </Button>
                  )}
                  <Menu>
                    <MenuTrigger
                      disabled={busy || !current.enabled}
                      render={<Button size="sm" variant="outline" />}
                    >
                      {current.paused
                        ? t("computerUse.changePauseDuration")
                        : t("computerUse.pause")}
                    </MenuTrigger>
                    <MenuPopup align="end">
                      {(
                        [
                          ["30m", t("computerUse.pause30Minutes")],
                          ["1h", t("computerUse.pause1Hour")],
                          ["tomorrow09", t("computerUse.pauseTomorrow")],
                          ["indefinite", t("computerUse.pauseIndefinite")],
                        ] as const
                      ).map(([action, label]) => (
                        <MenuItem
                          key={action}
                          disabled={busy || !current.enabled}
                          onClick={() =>
                            mutation.mutate({
                              method: "history.pause",
                              action,
                            })
                          }
                        >
                          {label}
                        </MenuItem>
                      ))}
                    </MenuPopup>
                  </Menu>
                </div>
              }
            />
            <SettingsListRow
              title={t("computerUse.captureInteractions")}
              description={t("computerUse.captureInteractionsDescription")}
              actions={
                <Switch
                  aria-label={t("computerUse.captureInteractions")}
                  checked={saved?.interactionCaptureEnabled === true}
                  disabled={busy}
                  onCheckedChange={(interactionCaptureEnabled) =>
                    configureControls({ interactionCaptureEnabled })
                  }
                />
              }
            />
            <SettingsListRow
              title={t("computerUse.aiHistorySummaries")}
              description={t("computerUse.aiHistorySummariesDescription")}
              actions={
                <Switch
                  aria-label={t("computerUse.aiHistorySummaries")}
                  checked={saved?.semanticSummariesEnabled === true}
                  disabled={busy}
                  onCheckedChange={(semanticSummariesEnabled) =>
                    configureControls({ semanticSummariesEnabled })
                  }
                />
              }
            />
            <div className="grid gap-4 px-4 py-4 @md:grid-cols-2">
              <label className="space-y-2 text-sm">
                {t("computerUse.retention")}
                <Input
                  type="number"
                  min={1}
                  max={365}
                  value={current.retentionDays}
                  onChange={(event) => updateDraft({ retentionDays: Number(event.target.value) })}
                />
              </label>
              <label className="space-y-2 text-sm">
                {t("computerUse.interval")}
                <Input
                  type="number"
                  min={5}
                  max={3600}
                  value={current.intervalSeconds}
                  onChange={(event) => updateDraft({ intervalSeconds: Number(event.target.value) })}
                />
              </label>
              <label className="space-y-2 text-sm">
                {t("computerUse.includedApps")}
                <Textarea
                  defaultValue={(current.includedBundleIds ?? []).join("\n")}
                  onChange={(event) =>
                    updateDraft({
                      includedBundleIds: event.target.value
                        .split("\n")
                        .map((value) => value.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </label>
              <label className="space-y-2 text-sm">
                {t("computerUse.includedDomains")}
                <Textarea
                  defaultValue={(current.includedDomains ?? []).join("\n")}
                  onChange={(event) =>
                    updateDraft({
                      includedDomains: event.target.value
                        .split("\n")
                        .map((value) => value.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </label>
              <p className="text-xs text-muted-foreground @md:col-span-2">
                {t("computerUse.inclusionDescription")}
              </p>
              <label className="space-y-2 text-sm">
                {t("computerUse.excludedApps")}
                <Textarea
                  defaultValue={current.excludedBundleIds.join("\n")}
                  onChange={(event) =>
                    updateDraft({
                      excludedBundleIds: event.target.value
                        .split("\n")
                        .map((value) => value.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </label>
              <label className="space-y-2 text-sm">
                {t("computerUse.excludedDomains")}
                <Textarea
                  defaultValue={current.excludedDomains.join("\n")}
                  onChange={(event) =>
                    updateDraft({
                      excludedDomains: event.target.value
                        .split("\n")
                        .map((value) => value.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </label>
              <Button size="sm" disabled={busy || !draft} onClick={saveDraft}>
                {t("computerUse.save")}
              </Button>
            </div>
          </>
        ) : (
          <SettingsListRow
            title={settings.isPending ? t("computerUse.loading") : t("computerUse.unavailable")}
          />
        )}
      </SettingsSection>
      <SettingsSection title={t("computerUse.history")}>
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div
            className="flex flex-wrap gap-2"
            role="group"
            aria-label={t("computerUse.historySource")}
          >
            <Button
              size="sm"
              variant={source === "agent" ? "secondary" : "ghost"}
              aria-pressed={source === "agent"}
              onClick={() => setSource("agent")}
            >
              {t("computerUse.agentLog")}
            </Button>
            <Button
              size="sm"
              variant={source === "passive" ? "secondary" : "ghost"}
              aria-pressed={source === "passive"}
              onClick={() => setSource("passive")}
            >
              {t("computerUse.passiveHistory")}
            </Button>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || selectedHistory.isPending}
            onClick={() => {
              mutation.reset();
              setFeedback(null);
              setClearCutoff(new Date());
              setClearRange("all");
              setClearBundle("");
              setClearSince("");
              setClearUntil("");
              setClearSource(source);
            }}
          >
            {t("computerUse.clear")}
          </Button>
        </div>
        <p className="px-4 py-3 text-xs text-muted-foreground">
          {source === "agent" ? t("computerUse.historyPrivacy") : t("computerUse.passivePrivacy")}
        </p>
        {source === "passive" && (
          <div
            className="flex flex-wrap gap-2 border-t px-4 py-3"
            role="group"
            aria-label={t("computerUse.timeline.views")}
          >
            {(["ai", "context", "counts"] as const).map((view) => (
              <Button
                key={view}
                size="sm"
                variant={passiveView === view ? "secondary" : "ghost"}
                aria-pressed={passiveView === view}
                onClick={() => setPassiveView(view)}
              >
                {t(`computerUse.timeline.${view}`)}
              </Button>
            ))}
          </div>
        )}
        {source === "passive" && !selectedHistory.isPending && (
          <div className="grid min-w-0 gap-4 border-y px-4 py-3 text-xs @md:grid-cols-2">
            <div
              className="min-w-0 space-y-1 break-words"
              role="group"
              aria-label={t("computerUse.interactionStatus")}
            >
              <p className="font-medium">{t("computerUse.interactionStatus")}</p>
              <p>
                {interactionStatus
                  ? t(`computerUse.interactionStates.${interactionStatus.state}`)
                  : t("computerUse.interactionStatusUnavailable")}
              </p>
              {interactionStatus?.reason && (
                <p>{t(`computerUse.observationFailures.${interactionStatus.reason}`)}</p>
              )}
              {interactionStatus && (
                <p>
                  {t("computerUse.interactionDropped", { count: interactionStatus.droppedRecords })}
                </p>
              )}
              <p className="text-muted-foreground">{t("computerUse.observerDescription")}</p>
            </div>
            <div
              className="min-w-0 space-y-1 break-words"
              role="group"
              aria-label={t("computerUse.summaryStatus")}
            >
              <p className="font-medium">{t("computerUse.summaryStatus")}</p>
              <p>
                {semanticStatus
                  ? t(
                      `computerUse.summaryStates.${!semanticStatus.enabled ? "disabled" : semanticStatus.running ? "running" : "idle"}`,
                    )
                  : t("computerUse.summaryStatusUnavailable")}
              </p>
              {semanticStatus && (
                <p>{t("computerUse.summaryPending", { count: semanticStatus.pending })}</p>
              )}
              {semanticStatus?.lastFailure && (
                <p>{t(`computerUse.summaryFailures.${semanticStatus.lastFailure}`)}</p>
              )}
            </div>
          </div>
        )}
        {selectedHistory.isPending && (
          <p className="px-4 py-4 text-sm text-muted-foreground">{t("computerUse.loading")}</p>
        )}
        {source === "agent" && history.data?.pages.every((page) => page.events.length === 0) && (
          <p className="px-4 py-4 text-sm text-muted-foreground">{t("computerUse.empty")}</p>
        )}
        {source === "passive" &&
          !selectedHistory.isPending &&
          !selectedHistory.isError &&
          (passiveView === "ai" ? (
            activityPage?.semanticSummaries === undefined ? (
              <p className="px-4 py-4 text-sm text-muted-foreground">
                {t("computerUse.timeline.summariesUnavailable")}
              </p>
            ) : semanticSummaries.length === 0 ? (
              <p className="px-4 py-4 text-sm text-muted-foreground">
                {t("computerUse.timeline.summariesEmpty")}
              </p>
            ) : null
          ) : (
              passiveView === "context"
                ? recordedContext.length === 0
                : activityPage?.summaries.length === 0
            ) ? (
            <p className="px-4 py-4 text-sm text-muted-foreground">
              {t(
                passiveView === "context"
                  ? "computerUse.timeline.contextEmpty"
                  : "computerUse.timeline.countsEmpty",
              )}
            </p>
          ) : null)}
        {source === "agent" ? (
          <ol className="divide-y divide-border">
            {history.data?.pages
              .flatMap((page) => page.events)
              .map((event) => (
                <li key={event.id} className="space-y-1 px-4 py-3 text-xs">
                  <div className="flex flex-wrap justify-between gap-2">
                    <span className="font-medium">
                      {event.actionType ? actionLabels[event.actionType] : eventLabels[event.type]}
                    </span>
                    <time dateTime={event.at} className="text-muted-foreground">
                      {new Date(event.at).toLocaleString(i18n.language)}
                    </time>
                  </div>
                  <p className="break-all text-muted-foreground">
                    {event.source === "agent"
                      ? t("computerUse.agentSource")
                      : t("computerUse.passiveSource")}{" "}
                    ·{" "}
                    {apps.data?.find((app) => app.bundleId === event.target.bundleId)?.name ??
                      event.target.bundleId}{" "}
                    · {event.target.bundleId}
                  </p>
                  <p className="text-muted-foreground">
                    {[
                      event.acknowledgement && acknowledgementLabels[event.acknowledgement],
                      event.effect && effectLabels[event.effect],
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </li>
              ))}
          </ol>
        ) : passiveView === "ai" ? (
          <div className="divide-y divide-border">
            {semanticSummaries.map((summary) => (
              <article
                key={summary.id}
                className="min-w-0 space-y-3 px-4 py-3 text-xs [overflow-wrap:anywhere]"
                aria-label={t("computerUse.timeline.semanticSummary")}
              >
                <div className="flex flex-wrap justify-between gap-2">
                  <h3 className="font-medium text-sm">{summary.content.title}</h3>
                  <span className="text-muted-foreground">
                    {t(
                      summary.periodSeconds === 600
                        ? "computerUse.timeline.tenMinuteSummary"
                        : "computerUse.timeline.sixHourSummary",
                    )}
                  </span>
                </div>
                <p>{summary.content.description}</p>
                <p className="text-muted-foreground">
                  <time dateTime={summary.startedAt}>
                    {new Date(summary.startedAt).toLocaleString(i18n.language)}
                  </time>
                  {" – "}
                  <time dateTime={summary.endedAt}>
                    {new Date(summary.endedAt).toLocaleString(i18n.language)}
                  </time>
                </p>
                <p>
                  {t("computerUse.timeline.applications")}:{" "}
                  {summary.content.applications.join(" · ")}
                </p>
                <div className="space-y-1 text-muted-foreground">
                  <p>
                    {t("computerUse.timeline.generatedAt")}:{" "}
                    <time dateTime={summary.generatedAt}>
                      {new Date(summary.generatedAt).toLocaleString(i18n.language)}
                    </time>
                  </p>
                  <p>
                    {t("computerUse.timeline.provider")}: {summary.provider}
                  </p>
                  <p>
                    {t("computerUse.timeline.model")}: {summary.model}
                  </p>
                </div>
                <details className="space-y-2">
                  <summary className="cursor-pointer rounded-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">
                    {t("computerUse.timeline.sourceDetails")}
                  </summary>
                  <p>
                    {t("computerUse.timeline.sourceIds")}: {summary.sourceIds.join(" · ")}
                  </p>
                  <p>
                    {t("computerUse.timeline.citations")}: {summary.content.citations.join(" · ")}
                  </p>
                  <p>
                    {t("computerUse.timeline.fingerprint")}: {summary.sourceFingerprint}
                  </p>
                </details>
                <details className="space-y-2">
                  <summary className="cursor-pointer rounded-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">
                    {t("computerUse.timeline.memory")}
                  </summary>
                  <p className="whitespace-pre-wrap">{summary.content.memory}</p>
                </details>
                <details className="space-y-2">
                  <summary className="cursor-pointer rounded-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">
                    {t("computerUse.timeline.recording")}
                  </summary>
                  <p className="whitespace-pre-wrap">{summary.content.recording}</p>
                </details>
                {summary.content.suggestion && (
                  <div className="space-y-1 rounded-md border p-2">
                    <p className="font-medium">
                      {t(
                        summary.content.suggestion.type === "skill"
                          ? "computerUse.timeline.suggestedSkill"
                          : "computerUse.timeline.suggestedAutomation",
                      )}
                      : {summary.content.suggestion.name}
                    </p>
                    <p>{summary.content.suggestion.description}</p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={
                        !suggestionDraft ||
                        suggestionDraft.pending ||
                        suggestionDraft.result?.status === "retained"
                      }
                      aria-busy={suggestionDraft?.pending ?? false}
                      onClick={async (event) => {
                        const button = event.currentTarget;
                        const result = await suggestionDraft?.review(summary);
                        if (result?.status !== "opened") {
                          if (recoveryButton.current?.isConnected) recoveryButton.current.focus();
                          else if (button.isConnected) button.focus();
                        }
                      }}
                    >
                      {t("computerUse.suggestionDraft.review")}
                    </Button>
                  </div>
                )}
              </article>
            ))}
          </div>
        ) : passiveView === "counts" ? (
          <div className="divide-y divide-border">
            <p className="px-4 py-3 text-xs text-muted-foreground">
              {t("computerUse.summaryDescription")}
            </p>
            {activityPage?.countsTruncated && (
              <p role="status" className="px-4 py-3 text-xs text-muted-foreground">
                {t("computerUse.timeline.countsTruncated")}
              </p>
            )}
            {activityPage?.summaries.map((summary) => (
              <article
                key={summary.id}
                className="space-y-2 px-4 py-3 text-xs [overflow-wrap:anywhere]"
                aria-label={t("computerUse.activitySummary")}
              >
                <div className="flex flex-wrap justify-between gap-2 font-medium">
                  <span>
                    {summary.periodSeconds === 600
                      ? t("computerUse.tenMinuteBucket")
                      : t("computerUse.sixHourBucket")}
                  </span>
                  <span>{t("computerUse.snapshotCount", { count: summary.snapshotCount })}</span>
                </div>
                <p className="text-muted-foreground">
                  <time dateTime={summary.startedAt}>
                    {new Date(summary.startedAt).toLocaleString(i18n.language)}
                  </time>
                  {" – "}
                  <time dateTime={summary.endedAt}>
                    {new Date(summary.endedAt).toLocaleString(i18n.language)}
                  </time>
                </p>
                <ul className="space-y-1 text-muted-foreground">
                  {summary.contexts.map((context) => (
                    <li key={`${context.bundleId}:${context.windowTitle}`}>
                      {context.appName} · {context.windowTitle} ·{" "}
                      {t("computerUse.snapshotCount", { count: context.count })}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {recordedContext.map((item) => {
              const record = item.record;
              return (
                <article
                  key={`${item.type}:${record.id}`}
                  data-history-record={`${item.type}:${record.id}`}
                  className="min-w-0 space-y-2 px-4 py-3 text-xs [overflow-wrap:anywhere]"
                  aria-label={t(
                    item.type === "snapshot"
                      ? "computerUse.activitySnapshot"
                      : "computerUse.timeline.recordedInteraction",
                  )}
                >
                  <div className="flex flex-wrap justify-between gap-2">
                    <span className="font-medium">
                      {t(
                        item.type === "snapshot"
                          ? "computerUse.activitySnapshot"
                          : "computerUse.timeline.recordedInteraction",
                      )}
                    </span>
                    <time dateTime={record.capturedAt} className="text-muted-foreground">
                      {new Date(record.capturedAt).toLocaleString(i18n.language)}
                    </time>
                  </div>
                  <p className="font-medium">{record.appName}</p>
                  <p>{record.windowTitle}</p>
                  <p className="text-muted-foreground">
                    {record.target.bundleId}
                    {record.domain ? ` · ${record.domain}` : ""}
                  </p>
                  {item.type === "snapshot" ? (
                    <ul
                      className="flex flex-wrap gap-1 text-muted-foreground"
                      aria-label={t("computerUse.visibleLabels")}
                    >
                      {[...new Set(item.record.labels)].map((label) => (
                        <li key={label} className="max-w-full rounded-md border px-2 py-1">
                          {label}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <>
                      <p className="font-medium">
                        {t(`computerUse.timeline.kinds.${item.record.kind}`)}
                      </p>
                      {item.record.text !== undefined && (
                        <p className="whitespace-pre-wrap">
                          {t("computerUse.timeline.recordedText")}: {item.record.text}
                        </p>
                      )}
                      {item.record.keyEquivalent !== undefined && (
                        <p>
                          {t("computerUse.timeline.key")}: {item.record.keyEquivalent}
                        </p>
                      )}
                      {item.record.modifiers && item.record.modifiers.length > 0 && (
                        <p>
                          {t("computerUse.timeline.modifiers")}:{" "}
                          {item.record.modifiers
                            .map((modifier) => t(`computerUse.timeline.modifierNames.${modifier}`))
                            .join(" · ")}
                        </p>
                      )}
                      {item.record.mouse && (
                        <div className="space-y-1">
                          {item.record.mouse.button !== undefined && (
                            <p>
                              {t("computerUse.timeline.mouseButton")}:{" "}
                              {t(`computerUse.timeline.mouseButtons.${item.record.mouse.button}`)}
                            </p>
                          )}
                          {item.record.mouse.clickCount !== undefined && (
                            <p>
                              {t("computerUse.timeline.clickCount")}: {item.record.mouse.clickCount}
                            </p>
                          )}
                          {item.record.mouse.origin && (
                            <p>
                              {t("computerUse.timeline.origin")}: {item.record.mouse.origin.x},{" "}
                              {item.record.mouse.origin.y}
                            </p>
                          )}
                          {item.record.mouse.destination && (
                            <p>
                              {t("computerUse.timeline.destination")}:{" "}
                              {item.record.mouse.destination.x}, {item.record.mouse.destination.y}
                            </p>
                          )}
                          {item.record.mouse.deltaX !== undefined && (
                            <p>
                              {t("computerUse.timeline.deltaX")}: {item.record.mouse.deltaX}
                            </p>
                          )}
                          {item.record.mouse.deltaY !== undefined && (
                            <p>
                              {t("computerUse.timeline.deltaY")}: {item.record.mouse.deltaY}
                            </p>
                          )}
                        </div>
                      )}
                      {item.record.selection && (
                        <div className="space-y-1">
                          {item.record.selection.text !== undefined && (
                            <p className="whitespace-pre-wrap">
                              {t("computerUse.timeline.selectionText")}:{" "}
                              {item.record.selection.text}
                            </p>
                          )}
                          {item.record.selection.location !== undefined && (
                            <p>
                              {t("computerUse.timeline.selectionLocation")}:{" "}
                              {item.record.selection.location}
                            </p>
                          )}
                          {item.record.selection.length !== undefined && (
                            <p>
                              {t("computerUse.timeline.selectionLength")}:{" "}
                              {item.record.selection.length}
                            </p>
                          )}
                        </div>
                      )}
                      {item.record.ax && (
                        <details className="space-y-2">
                          <summary className="cursor-pointer rounded-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">
                            {t(
                              item.record.ax.mode === "full"
                                ? "computerUse.timeline.axFull"
                                : "computerUse.timeline.axDiff",
                            )}
                          </summary>
                          <p className="whitespace-pre-wrap">{item.record.ax.text}</p>
                        </details>
                      )}
                    </>
                  )}
                </article>
              );
            })}
          </div>
        )}
        {(source === "agent" || passiveView !== "counts") && selectedHistory.hasNextPage && (
          <div className="px-4 py-3">
            <Button
              size="sm"
              variant="outline"
              disabled={selectedHistory.isFetchingNextPage}
              onClick={() => void selectedHistory.fetchNextPage()}
            >
              {t(
                source === "passive" && passiveView === "ai"
                  ? "computerUse.timeline.loadMoreSummaries"
                  : "computerUse.loadMore",
              )}
            </Button>
          </div>
        )}
      </SettingsSection>
      <AlertDialog
        open={clearSource !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setClearSource(null);
        }}
      >
        <AlertDialogPopup className="overflow-y-auto bg-background">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("computerUse.clearTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {clearSource === "agent"
                ? t("computerUse.clearAgentDescription")
                : t("computerUse.clearPassiveDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {clearSource === "passive" && (
            <div className="space-y-3 px-4 py-2 text-sm">
              <label className="block space-y-1">
                <span>{t("computerUse.clearScope.range")}</span>
                <select
                  className="h-9 w-full rounded-md border bg-background px-2"
                  value={clearRange}
                  disabled={busy}
                  onChange={(event) => {
                    mutation.reset();
                    setClearRange(event.target.value as HistoryClearRange);
                  }}
                >
                  {(["all", "10m", "1h", "today", "custom"] as const).map((range) => (
                    <option key={range} value={range}>
                      {t(`computerUse.clearScope.${range}`)}
                    </option>
                  ))}
                </select>
              </label>
              {clearRange === "custom" ? (
                <div className="grid min-w-0 gap-3 @md:grid-cols-2">
                  <label className="min-w-0 space-y-1">
                    <span>{t("computerUse.clearScope.from")}</span>
                    <Input
                      nativeInput
                      type="datetime-local"
                      value={clearSince}
                      disabled={busy}
                      onChange={(event) => {
                        mutation.reset();
                        setClearSince(event.target.value);
                      }}
                    />
                  </label>
                  <label className="min-w-0 space-y-1">
                    <span>{t("computerUse.clearScope.until")}</span>
                    <Input
                      nativeInput
                      type="datetime-local"
                      value={clearUntil}
                      disabled={busy}
                      onChange={(event) => {
                        mutation.reset();
                        setClearUntil(event.target.value);
                      }}
                    />
                  </label>
                </div>
              ) : null}
              {clearRequest?.method === "activity.clear" &&
                clearRequest.since &&
                clearRequest.until && (
                  <p className="break-words text-xs text-muted-foreground">
                    {t("computerUse.clearScope.interval")}{" "}
                    <time dateTime={clearRequest.since}>
                      {new Date(clearRequest.since).toLocaleString(i18n.resolvedLanguage, {
                        timeZoneName: "short",
                      })}
                    </time>{" "}
                    {" – "}
                    <time data-testid="history-clear-cutoff" dateTime={clearRequest.until}>
                      {new Date(clearRequest.until).toLocaleString(i18n.resolvedLanguage, {
                        timeZoneName: "short",
                      })}
                    </time>
                  </p>
                )}
              <label className="block space-y-1">
                <span>{t("computerUse.clearScope.app")}</span>
                <Input
                  value={clearBundle}
                  list={`${instance}-clear-apps`}
                  disabled={busy}
                  placeholder="com.example.app"
                  onChange={(event) => {
                    mutation.reset();
                    setClearBundle(event.target.value);
                  }}
                />
              </label>
              <datalist id={`${instance}-clear-apps`}>
                {[...new Map((apps.data ?? []).map((app) => [app.bundleId, app])).values()].map(
                  (app) => (
                    <option key={app.bundleId} value={app.bundleId}>
                      {app.name}
                    </option>
                  ),
                )}
              </datalist>
              <p className="text-xs text-muted-foreground">{t("computerUse.clearScope.appHelp")}</p>
              {!clearRequest && (
                <p role="alert" className="text-destructive">
                  {t("computerUse.clearScope.invalid")}
                </p>
              )}
            </div>
          )}
          {mutation.isError && (
            <p role="alert" className="break-words px-4 text-sm text-destructive">
              {mutation.error.message}
            </p>
          )}
          {mutation.isPending && (
            <p role="status" className="px-4 text-sm">
              {t("computerUse.clearScope.pending")}
            </p>
          )}
          <AlertDialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setClearSource(null)}>
              {t("computerUse.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={busy || !clearRequest}
              onClick={() => {
                if (clearSource && clearRequest) mutation.mutate(clearRequest);
              }}
            >
              {t("computerUse.confirmClear")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </div>
  );
}
