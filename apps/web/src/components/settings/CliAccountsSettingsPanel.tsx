// FILE: CliAccountsSettingsPanel.tsx
// Purpose: Settings → AI accounts. Several Claude Code and Codex subscriptions side by side:
//          what each has left, which one new chats use, one-click switching, and adding an
//          account that goes straight into its sign-in.

import {
  type CliAccountProvider,
  type CliAccountSummary,
  type CliAccountUsage,
} from "@djl/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import { ProfileSignInDialog } from "~/components/agent-workspaces/ProfileSignInDialog";
import { TechnicalDetailsDisclosure } from "~/components/chat/TechnicalDetailsDisclosure";
import { ProviderIcon } from "~/components/ProviderIcon";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Skeleton } from "~/components/ui/skeleton";
import { CLI_ACCOUNTS_QUERY_KEY, CLI_ACCOUNTS_USAGE_QUERY_KEY } from "~/lib/cliAccountsQuery";
import { PlusIcon, RotateCcwIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { ensureNativeApi } from "~/nativeApi";
import { Switch } from "~/components/ui/switch";
import { serverQueryKeys, serverSettingsQueryOptions } from "~/lib/serverReactQuery";
import { AccountUsage } from "./CliAccountUsage";
import { providerUsageDisplayName } from "@djl/shared/providerUsage";

const PROVIDERS: readonly CliAccountProvider[] = ["claudeAgent", "codex"];

function AccountCard({
  account,
  usage,
  busy,
  onUse,
  onSignIn,
  onRemove,
}: {
  account: CliAccountSummary;
  usage: CliAccountUsage | undefined;
  busy: boolean;
  onUse: () => void;
  onSignIn: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation("settings");
  const name = account.isDefault ? t("aiAccounts.mainAccount") : account.name;
  const signedIn = account.status === "signedIn";
  return (
    <li
      className={cn(
        "liquid-glass flex min-w-0 flex-col gap-3.5 rounded-2xl p-4 transition-[box-shadow] duration-200",
        account.active && "ring-1 ring-emerald-400/45",
      )}
      data-active={account.active}
    >
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-background/40">
          <ProviderIcon provider={account.provider} className="size-[1.125rem]" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="truncate text-sm font-medium text-foreground">{name}</h3>
            {account.active ? (
              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-500/12 px-2 text-[11px] leading-5 font-medium text-emerald-600 dark:text-emerald-300">
                <span className="size-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgb(52_211_153/0.7)]" />
                {t("aiAccounts.inUse")}
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {signedIn && account.email ? account.email : t(`aiAccounts.status.${account.status}`)}
          </p>
        </div>
      </div>

      {signedIn ? <AccountUsage usage={usage} /> : null}

      <div className="mt-auto flex flex-wrap items-center gap-2">
        {signedIn && !account.active ? (
          <Button size="sm" disabled={busy} onClick={onUse}>
            {t("accounts.useForNewChats")}
          </Button>
        ) : null}
        {!signedIn && account.status !== "unavailable" ? (
          <Button size="sm" disabled={busy} onClick={onSignIn}>
            {t("aiAccounts.signIn")}
          </Button>
        ) : null}
        {signedIn && !account.isDefault ? (
          <Button size="sm" variant="ghost" disabled={busy} onClick={onSignIn}>
            {t("aiAccounts.signInAgain")}
          </Button>
        ) : null}
        {account.isDefault ? null : (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto text-muted-foreground hover:text-destructive"
            disabled={busy}
            onClick={onRemove}
          >
            {t("aiAccounts.remove")}
          </Button>
        )}
      </div>
    </li>
  );
}

function AddAccountForm({
  provider,
  busy,
  onAdd,
  onCancel,
}: {
  provider: CliAccountProvider;
  busy: boolean;
  onAdd: (name: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation("settings");
  const [name, setName] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed) onAdd(trimmed);
  };
  return (
    <form
      className="liquid-glass flex flex-col gap-2 rounded-2xl p-3 @md:flex-row @md:items-center"
      onSubmit={submit}
    >
      <Input
        size="sm"
        autoFocus
        className="min-w-0 flex-1"
        aria-label={t("aiAccounts.nameLabel", { provider: providerUsageDisplayName(provider) })}
        placeholder={t("aiAccounts.namePlaceholder")}
        value={name}
        maxLength={80}
        disabled={busy}
        onChange={(event) => setName(event.target.value)}
      />
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={busy || name.trim() === ""}>
          {t("aiAccounts.addAndSignIn")}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          {t("aiAccounts.cancel")}
        </Button>
      </div>
    </form>
  );
}

export function CliAccountsSettingsPanel() {
  const { t } = useTranslation("settings");
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [adding, setAdding] = useState<CliAccountProvider | null>(null);
  const [signIn, setSignIn] = useState<CliAccountSummary | null>(null);

  const accounts = useQuery({
    queryKey: CLI_ACCOUNTS_QUERY_KEY,
    queryFn: () => ensureNativeApi().cliAccounts.list(),
  });
  const usage = useQuery({
    queryKey: CLI_ACCOUNTS_USAGE_QUERY_KEY,
    queryFn: () => ensureNativeApi().cliAccounts.usage({}),
    refetchInterval: 60_000,
  });
  const refreshUsage = useMutation({
    mutationFn: () => ensureNativeApi().cliAccounts.usage({ forceRefresh: true }),
    onSuccess: (result) => queryClient.setQueryData(CLI_ACCOUNTS_USAGE_QUERY_KEY, result),
  });
  const reload = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: CLI_ACCOUNTS_QUERY_KEY }),
      // Accounts, the model picker and usage reflect the account new chats now use.
      queryClient.invalidateQueries({ queryKey: ["server"] }),
    ]);
  const setActive = useMutation({
    mutationFn: (account: Pick<CliAccountSummary, "provider" | "id">) =>
      ensureNativeApi().cliAccounts.setActive({ provider: account.provider, id: account.id }),
    onSuccess: async (result) => {
      queryClient.setQueryData(CLI_ACCOUNTS_QUERY_KEY, result);
      await reload();
    },
  });
  const add = useMutation({
    mutationFn: (input: { provider: CliAccountProvider; name: string }) =>
      ensureNativeApi().cliAccounts.add(input),
    onSuccess: async (account) => {
      setAdding(null);
      await queryClient.invalidateQueries({ queryKey: CLI_ACCOUNTS_QUERY_KEY });
      // A new account is only useful once it is signed in, so go straight there.
      setSignIn(account);
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => ensureNativeApi().cliAccounts.remove({ id }),
    onSuccess: async (result) => {
      queryClient.setQueryData(CLI_ACCOUNTS_QUERY_KEY, result);
      await reload();
      await queryClient.invalidateQueries({ queryKey: CLI_ACCOUNTS_USAGE_QUERY_KEY });
    },
  });
  const busy = setActive.isPending || add.isPending || remove.isPending;
  const error = setActive.error ?? add.error ?? remove.error ?? accounts.error;

  const usageById = new Map(
    (usage.data?.usage ?? []).map((item) => [`${item.provider}:${item.accountId}`, item]),
  );

  return (
    // Container queries: the settings pane's width, not the window's, decides the layout.
    <div className="@container space-y-8">
      <div className="flex flex-col gap-3 @lg:flex-row @lg:items-start @lg:justify-between">
        <p className="max-w-xl text-sm text-muted-foreground">{t("aiAccounts.description")}</p>
        <Button
          size="sm"
          variant="outline"
          className="shrink-0 self-start"
          disabled={refreshUsage.isPending || usage.isFetching}
          onClick={() => refreshUsage.mutate()}
        >
          <RotateCcwIcon
            className={cn(
              "size-3.5",
              (refreshUsage.isPending || usage.isFetching) && "animate-spin",
            )}
          />
          {t("aiAccounts.refresh")}
        </Button>
      </div>

      {error ? (
        <div role="alert" className="space-y-1 text-sm text-destructive">
          <p>{t("aiAccounts.error")}</p>
          <TechnicalDetailsDisclosure detail={error instanceof Error ? error.message : null} />
        </div>
      ) : null}

      {PROVIDERS.map((provider) => {
        const list = accounts.data?.accounts.filter((item) => item.provider === provider);
        return (
          <section key={provider} className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-sm font-medium text-foreground">
                <ProviderIcon provider={provider} className="size-4" />
                {providerUsageDisplayName(provider)}
              </h2>
              {adding === provider ? null : (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setAdding(provider)}
                >
                  <PlusIcon className="size-3.5" />
                  {t("aiAccounts.addAccount")}
                </Button>
              )}
            </div>
            {adding === provider ? (
              <AddAccountForm
                provider={provider}
                busy={add.isPending}
                onAdd={(name) => add.mutate({ provider, name })}
                onCancel={() => setAdding(null)}
              />
            ) : null}
            {list === undefined ? (
              <Skeleton className="h-36 w-full rounded-2xl" />
            ) : (
              <ul className="grid grid-cols-1 gap-3 @2xl:grid-cols-2">
                {list.map((account) => (
                  <AccountCard
                    key={account.id}
                    account={account}
                    usage={usage.data ? usageById.get(`${provider}:${account.id}`) : undefined}
                    busy={busy}
                    onUse={() => setActive.mutate(account)}
                    onSignIn={() =>
                      account.isDefault
                        ? void navigate({ to: "/settings", search: { section: "accounts" } })
                        : setSignIn(account)
                    }
                    onRemove={() => {
                      if (window.confirm(t("aiAccounts.removeConfirm", { name: account.name })))
                        remove.mutate(account.id);
                    }}
                  />
                ))}
              </ul>
            )}
          </section>
        );
      })}

      <AutoSwitchToggle />

      <p className="text-xs text-muted-foreground">{t("aiAccounts.switchNote")}</p>

      {signIn ? (
        <ProfileSignInDialog
          profile={{ id: signIn.id, provider: signIn.provider, name: signIn.name }}
          providerLabel={providerUsageDisplayName(signIn.provider)}
          onClose={() => {
            setSignIn(null);
            void reload();
            void queryClient.invalidateQueries({ queryKey: CLI_ACCOUNTS_USAGE_QUERY_KEY });
          }}
          onUseAccount={() => {
            const account = signIn;
            setSignIn(null);
            setActive.mutate({ provider: account.provider, id: account.id });
            void queryClient.invalidateQueries({ queryKey: CLI_ACCOUNTS_USAGE_QUERY_KEY });
          }}
        />
      ) : null}
    </div>
  );
}

