// FILE: ProviderUsageSettingsPanel.tsx
// Purpose: Settings → Usage panel. One card per supported provider showing live remaining
// quota/credits with linear progress meters, the provider brand icon, and plan/status pills.
// Usage is fetched read-only from each CLI's stored credentials by the server. Extra AI
// accounts (Settings → AI accounts) get their own card right after their provider's.

import {
  DEFAULT_CLI_ACCOUNT_ID,
  type CliAccountProvider,
  type CliAccountSetting,
  type CliAccountUsage,
  type ProviderKind,
  type ServerProviderUsageSnapshot,
} from "@djl/contracts";
import { PROVIDER_USAGE_PROVIDERS, providerUsageDisplayName } from "@djl/shared/providerUsage";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Fragment, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import { useAppSettings } from "~/appSettings";
import { TechnicalDetailsDisclosure } from "~/components/chat/TechnicalDetailsDisclosure";
import { ProviderIcon } from "~/components/ProviderIcon";
import { ProviderUsageLimitRows } from "~/components/ProviderUsageLimitRows";
import { ProviderUsageLineList } from "~/components/ProviderUsageLineList";
import { SettingsCard } from "~/components/settings/SettingsPanelPrimitives";
import { Button } from "~/components/ui/button";
import { useProviderUsageSummary } from "~/hooks/useProviderUsageSummary";
import { CLI_ACCOUNTS_USAGE_QUERY_KEY } from "~/lib/cliAccountsQuery";
import { RotateCcwIcon, TriangleAlertIcon } from "~/lib/icons";
import { deriveProviderUsageDisplayRows } from "~/lib/providerUsageDisplay";
import { deriveAccountRateLimits, type ProviderRateLimit } from "~/lib/rateLimits";
import {
  fetchAllProviderUsage,
  serverAllProviderUsageQueryOptions,
  serverConfigQueryOptions,
  serverQueryKeys,
  serverSettingsQueryOptions,
} from "~/lib/serverReactQuery";
import { isCliSignedIn } from "~/lib/usageRing";
import { cn } from "~/lib/utils";
import {
  SETTINGS_PANEL_SECTION_CLASS_NAME,
  SETTINGS_SECTION_LABEL_CLASS_NAME,
} from "~/settingsPanelStyles";
import { ensureNativeApi } from "~/nativeApi";
import { useStore } from "~/store";
import { createAllThreadsSelector } from "~/storeSelectors";
import { AccountUsage } from "./CliAccountUsage";
import { CLOUD_ACCOUNT_QUERY_KEY, DjlCloudAccountCard } from "./DjlCloudAccountCard";

export const PILL_CLASS_NAME =
  "shrink-0 rounded-full px-2 py-1 text-[11px] font-medium leading-none";
const IN_USE_PILL_CLASS_NAME = cn(
  PILL_CLASS_NAME,
  "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400",
);

interface StatusPill {
  label: string;
  className: string;
}

export function statusPill(
  status: ServerProviderUsageSnapshot["status"],
  t: TFunction,
  cliSignedIn = false,
): StatusPill | null {
  switch (status) {
    case "needs-auth":
      if (cliSignedIn) {
        return {
          label: t("usage.status.signedIn", { ns: "settings" }),
          className: "bg-muted text-muted-foreground",
        };
      }
      return {
        label: t("usage.status.notSignedIn", { ns: "settings" }),
        className: "bg-amber-500/12 text-amber-600 dark:text-amber-400",
      };
    case "unsupported":
      return {
        label: t("usage.status.unsupported", { ns: "settings" }),
        className: "bg-muted text-muted-foreground",
      };
    case "error":
      return {
        label: t("usage.status.unavailable", { ns: "settings" }),
        className: "bg-red-500/12 text-red-600 dark:text-red-400",
      };
    default:
      return null;
  }
}

