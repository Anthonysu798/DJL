// FILE: workspaceAccounts.ts
// Purpose: The accounts a workspace terminal can run with, in one list: the app's own Claude
//          Code / Codex accounts first (the normal sign-in, then Settings → AI accounts), so they
//          work here without signing in again, then any workspace-only profiles.
// Layer: Workspaces data. Ids are explained in `~/lib/workspaceAccountIds.ts`.

import type { CliAccountStatus, CliAccountSummary } from "@djl/contracts";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { AgentAccountProfile } from "~/agentWorkspaceStore";
import { CLI_ACCOUNTS_QUERY_KEY } from "~/lib/cliAccountsQuery";
import { APP_ACCOUNT_PROVIDERS, defaultAppAccountId } from "~/lib/workspaceAccountIds";
import { ensureNativeApi } from "~/nativeApi";

export interface WorkspaceAccount extends AgentAccountProfile {
  /** Settings already knows the sign-in state of app accounts; null asks the profile's CLI. */
  known: { status: CliAccountStatus | "checking"; email: string | null } | null;
  /** From Settings → AI accounts (or the normal sign-in), so not editable here. */
  fromApp: boolean;
}

export function mergeWorkspaceAccounts(
  summaries: readonly CliAccountSummary[] | null | undefined,
  profiles: readonly AgentAccountProfile[],
  mainAccountName: string,
): WorkspaceAccount[] {
  const app: WorkspaceAccount[] = summaries
    ? summaries.map((summary) => ({
        id: summary.isDefault ? defaultAppAccountId(summary.provider) : summary.id,
        provider: summary.provider,
        name: summary.isDefault ? mainAccountName : summary.name,
        known: { status: summary.status, email: summary.email },
        fromApp: true,
      }))
    : // Before Settings answers, the normal sign-in rows still show (and still launch).
      APP_ACCOUNT_PROVIDERS.map((provider) => ({
        id: defaultAppAccountId(provider),
        provider,
        name: mainAccountName,
        known: { status: summaries === null ? "unknown" : "checking", email: null },
        fromApp: true,
      }));
  const ordered = app.toSorted(
    (a, b) =>
      Number(b.id.startsWith("default-")) - Number(a.id.startsWith("default-")) ||
      APP_ACCOUNT_PROVIDERS.indexOf(a.provider as (typeof APP_ACCOUNT_PROVIDERS)[number]) -
        APP_ACCOUNT_PROVIDERS.indexOf(b.provider as (typeof APP_ACCOUNT_PROVIDERS)[number]),
  );
  return [...ordered, ...profiles.map((profile) => ({ ...profile, known: null, fromApp: false }))];
}

export function useWorkspaceAccounts(profiles: readonly AgentAccountProfile[]) {
  const { t } = useTranslation("workspace", { keyPrefix: "agents" });
  const query = useQuery({
    queryKey: CLI_ACCOUNTS_QUERY_KEY,
    queryFn: () => ensureNativeApi().cliAccounts.list(),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
  const summaries = query.isError ? null : query.data?.accounts;
  const mainAccountName = t("mainAccount");
  return useMemo(
    () => mergeWorkspaceAccounts(summaries, profiles, mainAccountName),
    [summaries, profiles, mainAccountName],
  );
}
