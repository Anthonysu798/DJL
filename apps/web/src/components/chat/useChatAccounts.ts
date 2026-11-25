// FILE: useChatAccounts.ts
// Purpose: Subscription accounts for the composer: the pills in the model picker (name, usage
//          left), the account this chat uses, and the `cliAccountId` its turns carry. Follows
//          automatic switches (`account.switched` activities) so later turns stay on the new one.
// Layer: Chat composer data hook.

import {
  DEFAULT_CLI_ACCOUNT_ID,
  type CliAccountProvider,
  type OrchestrationThreadActivity,
  type ProviderKind,
  type ProviderStartOptions,
  type ServerProviderUsageSnapshot,
} from "@djl/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { useChatAccountStore } from "~/chatAccountStore";
import { CLI_ACCOUNTS_QUERY_KEY, CLI_ACCOUNTS_USAGE_QUERY_KEY } from "~/lib/cliAccountsQuery";
import { ensureNativeApi } from "~/nativeApi";

import type { ComposerAccountOption } from "./ComposerAccountRow";

export function isAccountProvider(provider: ProviderKind): provider is CliAccountProvider {
  return provider === "codex" || provider === "claudeAgent";
}

/** Usage left in the tighter of the 5-hour and weekly windows, or null when unknown. */
export function usageLeftPercent(snapshot: ServerProviderUsageSnapshot | null | undefined) {
  const used = (snapshot?.limits ?? [])
    .filter((limit) => /^(5h|weekly)$/i.test(limit.window))
    .flatMap((limit) => (typeof limit.usedPercent === "number" ? [limit.usedPercent] : []));
  return used.length === 0 ? null : Math.max(0, 100 - Math.max(...used));
}

/** The newest automatic switch for a provider in a chat's activities. */
export function latestAccountSwitch(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  provider: CliAccountProvider,
): { id: string; at: number } | null {
  for (let index = activities.length - 1; index >= 0; index--) {
    const activity = activities[index]!;
    if (activity.kind !== "account.switched") continue;
    const payload = activity.payload as Record<string, unknown> | null;
    if (payload?.provider === provider && typeof payload.toId === "string")
      return { id: payload.toId, at: Date.parse(activity.createdAt) };
  }
  return null;
}

export function useChatAccounts(
  threadId: string,
  activities: ReadonlyArray<OrchestrationThreadActivity> | undefined,
) {
  const { t } = useTranslation("workspace", { keyPrefix: "agents" });
  const queryClient = useQueryClient();
  const accounts = useQuery({
    queryKey: CLI_ACCOUNTS_QUERY_KEY,
    queryFn: () => ensureNativeApi().cliAccounts.list(),
    staleTime: 30_000,
    retry: false,
  });
  const usage = useQuery({
    queryKey: CLI_ACCOUNTS_USAGE_QUERY_KEY,
    queryFn: () => ensureNativeApi().cliAccounts.usage({}),
    staleTime: 60_000,
    retry: false,
  });
  const choices = useChatAccountStore((state) => state.byThread[threadId]);
  const setAccount = useChatAccountStore((state) => state.setAccount);

  // An automatic switch moves the chat to the new account for its next turns.
  useEffect(() => {
    if (!activities) return;
    for (const provider of ["codex", "claudeAgent"] as const) {
      const switched = latestAccountSwitch(activities, provider);
      const current = choices?.[provider];
      if (switched && (!current || switched.at > current.at) && switched.id !== current?.id)
        setAccount(threadId, provider, switched.id, switched.at);
    }
  }, [activities, choices, setAccount, threadId]);

  const list = accounts.data?.accounts;
  const usageRows = usage.data?.usage;
  const mainName = t("mainAccount");
  const defaultIdFor = useCallback(
    (provider: CliAccountProvider) =>
      list?.find((account) => account.provider === provider && account.active)?.id ??
      DEFAULT_CLI_ACCOUNT_ID,
    [list],
  );
  const optionsFor = useCallback(
    (provider: CliAccountProvider): ComposerAccountOption[] =>
      (list ?? [])
        .filter((account) => account.provider === provider)
        .map((account) => ({
          id: account.id,
          name: account.isDefault ? mainName : account.name,
          email: account.email,
          signedIn: account.status === "signedIn",
          leftPercent: usageLeftPercent(
            usageRows?.find((row) => row.provider === provider && row.accountId === account.id)
              ?.snapshot,
          ),
        })),
    [list, mainName, usageRows],
  );
  const selectedIdFor = useCallback(
    (provider: CliAccountProvider) => choices?.[provider]?.id ?? defaultIdFor(provider),
    [choices, defaultIdFor],
  );
  const makeDefault = useMutation({
    mutationFn: (input: { provider: CliAccountProvider; id: string }) =>
      ensureNativeApi().cliAccounts.setActive(input),
    onSettled: () => queryClient.invalidateQueries({ queryKey: CLI_ACCOUNTS_QUERY_KEY }),
  });

  /** Only explicit choices travel with a turn; other chats keep the app-wide account. */
  const providerOptionsPatch = useMemo<ProviderStartOptions>(
    () => ({
      ...(choices?.codex ? { codex: { cliAccountId: choices.codex.id } } : {}),
      ...(choices?.claudeAgent ? { claudeAgent: { cliAccountId: choices.claudeAgent.id } } : {}),
    }),
    [choices],
  );

  return {
    optionsFor,
    selectedIdFor,
    defaultIdFor,
    select: (provider: CliAccountProvider, id: string) => setAccount(threadId, provider, id),
    makeDefault: (provider: CliAccountProvider, id: string) => makeDefault.mutate({ provider, id }),
    providerOptionsPatch,
  };
}

/** Adds a chat's account choice to the options its turns carry. */
export function withChatAccount(
  options: ProviderStartOptions | undefined,
  patch: ProviderStartOptions,
): ProviderStartOptions | undefined {
  if (!patch.codex && !patch.claudeAgent) return options;
  return {
    ...options,
    ...(patch.codex ? { codex: { ...options?.codex, ...patch.codex } } : {}),
    ...(patch.claudeAgent
      ? { claudeAgent: { ...options?.claudeAgent, ...patch.claudeAgent } }
      : {}),
  };
}
