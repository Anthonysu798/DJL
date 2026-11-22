// FILE: UsageRingButton.tsx
// Purpose: Sidebar ring showing the lowest remaining limit across every connected
// subscription. Hover names that limit; click lists each subscription's usage.

import type { ProviderKind } from "@synara/contracts";
import { PROVIDER_USAGE_PROVIDERS } from "@synara/shared/providerUsage";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";

import { CLOUD_ACCOUNT_QUERY_KEY } from "~/components/settings/DjlCloudAccountCard";
import { PILL_CLASS_NAME, statusPill } from "~/components/settings/ProviderUsageSettingsPanel";
import { CentralIcon } from "~/lib/central-icons";
import type { ProviderUsageTone } from "~/lib/providerUsageDisplay";
import { createAccountRateLimitsSelector } from "~/lib/rateLimits";
import {
  fetchAllProviderUsage,
  serverAllProviderUsageQueryOptions,
  serverConfigQueryOptions,
  serverQueryKeys,
} from "~/lib/serverReactQuery";
import {
  deriveUsageRingEntries,
  finishedTurnProviders,
  runningTurnsKey,
  selectLowestUsageRow,
  type UsageRingEntry,
} from "~/lib/usageRing";
import { cn } from "~/lib/utils";
import { ensureNativeApi } from "~/nativeApi";
import { useStore } from "~/store";

import { ProviderIcon } from "./ProviderIcon";
import { ProviderUsageLimitRows } from "./ProviderUsageLimitRows";
import { ProviderUsageLineList } from "./ProviderUsageLineList";
import { Popover, PopoverClose, PopoverPopup, PopoverTrigger } from "./ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

// The ring is always mounted, so with no chat working it polls far less often than
// Settings → Usage. While a turn runs, and for a short while after, it keeps the server's
// own one-minute pace: asking faster would only return the server's cached answer.
const IDLE_REFETCH_INTERVAL_MS = 5 * 60_000;
const ACTIVE_REFETCH_INTERVAL_MS = 60_000;
const ACTIVE_TAIL_MS = 90_000;
const OPEN_REFETCH_AGE_MS = 60_000;
// Vendors throttle their usage endpoints, so quick back-to-back turns share one forced read.
const FORCED_REFRESH_GAP_MS = 20_000;

const RING_RADIUS = 8;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const RING_TONE_CLASS_NAME: Record<ProviderUsageTone, string> = {
  healthy: "text-emerald-500",
  warning: "text-amber-500",
  danger: "text-red-500",
};

function UsageRingEntryBlock({ entry }: { entry: UsageRingEntry }) {
  const { t } = useTranslation("settings");
  const pill = statusPill(entry.status, t);
  const hasUsage = entry.rows.length > 0 || entry.usageLines.length > 0 || entry.credits !== null;

  return (
    <section aria-label={entry.name} className="space-y-2 py-3 first:pt-0">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <ProviderIcon provider={entry.provider} className="size-4 shrink-0" />
          <span className="truncate text-xs font-semibold text-foreground">{entry.name}</span>
        </div>
        {pill ? (
          <span className={cn(PILL_CLASS_NAME, pill.className)}>{pill.label}</span>
        ) : entry.planName ? (
          <span className={cn(PILL_CLASS_NAME, "bg-muted text-muted-foreground capitalize")}>
            {entry.planName}
          </span>
        ) : null}
      </div>
      <ProviderUsageLimitRows rows={entry.rows} surface="popover" />
      {entry.usageLines.length > 0 ? (
        <ProviderUsageLineList lines={entry.usageLines} surface="popover" />
      ) : null}
      {entry.credits !== null ? (
        <p className="text-[11px] text-muted-foreground">
          {t("cloud.credits", { credits: entry.credits })}
        </p>
      ) : null}
      {entry.status === "ok" && !hasUsage ? (
        <p className="text-[11px] text-muted-foreground">{t("usage.noLimitData")}</p>
      ) : null}
      {entry.source ? (
        <p className="text-[10px] text-muted-foreground/80">
          {t("usage.source", { source: entry.source })}
        </p>
      ) : null}
    </section>
  );
}

