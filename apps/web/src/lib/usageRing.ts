// FILE: usageRing.ts
// Purpose: One entry per connected subscription for the sidebar usage ring and its
// popover. Rows are derived per provider and never merged, so Codex "Weekly" and
// Claude "Weekly" stay separate and the ring can name the one that is lowest.

import {
  PROVIDER_DISPLAY_NAMES,
  type CloudAccountStatus,
  type ProviderKind,
  type ProviderUsageStatus,
  type ServerProviderStatus,
  type ServerProviderUsageSnapshot,
} from "@synara/contracts";
import { PROVIDER_USAGE_PROVIDERS } from "@synara/shared/providerUsage";
import type { TFunction } from "i18next";

import type { OpenUsageUsageLine } from "./openUsageRateLimits";
import {
  deriveProviderUsageDisplayRows,
  selectPrimaryProviderUsageDisplayRow,
  type ProviderUsageDisplayRow,
} from "./providerUsageDisplay";
import {
  normalizeServerProviderUsageLines,
  normalizeServerProviderUsageRateLimit,
} from "./providerUsageSnapshot";
import {
  mergeProviderRateLimits,
  type ProviderRateLimit,
  type RateLimitWindow,
} from "./rateLimits";

export interface UsageRingEntry {
  provider: ProviderKind;
  name: string;
  planName: string | null;
  /** Only "ok" entries carry rows; an "ok" entry without rows has no limit data. */
  status: ProviderUsageStatus;
  rows: ProviderUsageDisplayRow[];
  usageLines: OpenUsageUsageLine[];
  /** DJL Cloud credit balance, ready to render. */
  credits: string | null;
  source: string | null;
}

export interface LowestUsageRow {
  entry: UsageRingEntry;
  row: ProviderUsageDisplayRow;
}

interface DisplayOptions {
  t?: TFunction;
  locale?: string;
}

function cloudEntry(cloud: CloudAccountStatus, options: DisplayOptions): UsageRingEntry {
  const usage = cloud.problem ? undefined : cloud.usage;
  // Same maths as the DJL Cloud card in Settings: a window with no limit has no percentage.
  const limits = (usage ? [usage.windows.fiveHour, usage.windows.week] : []).flatMap(
    (window): RateLimitWindow[] => {
      const limit = Number(window.limit);
      const remaining = Number(window.remaining);
      if (!(limit > 0) || !Number.isFinite(limit) || !Number.isFinite(remaining)) return [];
      return [
        {
          window: window.kind === "five_hour" ? "5h" : "Weekly",
          usedPercent: 100 - Math.min(100, Math.max(0, (remaining / limit) * 100)),
          ...(window.resetsAt ? { resetsAt: window.resetsAt } : {}),
        },
      ];
    },
  );
  const rows = deriveProviderUsageDisplayRows(
    [{ provider: "djlCloud", updatedAt: cloud.checkedAt, limits }],
    options,
  );
  // The 5-hour window rolls, so its reset time says nothing about pace.
  for (const row of rows) {
    row.pace = null;
    row.markerPercent = null;
    row.paceTone = row.remainingTone;
  }
  return {
    provider: "djlCloud",
    name: PROVIDER_DISPLAY_NAMES.djlCloud,
    planName: usage?.planId ?? null,
    status: cloud.problem ? "error" : "ok",
    rows,
    usageLines: [],
    credits: cloud.problem ? null : (cloud.credits?.display.total ?? null),
    source: null,
  };
}

