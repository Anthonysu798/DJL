import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { AgentAccountProfile } from "~/agentWorkspaceStore";
import { ensureNativeApi } from "~/nativeApi";
import { cn } from "~/lib/utils";
import { RefreshCwIcon, CheckIcon, PencilIcon } from "~/lib/icons";

export const PROFILE_ACCOUNT_QUERY_KEY = ["workspace-profile-account"] as const;
export function RefreshWorkspaceAccounts() {
  const client = useQueryClient();
  const { t } = useTranslation("workspace", { keyPrefix: "agents" });
  return (
    <button
      aria-label={t("refreshAccounts")}
      title={t("refreshAccounts")}
      onClick={() => void client.invalidateQueries({ queryKey: PROFILE_ACCOUNT_QUERY_KEY })}
    >
      <RefreshCwIcon className="size-3.5" />
    </button>
  );
}

export function WorkspaceAccountRow({
  profile,
  providerLabel,
  used,
  onEdit,
  selected = false,
  onSelect,
  onSignIn,
}: {
  profile: AgentAccountProfile;
  providerLabel: string;
  used: number;
  onEdit: () => void;
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
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    retry: false,
  });
  const { refetch } = account;
  useEffect(() => {
    const refresh = () => {
      void refetch({ cancelRefetch: false });
    };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refetch]);
  const identity = account.isError ? undefined : account.data;
  const status = account.isError ? "unknown" : (identity?.status ?? "checking");
  const statusLabel = t(`profileStatus.${status}`);
  return (
    <div
      className={cn(
        "group mb-1 flex items-center rounded-md hover:bg-muted",
        selected && "bg-muted",
      )}
    >
      <button
        className="flex min-w-0 flex-1 items-center gap-2 px-1 py-2 text-left"
        aria-pressed={selected}
        title={t("useThisAccount")}
        onClick={status === "signedIn" ? (onSelect ?? onEdit) : (onSignIn ?? onEdit)}
      >
        <span
          role="img"
          aria-label={statusLabel}
          title={statusLabel}
          className={cn(
            "size-2 shrink-0 rounded-full",
            status === "signedIn"
              ? "bg-emerald-400"
              : status === "checking"
                ? "bg-muted-foreground"
                : "bg-red-400",
          )}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs">{profile.name}</span>
          <span className="block text-[10px] text-muted-foreground">{providerLabel}</span>
          <span
            className="block truncate text-[10px] text-muted-foreground"
            title={identity?.email ?? statusLabel}
          >
            {identity?.email ??
              (status === "signedIn" ? t("accountEmailUnavailable") : statusLabel)}
          </span>
        </span>
        <span className="text-[10px] text-muted-foreground">{used}</span>
        {selected && <CheckIcon className="size-3 shrink-0" aria-label={t("selectedAccount")} />}
      </button>
      <div className="flex shrink-0 items-center gap-1">
        {onSignIn && status !== "signedIn" && status !== "checking" && (
          <button className="px-1 text-[10px] underline underline-offset-2" onClick={onSignIn}>
            {t("signIn")}
          </button>
        )}
        <button
          className="p-1 text-muted-foreground"
          onClick={onEdit}
          aria-label={t("editNamedAccount", { name: profile.name })}
          title={t("editAccount")}
        >
          <PencilIcon className="size-3" />
        </button>
      </div>
    </div>
  );
}
