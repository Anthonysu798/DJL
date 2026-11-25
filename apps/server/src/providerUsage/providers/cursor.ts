// FILE: providerUsage/providers/cursor.ts
// Purpose: Live Cursor usage fetcher. Reads the cursor-agent token from the macOS keychain
// ("cursor-access-token") and the editor's state.vscdb (key cursorAuth/accessToken),
// read-only, using the first that is unexpired and accepted, then calls the Cursor DashboardService (Connect RPC) for the current billing
// period usage + credit grants. Reference: openusage plugins/cursor/plugin.js.

import nodePath from "node:path";

import type { ServerProviderUsageLimit, ServerProviderUsageLine } from "@djl/contracts";

import { decodeJwtExpMs, readKeychainPassword } from "../credentials";
import { fetchJson, isAuthFailureStatus } from "../http";
import {
  asFiniteNumber,
  asRecord,
  asString,
  buildSnapshot,
  clampPercent,
  errorSnapshot,
  formatUsd,
  isoFromUnixMillis,
  needsAuthSnapshot,
  titleCase,
} from "../parse";
import { readItemTableValues } from "../sqlite";
import type { ProviderUsageContext, ProviderUsageFetcher } from "../types";

const SOURCE = "cursor-dashboard";
const USAGE_URL = "https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage";
const CREDITS_URL = "https://api2.cursor.sh/aiserver.v1.DashboardService/GetCreditGrantsBalance";
const KEYCHAIN_SERVICE = "cursor-access-token";
const ACCESS_TOKEN_KEY = "cursorAuth/accessToken";
const PLAN_KEY = "cursorAuth/stripeMembershipType";

interface CursorAuth {
  accessToken: string;
  plan?: string;
}

function stateDbPaths(ctx: ProviderUsageContext): string[] {
  const segments = ["Cursor", "User", "globalStorage", "state.vscdb"];
  if (ctx.platform === "darwin") {
    return [nodePath.join(ctx.homeDir, "Library", "Application Support", ...segments)];
  }
  if (ctx.platform === "win32" && ctx.env.APPDATA) {
    return [nodePath.join(ctx.env.APPDATA, ...segments)];
  }
  return [nodePath.join(ctx.homeDir, ".config", ...segments)];
}

// The cursor-agent CLI login (Keychain) comes first: that is the account DJL runs. The Cursor
// editor's own token is a fallback, and a stale editor token must never hide a valid CLI one.
async function resolveCursorAuthCandidates(ctx: ProviderUsageContext): Promise<CursorAuth[]> {
  const candidates: CursorAuth[] = [];
  const keychain = await readKeychainPassword({
    service: KEYCHAIN_SERVICE,
    platform: ctx.platform,
  });
  const keychainToken = keychain ? asString(keychain) : undefined;
  if (keychainToken) {
    candidates.push({ accessToken: keychainToken });
  }

  for (const dbPath of stateDbPaths(ctx)) {
    const values = await readItemTableValues({ dbPath, keys: [ACCESS_TOKEN_KEY, PLAN_KEY] });
    const accessToken = asString(values[ACCESS_TOKEN_KEY]);
    if (accessToken && accessToken !== keychainToken) {
      const plan = asString(values[PLAN_KEY]);
      candidates.push({ accessToken, ...(plan ? { plan } : {}) });
    }
  }
  return candidates;
}

function cursorHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    "Connect-Protocol-Version": "1",
  };
}

