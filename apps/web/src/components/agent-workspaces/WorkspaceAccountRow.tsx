import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { AgentAccountProfile } from "~/agentWorkspaceStore";
import { ensureNativeApi } from "~/nativeApi";
import { CLI_ACCOUNTS_QUERY_KEY } from "~/lib/cliAccountsQuery";
import { cn } from "~/lib/utils";
import { RefreshCwIcon, CheckIcon, PencilIcon } from "~/lib/icons";
import { ProviderIcon } from "../ProviderIcon";

export const PROFILE_ACCOUNT_QUERY_KEY = ["workspace-profile-account"] as const;
type AccountStatus = "signedIn" | "signedOut" | "unavailable" | "unknown" | "checking";

export function RefreshWorkspaceAccounts() {
  const client = useQueryClient();
  const { t } = useTranslation("workspace", { keyPrefix: "agents" });
  return (
    <button
      className="workspace-icon-button"
      aria-label={t("refreshAccounts")}
      title={t("refreshAccounts")}
      onClick={() => {
        void client.invalidateQueries({ queryKey: PROFILE_ACCOUNT_QUERY_KEY });
        void client.invalidateQueries({ queryKey: CLI_ACCOUNTS_QUERY_KEY });
      }}
    >
      <RefreshCwIcon className="size-3.5" />
    </button>
  );
}

/**
 * One account in the Workspaces sidebar. App accounts (the normal sign-in and Settings → AI
 * accounts) pass `known`, since Settings already checked them; workspace-only profiles ask
 * their own CLI folder.
 */
export function WorkspaceAccountRow({
  profile,
  providerLabel,
  used,
  known,
  mainLabel,
  onEdit,
  selected = false,
  onSelect,
  onSignIn,
}: {
  profile: AgentAccountProfile;
  providerLabel: string;
  used: number;
  known?: { status: AccountStatus; email: string | null };
  /** For the CLI's normal sign-in: the row shows the provider name with this tag. */
  mainLabel?: string;
  onEdit?: () => void;
  selected?: boolean;
  onSelect?: () => void;
  onSignIn?: () => void;
}) {
  const { t } = useTranslation("workspace", { keyPrefix: "agents" });
  const account = useQuery({
    queryKey: [...PROFILE_ACCOUNT_QUERY_KEY, profile.provider, profile.id],
    queryFn: () =>
      ensureNativeApi().harnesses.getProfileAccount({
        provider: profile.provider,
        profileId: profile.id,
      }),
    enabled: !known,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    retry: false,
  });
  const { refetch } = account;
  useEffect(() => {
    if (known) return;
    const refresh = () => {
      void refetch({ cancelRefetch: false });
    };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refetch, known]);
  const identity = known ?? (account.isError ? undefined : account.data);
  const status: AccountStatus = known
    ? known.status
    : account.isError
      ? "unknown"
      : (account.data?.status ?? "checking");
  const statusLabel = t(`profileStatus.${status}`);
  const signedIn = status === "signedIn";
  return (
    <div className="workspace-account-row group" data-selected={selected || undefined}>
      <button
        className="workspace-account-main"
        aria-pressed={selected}
        title={signedIn ? t("useThisAccount") : t("signIn")}
        onClick={signedIn ? (onSelect ?? onEdit) : (onSignIn ?? onEdit)}
      >
        <span className="workspace-account-logo" title={providerLabel}>
          <ProviderIcon provider={profile.provider} className="size-4" />
          <span
            role="img"
            aria-label={statusLabel}
            title={statusLabel}
            className={cn(
              "workspace-account-dot",
              signedIn
                ? "bg-emerald-400"
                : status === "checking"
                  ? "bg-muted-foreground"
                  : "bg-red-400",
            )}
          />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium leading-5">
            <span className="truncate">{mainLabel ? providerLabel : profile.name}</span>
            {mainLabel ? (
              <span className="workspace-account-tag">{mainLabel}</span>
            ) : (
              <span className="sr-only"> · {providerLabel}</span>
            )}
          </span>
          <span
            className="block truncate text-[11px] leading-4 text-muted-foreground"
            title={identity?.email ?? statusLabel}
          >
            {identity?.email ?? (signedIn ? t("accountEmailUnavailable") : statusLabel)}
          </span>
        </span>
        {used > 0 && (
          <span className="workspace-account-count" title={t("terminalCount", { count: used })}>
            {used}
          </span>
        )}
        {selected && (
          <CheckIcon
            className="size-3.5 shrink-0 text-foreground"
            aria-label={t("selectedAccount")}
          />
        )}
      </button>
      {onSignIn && !signedIn && status !== "checking" && (
        <button className="workspace-account-signin" onClick={onSignIn}>
          {t("signIn")}
        </button>
      )}
      {onEdit && (
        <button
          className="workspace-icon-button workspace-account-edit"
          onClick={onEdit}
          aria-label={t("editNamedAccount", { name: profile.name })}
          title={t("editAccount")}
        >
          <PencilIcon className="size-3" />
        </button>
      )}
    </div>
  );
}