export function UsageRingButton(props: { rail?: boolean; onManageUsage: () => void }) {
  const { t, i18n } = useTranslation("settings");
  const queryClient = useQueryClient();
  const runningTurns = useStore((state) => runningTurnsKey(state.threadSessionById));
  const previousRunningTurns = useRef(runningTurns);
  const activeUntil = useRef(0);
  const forcedAt = useRef(new Map<ProviderKind, number>());
  const refetchInterval = () =>
    runningTurns || Date.now() < activeUntil.current
      ? ACTIVE_REFETCH_INTERVAL_MS
      : IDLE_REFETCH_INTERVAL_MS;
  const usage = useQuery({
    ...serverAllProviderUsageQueryOptions(),
    refetchInterval,
    refetchIntervalInBackground: false,
  });
  const cloud = useQuery({
    queryKey: CLOUD_ACCOUNT_QUERY_KEY,
    queryFn: () => ensureNativeApi().cloud.getStatus(),
    staleTime: 15_000,
    refetchInterval: runningTurns.includes(":djlCloud") ? ACTIVE_REFETCH_INTERVAL_MS : false,
  });
  // A finished turn has just spent quota: read that agent's limits again past the server's
  // cache. A group chat does not say which agents answered, so it re-reads without forcing.
  useEffect(() => {
    const finished = finishedTurnProviders(previousRunningTurns.current, runningTurns);
    previousRunningTurns.current = runningTurns;
    if (finished.length === 0) return;
    const now = Date.now();
    activeUntil.current = now + ACTIVE_TAIL_MS;
    const forced = finished.filter(
      (provider) =>
        PROVIDER_USAGE_PROVIDERS.includes(provider) &&
        now - (forcedAt.current.get(provider) ?? 0) > FORCED_REFRESH_GAP_MS,
    );
    for (const provider of forced) forcedAt.current.set(provider, now);
    void Promise.allSettled(
      forced.map((provider) => fetchAllProviderUsage({ forceRefresh: true, provider })),
    ).then(() =>
      queryClient.invalidateQueries({ queryKey: serverQueryKeys.allProviderUsage().slice(0, 2) }),
    );
    if (finished.some((provider) => provider === "djlCloud" || provider === "group")) {
      void queryClient.invalidateQueries({ queryKey: CLOUD_ACCOUNT_QUERY_KEY });
    }
  }, [queryClient, runningTurns]);
  const config = useQuery(serverConfigQueryOptions());
  // Limits reported mid-turn; the selector stays equal while replies stream.
  const liveRateLimits = useStore(useMemo(() => createAccountRateLimitsSelector(), []));
  const entries = useMemo(
    () =>
      deriveUsageRingEntries({
        snapshots: usage.data ?? [],
        providerStatuses: config.data?.providers ?? [],
        cloud: cloud.data,
        liveRateLimits,
        t,
        locale: i18n.resolvedLanguage ?? i18n.language,
      }),
    [
      cloud.data,
      config.data?.providers,
      i18n.language,
      i18n.resolvedLanguage,
      liveRateLimits,
      t,
      usage.data,
    ],
  );
  const lowest = useMemo(() => selectLowestUsageRow(entries), [entries]);
  const loading = !lowest && (usage.isPending || cloud.isPending);
  const summary = lowest
    ? `${lowest.entry.name} · ${lowest.row.label} · ${lowest.row.leftText}`
    : loading
      ? t("usage.loading")
      : t("usage.noLimitData");
  const side = props.rail ? "right" : "top";

  return (
    <Popover
      onOpenChange={(open) => {
        if (!open) return;
        // Never a forced refresh: the server decides whether its own cache is still good.
        for (const query of [usage, cloud]) {
          if (Date.now() - query.dataUpdatedAt > OPEN_REFETCH_AGE_MS) {
            void query.refetch({ cancelRefetch: false });
          }
        }
      }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <button
                  type="button"
                  data-testid="usage-ring-button"
                  aria-label={summary}
                  className={
                    props.rail
                      ? "djl-desktop-rail-button"
                      : "sidebar-icon-button flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                  }
                />
              }
            >
              <svg
                viewBox="0 0 20 20"
                className={cn(
                  "size-5 -rotate-90",
                  lowest && RING_TONE_CLASS_NAME[lowest.row.remainingTone],
                )}
                aria-hidden="true"
              >
                <circle
                  cx="10"
                  cy="10"
                  r={RING_RADIUS}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  className="opacity-25"
                />
                {lowest && lowest.row.remainingPercent > 0 ? (
                  <circle
                    cx="10"
                    cy="10"
                    r={RING_RADIUS}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeDasharray={RING_CIRCUMFERENCE}
                    strokeDashoffset={RING_CIRCUMFERENCE * (1 - lowest.row.remainingPercent / 100)}
                    className="transition-[stroke-dashoffset] duration-500 ease-out motion-reduce:transition-none"
                  />
                ) : null}
              </svg>
            </PopoverTrigger>
          }
        />
        <TooltipPopup side={side}>{summary}</TooltipPopup>
      </Tooltip>
      <PopoverPopup side={side} align="end" sideOffset={10} className="w-80">
        <div className="text-sm font-semibold text-foreground">
          {t("navigation.items.usage.label")}
        </div>
        <div className="mt-3 divide-y divide-border border-b border-border">
          {entries.length === 0 ? (
            <p className="pb-3 text-xs text-muted-foreground">
              {loading ? t("usage.loading") : t("usage.noLimitData")}
            </p>
          ) : (
            entries.map((entry) => <UsageRingEntryBlock key={entry.provider} entry={entry} />)
          )}
        </div>
        <PopoverClose
          render={
            <button
              type="button"
              className="-mx-2 mt-2 flex w-[calc(100%+1rem)] items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-medium text-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
              onClick={props.onManageUsage}
            />
          }
        >
          <CentralIcon name="gauge" className="size-4 text-muted-foreground" />
          {t("usage.manage")}
        </PopoverClose>
      </PopoverPopup>
    </Popover>
  );
}