function snapshotEntry(
  snapshot: ServerProviderUsageSnapshot,
  liveRateLimits: ReadonlyArray<ProviderRateLimit>,
  options: DisplayOptions,
): UsageRingEntry {
  const status = snapshot.status ?? "ok";
  const snapshotRateLimit =
    status === "ok" ? normalizeServerProviderUsageRateLimit(snapshot) : null;
  // Same merge as Settings → Usage: each window takes the newer of the two readings.
  const [rateLimit] =
    status === "ok"
      ? mergeProviderRateLimits(
          liveRateLimits.filter((live) => live.provider === snapshot.provider),
          snapshotRateLimit ? [snapshotRateLimit] : [],
        )
      : [];
  return {
    provider: snapshot.provider,
    name: PROVIDER_DISPLAY_NAMES[snapshot.provider],
    planName: status === "ok" ? (snapshot.planName ?? null) : null,
    status,
    rows: rateLimit ? deriveProviderUsageDisplayRows([rateLimit], options) : [],
    usageLines: status === "ok" ? normalizeServerProviderUsageLines(snapshot) : [],
    credits: null,
    source: status === "ok" ? snapshot.source : null,
  };
}

/**
 * DJL Cloud first (omitted when signed out), then the providers that report usage,
 * then signed-in agents that report none.
 */
export function deriveUsageRingEntries(
  input: {
    snapshots: ReadonlyArray<ServerProviderUsageSnapshot>;
    providerStatuses: ReadonlyArray<ServerProviderStatus>;
    cloud: CloudAccountStatus | null | undefined;
    /** Limits the agents reported during turns; see createAccountRateLimitsSelector. */
    liveRateLimits?: ReadonlyArray<ProviderRateLimit>;
  } & DisplayOptions,
): UsageRingEntry[] {
  const entries: UsageRingEntry[] = [];
  if (input.cloud?.signedIn && input.cloud.problem !== "session_expired") {
    entries.push(cloudEntry(input.cloud, input));
  }
  for (const provider of PROVIDER_USAGE_PROVIDERS) {
    const snapshot = input.snapshots.find((candidate) => candidate.provider === provider);
    if (snapshot) entries.push(snapshotEntry(snapshot, input.liveRateLimits ?? [], input));
  }
  for (const status of input.providerStatuses) {
    if (
      !status.available ||
      status.authStatus !== "authenticated" ||
      status.provider === "djlCloud" ||
      status.provider === "group" ||
      PROVIDER_USAGE_PROVIDERS.includes(status.provider)
    ) {
      continue;
    }
    entries.push({
      provider: status.provider,
      name: PROVIDER_DISPLAY_NAMES[status.provider],
      planName: null,
      status: "ok",
      rows: [],
      usageLines: [],
      credits: null,
      source: null,
    });
  }
  return entries;
}

/** The row with the least left across every subscription; null when none reports a limit. */
export function selectLowestUsageRow(
  entries: ReadonlyArray<UsageRingEntry>,
): LowestUsageRow | null {
  let lowest: LowestUsageRow | null = null;
  for (const entry of entries) {
    const row = selectPrimaryProviderUsageDisplayRow(entry.rows);
    if (row && (!lowest || row.remainingPercent < lowest.row.remainingPercent)) {
      lowest = { entry, row };
    }
  }
  return lowest;
}

/**
 * The chats with a turn in progress as "threadId:provider" pairs. A string, so a store
 * selector returning it stays equal across the many updates that change nothing here.
 */
export function runningTurnsKey(
  sessions:
    | Readonly<Record<string, { provider: ProviderKind; orchestrationStatus: string } | null>>
    | undefined,
): string {
  return Object.entries(sessions ?? {})
    .flatMap(([threadId, session]) =>
      session?.orchestrationStatus === "running" ? [`${threadId}:${session.provider}`] : [],
    )
    .toSorted()
    .join("|");
}

/** The agents whose turn was in `previousKey` and is gone from `nextKey`: they just used quota. */
export function finishedTurnProviders(previousKey: string, nextKey: string): ProviderKind[] {
  const stillRunning = new Set(nextKey.split("|"));
  const finished = previousKey
    .split("|")
    .filter((turn) => turn && !stillRunning.has(turn))
    .map((turn) => turn.slice(turn.lastIndexOf(":") + 1) as ProviderKind);
  return [...new Set(finished)];
}
