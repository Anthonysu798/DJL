// FILE: limitSwitch.ts
// Purpose: Decide when a chat's agent is running out of quota and which signed-in agent
// the chat could continue with instead. Pure: the banner only renders what this returns.

import type { ProviderKind, ServerProviderStatus } from "@djl/contracts";

import {
  selectPrimaryProviderUsageDisplayRow,
  type ProviderUsageDisplayRow,
} from "./providerUsageDisplay";
import { resolveAvailableHandoffTargetProviders } from "./threadHandoff";
import type { UsageRingEntry } from "./usageRing";

/** At or below this much left, a limit counts as low. */
export const LOW_LIMIT_REMAINING_PERCENT = 10;

const RATE_LIMIT_ERROR_PATTERN = /rate[\s_-]?limit|usage limit|too many requests|\b429\b/i;

/** The agent's lowest window when it is at or below the low threshold. */
export function selectLowLimitRow(
  entry: UsageRingEntry | null | undefined,
): ProviderUsageDisplayRow | null {
  const row = entry?.status === "ok" ? selectPrimaryProviderUsageDisplayRow(entry.rows) : null;
  return row && row.remainingPercent <= LOW_LIMIT_REMAINING_PERCENT ? row : null;
}

/** True when a turn error reads as a provider rate or usage limit. */
export function isRateLimitError(message: string | null | undefined): boolean {
  return Boolean(message && RATE_LIMIT_ERROR_PATTERN.test(message));
}

/**
 * The agent to continue with: a signed-in handoff target with the most quota left.
 * Agents with known quota come first; one that is itself low is never offered.
 */
export function pickLimitSwitchTarget(input: {
  current: ProviderKind;
  entries: ReadonlyArray<UsageRingEntry>;
  providerStatuses: ReadonlyArray<ServerProviderStatus>;
}): UsageRingEntry | null {
  const targets = resolveAvailableHandoffTargetProviders(input.current);
  let best: { entry: UsageRingEntry; remaining: number } | null = null;
  for (const entry of input.entries) {
    // A spare AI account is not something the chat can switch to.
    if (entry.inUse === false) continue;
    if (entry.status !== "ok" || !targets.includes(entry.provider)) continue;
    const status = input.providerStatuses.find(
      (candidate) => candidate.provider === entry.provider,
    );
    if (status && (!status.available || status.authStatus === "unauthenticated")) continue;
    const row = selectPrimaryProviderUsageDisplayRow(entry.rows);
    if (row && row.remainingPercent <= LOW_LIMIT_REMAINING_PERCENT) continue;
    // Unknown quota ranks below any known amount that is not low.
    const remaining = row ? row.remainingPercent : -1;
    if (!best || remaining > best.remaining) best = { entry, remaining };
  }
  return best?.entry ?? null;
}

/** One key per agent and limit window, so a dismissed notice returns only after a reset. */
export function limitSwitchNoticeKey(
  row: Pick<ProviderUsageDisplayRow, "id" | "resetsAt">,
): string {
  // Row ids are "<provider>-<window>".
  return `${row.id}|${row.resetsAt ?? ""}`;
}