function ProviderUsageCard({
  snapshot,
  threadRateLimits,
  codexHomePath,
  cliSignedIn,
  title,
  inUse,
}: {
  snapshot: ServerProviderUsageSnapshot;
  threadRateLimits: ReadonlyArray<ProviderRateLimit>;
  codexHomePath: string | null;
  cliSignedIn: boolean;
  /** Set when the provider has extra AI accounts, e.g. "Claude · Main account". */
  title?: string;
  inUse?: boolean;
}) {
  const { t, i18n } = useTranslation("settings");
  const navigate = useNavigate();
  const provider = snapshot.provider;
  const status = snapshot.status ?? "ok";
  const usageSummary = useProviderUsageSummary({
    provider,
    threadRateLimits,
    codexHomePath,
    providerSnapshot: snapshot,
  });
  const meterRows = useMemo(
    () =>
      deriveProviderUsageDisplayRows(usageSummary.rateLimits, {
        t,
        locale: i18n.resolvedLanguage ?? i18n.language,
      }),
    [i18n.language, i18n.resolvedLanguage, t, usageSummary.rateLimits],
  );
  const usageLines = usageSummary.usageLines;

  const hasUsage = meterRows.length > 0 || usageLines.length > 0;
  const pill = status === "ok" ? null : statusPill(snapshot.status, t, cliSignedIn);

  return (
    <SettingsCard>
      <div className="space-y-3.5 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-[color:var(--color-border)] bg-muted/60">
              <ProviderIcon provider={provider} className="size-4" />
            </span>
            <span className="truncate text-sm font-semibold text-foreground">
              {title ?? providerUsageDisplayName(provider)}
            </span>
          </div>
          {inUse ? (
            <span className={IN_USE_PILL_CLASS_NAME}>{t("aiAccounts.inUse")}</span>
          ) : status === "ok" && snapshot.planName ? (
            <span
              className={cn(PILL_CLASS_NAME, "max-w-full truncate bg-muted text-muted-foreground")}
            >
              {snapshot.planName}
            </span>
          ) : pill ? (
            <span className={cn(PILL_CLASS_NAME, pill.className)}>{pill.label}</span>
          ) : null}
        </div>

        {status === "ok" && hasUsage ? (
          <>
            {usageSummary.usageNotice ? (
              <p className="flex items-start gap-1.5 text-xs leading-relaxed text-amber-600 dark:text-amber-300/90">
                <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                <span>{usageSummary.usageNotice}</span>
              </p>
            ) : null}
            {meterRows.length > 0 ? (
              <ProviderUsageLimitRows rows={meterRows} surface="settings" />
            ) : null}
            {usageLines.length > 0 ? (
              <ProviderUsageLineList
                className={cn(
                  meterRows.length > 0 && "border-t border-[color:var(--color-border)] pt-3",
                )}
                lines={usageLines}
                surface="settings"
              />
            ) : null}
          </>
        ) : status === "needs-auth" && !cliSignedIn ? (
          // Signing in happens on the Accounts page, never by typing a command.
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t("usage.signInToSee", { provider: providerUsageDisplayName(provider) })}
            </p>
            <Button
              size="xs"
              variant="outline"
              onClick={() => void navigate({ to: "/settings", search: { section: "accounts" } })}
            >
              {t("aiAccounts.signIn")}
            </Button>
          </div>
        ) : (
          <div className="space-y-1 text-xs leading-relaxed text-muted-foreground">
            <p>
              {status === "ok"
                ? t("usage.noData")
                : status === "needs-auth"
                  ? t("usage.signedInNoUsage", { provider: providerUsageDisplayName(provider) })
                  : t("usage.cannotShow")}
            </p>
            {status === "ok" || status === "needs-auth" ? null : (
              <TechnicalDetailsDisclosure detail={snapshot.detail} />
            )}
          </div>
        )}
      </div>
    </SettingsCard>
  );
}

function AiAccountUsageCard({
  account,
  usage,
  inUse,
}: {
  account: CliAccountSetting;
  usage: CliAccountUsage | undefined;
  inUse: boolean;
}) {
  const { t } = useTranslation("settings");
  return (
    <SettingsCard>
      <div className="space-y-3.5 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-[color:var(--color-border)] bg-muted/60">
              <ProviderIcon provider={account.provider} className="size-4" />
            </span>
            <span className="truncate text-sm font-semibold text-foreground">
              {providerUsageDisplayName(account.provider)} · {account.name}
            </span>
          </div>
          {inUse ? <span className={IN_USE_PILL_CLASS_NAME}>{t("aiAccounts.inUse")}</span> : null}
        </div>
        <AccountUsage usage={usage} />
      </div>
    </SettingsCard>
  );
}

function missingSnapshot(provider: ProviderKind): ServerProviderUsageSnapshot {
  return {
    provider,
    updatedAt: new Date(0).toISOString(),
    limits: [],
    usageLines: [],
    source: "unavailable",
    status: "error",
  };
}

function mergeProviderUsageRefresh(
  previous: readonly ServerProviderUsageSnapshot[] | undefined,
  next: readonly ServerProviderUsageSnapshot[],
): readonly ServerProviderUsageSnapshot[] {
  if (!previous) {
    return next;
  }
  const previousByProvider = new Map(previous.map((snapshot) => [snapshot.provider, snapshot]));
  const nextByProvider = new Map(next.map((snapshot) => [snapshot.provider, snapshot]));
  return PROVIDER_USAGE_PROVIDERS.map(
    (provider) => nextByProvider.get(provider) ?? previousByProvider.get(provider),
  ).filter((snapshot): snapshot is ServerProviderUsageSnapshot => snapshot !== undefined);
}