/** On by default: a chat that hits its account's usage limit continues on another account. */
function AutoSwitchToggle() {
  const { t } = useTranslation("settings");
  const queryClient = useQueryClient();
  const settings = useQuery(serverSettingsQueryOptions());
  const enabled = settings.data?.cliAccounts.autoSwitch ?? true;
  const update = useMutation({
    mutationFn: (autoSwitch: boolean) =>
      ensureNativeApi().server.updateSettings({ cliAccounts: { autoSwitch } }),
    onSuccess: (next) => queryClient.setQueryData(serverQueryKeys.settings(), next),
    onError: () => queryClient.invalidateQueries({ queryKey: serverQueryKeys.settings() }),
  });
  return (
    <label className="flex items-start justify-between gap-4 rounded-2xl border border-border/60 bg-card/40 p-3.5">
      <span className="min-w-0">
        <span className="block text-sm font-medium">{t("aiAccounts.autoSwitch")}</span>
        <span className="mt-0.5 block text-xs leading-5 text-muted-foreground text-pretty">
          {t("aiAccounts.autoSwitchHint")}
        </span>
      </span>
      <Switch
        className="mt-0.5 shrink-0"
        checked={enabled}
        disabled={settings.isLoading || update.isPending}
        onCheckedChange={(checked) => update.mutate(Boolean(checked))}
        aria-label={t("aiAccounts.autoSwitch")}
      />
    </label>
  );
}
