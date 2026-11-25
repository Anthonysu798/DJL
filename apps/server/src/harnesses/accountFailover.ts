// FILE: accountFailover.ts
// Purpose: Pure rules for continuing a chat on another subscription account when the current
//          one hits its usage limit: is a failure a usage limit, and which account has the most
//          usage left. The AccountFailoverReactor applies them.
// Layer: Server harness helper (no Effect, no IO).

import type {
  CliAccountProvider,
  CliAccountSummary,
  ServerProviderUsageSnapshot,
} from "@djl/contracts";

const USAGE_LIMIT_PATTERN =
  /\b(usage limit|hit your (?:usage )?limit|limit reached|reached your (?:usage )?limit|rate[\s_-]?limit(?:ed)?|too many requests|quota|429)\b/i;

/** True when a failed turn's message reads like a subscription usage limit. */
export function isUsageLimitMessage(message: string | null | undefined): boolean {
  return Boolean(message && USAGE_LIMIT_PATTERN.test(message));
}

/** Share of usage left (0–100): the tighter of the 5-hour and weekly windows. Unknown = 50. */
export function remainingUsagePercent(
  snapshot: ServerProviderUsageSnapshot | null | undefined,
): number {
  const used = (snapshot?.limits ?? [])
    .filter((limit) => /^(5h|weekly)$/i.test(limit.window))
    .flatMap((limit) => (typeof limit.usedPercent === "number" ? [limit.usedPercent] : []));
  return used.length === 0 ? 50 : Math.max(0, 100 - Math.max(...used));
}

export interface FailoverChoiceInput {
  readonly provider: CliAccountProvider;
  readonly accounts: ReadonlyArray<CliAccountSummary>;
  readonly usage: ReadonlyArray<{
    readonly accountId: string;
    readonly provider: CliAccountProvider;
    readonly snapshot: ServerProviderUsageSnapshot | null;
  }>;
  /** Accounts already tried for this message, including the one that just hit its limit. */
  readonly tried: ReadonlySet<string>;
  /** Accounts known to be limited, with the time (ms) their limit resets. */
  readonly limitedUntil: ReadonlyMap<string, number>;
  readonly now: number;
}

/** The signed-in account of the same app with the most usage left, or null when none is usable. */
export function pickFailoverAccount(input: FailoverChoiceInput): CliAccountSummary | null {
  const candidates = input.accounts
    .filter((account) => account.provider === input.provider && account.status === "signedIn")
    .filter((account) => !input.tried.has(account.id))
    .filter((account) => (input.limitedUntil.get(account.id) ?? 0) <= input.now)
    .map((account) => ({
      account,
      left: remainingUsagePercent(
        input.usage.find(
          (entry) => entry.provider === input.provider && entry.accountId === account.id,
        )?.snapshot,
      ),
    }))
    .filter((candidate) => candidate.left > 5);
  candidates.sort((a, b) => b.left - a.left);
  return candidates[0]?.account ?? null;
}
