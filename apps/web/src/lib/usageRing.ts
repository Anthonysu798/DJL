// FILE: usageRing.ts
// Purpose: One entry per connected subscription for the sidebar usage ring and its
// popover. Rows are derived per provider and never merged, so Codex "Weekly" and
// Claude "Weekly" stay separate and the ring can name the one that is lowest.

import {
  DEFAULT_CLI_ACCOUNT_ID,
  PROVIDER_DISPLAY_NAMES,
  type CliAccountProvider,
  type CliAccountSetting,
  type CliAccountUsage,
  type CloudAccountStatus,
  type ProviderKind,
  type ProviderUsageStatus,
  type ServerProviderStatus,
  type ServerProviderUsageSnapshot,
} from "@djl/contracts";
import { PROVIDER_USAGE_PROVIDERS } from "@djl/shared/providerUsage";
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
  /** Unique per row: the provider, or `provider:accountId` for an extra AI account. */
  key: string;
  provider: ProviderKind;
  name: string;
  /**
   * Set only when the provider has extra AI accounts: whether new chats use this one. Spare
   * accounts are listed but never drive the ring.
   */
  inUse: boolean | null;
  planName: string | null;
  /** Only "ok" entries carry rows; an "ok" entry without rows has no limit data. */
  status: ProviderUsageStatus;
  /** The provider's own CLI reports a signed-in account, whatever the usage fetch said. */
  cliSignedIn: boolean;
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
    key: "djlCloud",
    provider: "djlCloud",
    inUse: null,
    name: PROVIDER_DISPLAY_NAMES.djlCloud,
    planName: usage?.planId ?? null,
    status: cloud.problem ? "error" : "ok",
    cliSignedIn: true,
    rows,
    usageLines: [],
    credits: cloud.problem ? null : (cloud.credits?.display.total ?? null),
    source: null,
  };
}

/**
 * Whether the CLI itself says it is signed in. The usage fetch reads stored tokens directly,
 * so an expired or unreadable token there must not be shown as "Not signed in".
 */
export function isCliSignedIn(
  provider: ProviderKind,
  providerStatuses: ReadonlyArray<ServerProviderStatus>,
): boolean {
  return providerStatuses.some(
    (status) => status.provider === provider && status.authStatus === "authenticated",
  );
}

function snapshotEntry(
  snapshot: ServerProviderUsageSnapshot,
  liveRateLimits: ReadonlyArray<ProviderRateLimit>,
  options: DisplayOptions,
  cliSignedIn: boolean,
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
    key: snapshot.provider,
    provider: snapshot.provider,
    inUse: null,
    name: PROVIDER_DISPLAY_NAMES[snapshot.provider],
    planName: status === "ok" ? (snapshot.planName ?? null) : null,
    status,
    cliSignedIn,
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
    /** Extra Claude / Codex subscription accounts (Settings → AI accounts). */
    aiAccounts?: {
      accounts: ReadonlyArray<Pick<CliAccountSetting, "id" | "provider" | "name">>;
      active: Partial<Record<CliAccountProvider, string>>;
      usage: ReadonlyArray<CliAccountUsage>;
      /** Name for the CLI's normal login once a provider has more than one account. */
      mainLabel: string;
    };
  } & DisplayOptions,
): UsageRingEntry[] {
  const entries: UsageRingEntry[] = [];
  if (input.cloud?.signedIn && input.cloud.problem !== "session_expired") {
    entries.push(cloudEntry(input.cloud, input));
  }
  for (const provider of PROVIDER_USAGE_PROVIDERS) {
    const snapshot = input.snapshots.find((candidate) => candidate.provider === provider);
    const extras =
      provider === "claudeAgent" || provider === "codex"
        ? (input.aiAccounts?.accounts.filter((account) => account.provider === provider) ?? [])
        : [];
    const activeId =
      provider === "claudeAgent" || provider === "codex"
        ? (input.aiAccounts?.active[provider] ?? DEFAULT_CLI_ACCOUNT_ID)
        : DEFAULT_CLI_ACCOUNT_ID;
    const mainInUse = !extras.some((account) => account.id === activeId);
    // Limits reported mid-turn come from whichever account the chats are using.
    const liveFor = (inUse: boolean) => (inUse ? (input.liveRateLimits ?? []) : []);
    if (snapshot) {
      const entry = snapshotEntry(
        snapshot,
        liveFor(mainInUse),
        input,
        isCliSignedIn(provider, input.providerStatuses),
      );
      if (extras.length > 0 && input.aiAccounts) {
        entry.name = `${entry.name} · ${input.aiAccounts.mainLabel}`;
        entry.inUse = mainInUse;
      }
      entries.push(entry);
    }
    for (const account of extras) {
      const usage = input.aiAccounts?.usage.find(
        (item) => item.provider === provider && item.accountId === account.id,
      )?.snapshot;
      if (!usage) continue;
      const inUse = account.id === activeId;
      const entry = snapshotEntry(usage, liveFor(inUse), input, false);
      entry.key = `${provider}:${account.id}`;
      entry.name = `${PROVIDER_DISPLAY_NAMES[provider]} · ${account.name}`;
      entry.inUse = inUse;
      entries.push(entry);
    }
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
      key: status.provider,
      provider: status.provider,
      inUse: null,
      name: PROVIDER_DISPLAY_NAMES[status.provider],
      planName: null,
      status: "ok",
      cliSignedIn: true,
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
    // A spare AI account running low is not a problem until the user switches to it.
    if (entry.inUse === false) continue;
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