export function ProviderUsageSettingsPanel() {
  const { t } = useTranslation(["settings", "common"]);
  const queryClient = useQueryClient();
  const { settings } = useAppSettings();
  const codexHomePath = settings.codexHomePath || null;
  const threads = useStore(useMemo(() => createAllThreadsSelector(), []));
  // Account/thread fallback rows are shared by every provider card; derive them once per panel.
  const threadRateLimits = useMemo(() => deriveAccountRateLimits(threads), [threads]);
  const usageQuery = useQuery(serverAllProviderUsageQueryOptions());
  const providerStatuses = useQuery(serverConfigQueryOptions()).data?.providers ?? [];
  const aiAccounts = useQuery(serverSettingsQueryOptions()).data?.cliAccounts;
  const extraAccounts = aiAccounts?.accounts ?? [];
  const aiUsageQuery = useQuery({
    queryKey: CLI_ACCOUNTS_USAGE_QUERY_KEY,
    queryFn: () => ensureNativeApi().cliAccounts.usage({}),
    enabled: extraAccounts.length > 0,
    refetchInterval: 60_000,
  });
  const aiRefreshMutation = useMutation({
    mutationFn: () => ensureNativeApi().cliAccounts.usage({ forceRefresh: true }),
    onSuccess: (result) => queryClient.setQueryData(CLI_ACCOUNTS_USAGE_QUERY_KEY, result),
  });
  const activeAccountId = (provider: CliAccountProvider) =>
    aiAccounts?.active[provider] ?? DEFAULT_CLI_ACCOUNT_ID;
  const extraAccountsOf = (provider: ProviderKind) =>
    extraAccounts.filter((account) => account.provider === provider);
  const refreshMutation = useMutation({
    mutationFn: () => fetchAllProviderUsage({ forceRefresh: true }),
    onSuccess: (data) => {
      queryClient.setQueryData<readonly ServerProviderUsageSnapshot[]>(
        serverQueryKeys.allProviderUsage(),
        (previous) => mergeProviderUsageRefresh(previous, data),
      );
    },
  });

  // Always render a card per supported provider, ordered consistently, even if the batch
  // omitted one (e.g. a transient server error) — fall back to an "unavailable" placeholder.
  const cards = useMemo(() => {
    const byProvider = new Map<ProviderKind, ServerProviderUsageSnapshot>();
    for (const snapshot of usageQuery.data ?? []) {
      byProvider.set(snapshot.provider, snapshot);
    }
    return PROVIDER_USAGE_PROVIDERS.map(
      (provider) => byProvider.get(provider) ?? missingSnapshot(provider),
    );
  }, [usageQuery.data]);

  const showInitialLoading = usageQuery.isPending && !usageQuery.data;

  const isRefreshing =
    usageQuery.isFetching ||
    refreshMutation.isPending ||
    aiUsageQuery.isFetching ||
    aiRefreshMutation.isPending;

  return (
    // Container queries: the settings pane's width, not the window's, decides the layout.
    <div className={cn(SETTINGS_PANEL_SECTION_CLASS_NAME, "@container")}>
      <DjlCloudAccountCard showUsage />
      <section className={SETTINGS_PANEL_SECTION_CLASS_NAME}>
        <div className="flex items-center justify-between gap-2">
          <h2 className={SETTINGS_SECTION_LABEL_CLASS_NAME}>{t("usage.title")}</h2>
          <Button
            size="xs"
            variant="outline"
            className="shrink-0"
            disabled={isRefreshing}
            onClick={() => {
              refreshMutation.mutate();
              if (extraAccounts.length > 0) aiRefreshMutation.mutate();
              void queryClient.invalidateQueries({ queryKey: CLOUD_ACCOUNT_QUERY_KEY });
            }}
          >
            <RotateCcwIcon className={cn("size-3.5", isRefreshing && "animate-spin")} />
            {t("actions.refresh", { ns: "common" })}
          </Button>
        </div>

        {showInitialLoading ? (
          <SettingsCard>
            <div className="px-4 py-3.5 text-xs text-muted-foreground">{t("usage.loading")}</div>
          </SettingsCard>
        ) : (
          <div className="grid grid-cols-1 items-start gap-3 @2xl:grid-cols-2">
            {cards.map((snapshot) => {
              const extras = extraAccountsOf(snapshot.provider);
              const provider = snapshot.provider as CliAccountProvider;
              return (
                <Fragment key={snapshot.provider}>
                  <ProviderUsageCard
                    snapshot={snapshot}
                    threadRateLimits={threadRateLimits}
                    codexHomePath={codexHomePath}
                    cliSignedIn={isCliSignedIn(snapshot.provider, providerStatuses)}
                    {...(extras.length > 0
                      ? {
                          title: `${providerUsageDisplayName(snapshot.provider)} · ${t("aiAccounts.mainAccount")}`,
                          inUse: activeAccountId(provider) === DEFAULT_CLI_ACCOUNT_ID,
                        }
                      : {})}
                  />
                  {extras.map((account) => (
                    <AiAccountUsageCard
                      key={account.id}
                      account={account}
                      usage={aiUsageQuery.data?.usage.find(
                        (row) => row.provider === account.provider && row.accountId === account.id,
                      )}
                      inUse={activeAccountId(account.provider) === account.id}
                    />
                  ))}
                </Fragment>
              );
            })}
          </div>
        )}

        <p className="px-2 text-[11px] leading-relaxed text-muted-foreground">
          {t("usage.privacyDescription")}
        </p>
        {refreshMutation.isError && (
          <p role="alert" className="text-xs text-destructive">
            {t("usage.status.unavailable")}
          </p>
        )}
      </section>
    </div>
  );
}