export function parseCursorUsage(input: {
  usage: unknown;
  credits?: unknown;
  planName?: string;
  nowMs: number;
}) {
  const usage = asRecord(input.usage);
  const planUsage = asRecord(usage?.planUsage);
  const spendLimit = asRecord(usage?.spendLimitUsage);
  const limits: ServerProviderUsageLimit[] = [];
  const usageLines: ServerProviderUsageLine[] = [];

  const totalPercent = clampPercent(asFiniteNumber(planUsage?.totalPercentUsed));
  const resetsAt = isoFromUnixMillis(usage?.billingCycleEnd);
  if (totalPercent !== undefined || resetsAt) {
    limits.push({
      window: "Current",
      ...(totalPercent !== undefined ? { usedPercent: totalPercent } : {}),
      ...(resetsAt ? { resetsAt } : {}),
    });
  }

  const individualLimit = asFiniteNumber(spendLimit?.individualLimit);
  const individualRemaining = asFiniteNumber(spendLimit?.individualRemaining);
  if (individualLimit !== undefined && individualLimit > 0) {
    const used =
      individualRemaining !== undefined
        ? Math.max(0, individualLimit - individualRemaining)
        : undefined;
    usageLines.push({
      label: "On-demand",
      value:
        used !== undefined
          ? `${formatUsd(used / 100)} of ${formatUsd(individualLimit / 100)}`
          : `${formatUsd(individualLimit / 100)} limit`,
    });
  }

  const credits = asRecord(input.credits);
  if (credits && credits.hasCreditGrants !== false) {
    const totalCents = asFiniteNumber(credits.totalCents);
    const usedCents = asFiniteNumber(credits.usedCents);
    if (totalCents !== undefined && totalCents > 0) {
      const remaining = usedCents !== undefined ? Math.max(0, totalCents - usedCents) : totalCents;
      usageLines.push({
        label: "Credits",
        value: `${formatUsd(remaining / 100)} of ${formatUsd(totalCents / 100)} remaining`,
      });
    }
  }

  return buildSnapshot({
    provider: "cursor",
    nowMs: input.nowMs,
    status: "ok",
    source: SOURCE,
    limits,
    usageLines,
    ...(input.planName ? { planName: input.planName } : {}),
  });
}

async function fetchCursorUsage(auth: CursorAuth, nowMs: number) {
  const usageResult = await fetchJson({
    url: USAGE_URL,
    method: "POST",
    headers: cursorHeaders(auth.accessToken),
    body: {},
  });
  if (isAuthFailureStatus(usageResult.status)) {
    return null;
  }
  if (!usageResult.ok) {
    return errorSnapshot(
      "cursor",
      nowMs,
      SOURCE,
      `Cursor usage request failed (${usageResult.status}).`,
    );
  }

  // Credit grants are best-effort — absence shouldn't fail the snapshot.
  let creditsJson: unknown;
  try {
    const creditsResult = await fetchJson({
      url: CREDITS_URL,
      method: "POST",
      headers: cursorHeaders(auth.accessToken),
      body: {},
    });
    if (creditsResult.ok) {
      creditsJson = creditsResult.json;
    }
  } catch {
    creditsJson = undefined;
  }

  return parseCursorUsage({
    usage: usageResult.json,
    credits: creditsJson,
    nowMs,
    ...(auth.plan ? { planName: titleCase(auth.plan) } : {}),
  });
}

export const cursorUsageFetcher: ProviderUsageFetcher = {
  provider: "cursor",
  async fetch(ctx) {
    let lastError: ReturnType<typeof errorSnapshot> | null = null;
    for (const auth of await resolveCursorAuthCandidates(ctx)) {
      const expMs = decodeJwtExpMs(auth.accessToken);
      if (expMs !== null && expMs <= ctx.nowMs) {
        continue;
      }
      try {
        const snapshot = await fetchCursorUsage(auth, ctx.nowMs);
        if (snapshot === null) {
          continue;
        }
        if ((snapshot.status ?? "ok") === "ok") {
          return snapshot;
        }
        lastError = snapshot;
      } catch {
        lastError = errorSnapshot(
          "cursor",
          ctx.nowMs,
          SOURCE,
          "Could not reach the Cursor dashboard.",
        );
      }
    }
    return lastError ?? needsAuthSnapshot("cursor", ctx.nowMs, SOURCE);
  },
};
