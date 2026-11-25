import { HarnessToolsPanel, harnessToolsQueryOptions } from "./HarnessToolsPanel";
import { YourSitesSection } from "~/components/sites/YourSitesSection";
import { SubscriptionPlansPanel } from "./SubscriptionPlansPanel";
import type {
  HarnessAccount,
  HarnessId,
  HarnessLoginInput,
  HarnessLoginResult,
} from "@djl/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppSettings } from "~/appSettings";
import { ProviderIcon } from "~/components/ProviderIcon";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { StatusChip } from "~/components/ui/status-chip";
import { CheckIcon, ExternalLinkIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { ensureNativeApi } from "~/nativeApi";
import { providerDiscoveryQueryKeys } from "~/lib/providerDiscoveryReactQuery";
import { serverConfigQueryOptions, serverQueryKeys } from "~/lib/serverReactQuery";
import { SettingsSection } from "./SettingsPanelPrimitives";
import { DjlCloudAccountCard } from "./DjlCloudAccountCard";
import { HarnessSignInDialog } from "./HarnessSignInDialog";
import { SettingsLoadError, settingsLoadErrorDetail } from "./SettingsLoadError";

const LEGACY_OPENCODE_QUERY_KEY = ["legacy-opencode-credentials"] as const;
const ACCOUNTS_QUERY_KEY = ["harness-accounts"] as const;
const HARNESSES: { id: HarnessId; label: string; docs: string }[] = [
  { id: "codex", label: "Codex", docs: "https://developers.openai.com/codex/cli/" },
  { id: "claudeAgent", label: "Claude Code", docs: "https://code.claude.com/docs/en/setup" },
  { id: "cursor", label: "Cursor", docs: "https://cursor.com/docs/cli/installation" },
  { id: "gemini", label: "Gemini CLI", docs: "https://github.com/google-gemini/gemini-cli" },
  { id: "grok", label: "Grok Build", docs: "https://docs.x.ai/build/overview" },
  {
    id: "kimi",
    label: "Kimi Code",
    docs: "https://www.kimi.com/code/docs/en/kimi-code-cli/guides/getting-started.html",
  },
  { id: "iflow", label: "iFlow CLI", docs: "https://github.com/iflow-ai/iflow-cli" },
  { id: "qwen", label: "Qwen Code", docs: "https://github.com/QwenLM/qwen-code" },
  {
    id: "copilot",
    label: "GitHub Copilot",
    docs: "https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli",
  },
  {
    id: "codebuddy",
    label: "CodeBuddy Code",
    docs: "https://www.codebuddy.ai/docs/cli/quickstart",
  },
  { id: "pi", label: "Pi", docs: "https://pi.dev/docs/latest/providers" },
  { id: "opencode", label: "OpenCode", docs: "https://opencode.ai/docs/providers/" },
];

// The dot beside each account's status; a status without one reads as plain muted text.
const STATUS_DOT_CLASS_NAME: Partial<Record<HarnessAccount["status"], string>> = {
  ready: "bg-emerald-500",
  required: "bg-amber-500",
  incompatible: "bg-destructive",
};

export function HarnessAccountsPanel({ revealPlans = false }: { revealPlans?: boolean } = {}) {
  const { t } = useTranslation("settings");
  const queryClient = useQueryClient();
  const { settings, updateSettings } = useAppSettings();
  const saveKimiRegion = useMutation({
    mutationFn: (region: "existing" | "global" | "mainland-cn") =>
      ensureNativeApi().server.updateSettings({ providers: { kimi: { region } } }),
    onSuccess: async (next) => {
      queryClient.setQueryData(serverQueryKeys.settings(), next);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ACCOUNTS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: providerDiscoveryQueryKeys.all }),
      ]);
    },
  });
  const [session, setSession] = useState<HarnessLoginResult | null>(null);
  // The sign-in the dialog is guiding; set from the click until the dialog closes.
  const [signIn, setSignIn] = useState<{
    request: HarnessLoginInput;
    label: string;
    statusAtOpen: HarnessAccount["status"] | undefined;
    attempt: number;
    /** Present when DJL installs the CLI before the sign-in starts. */
    install?: { state: "running" | "failed" | "done"; error: string | null };
  } | null>(null);
  const sessionRef = useRef<HarnessLoginResult | null>(null);
  const pendingHarness = useRef<HarnessId | null>(null);
  // The agent whose install the open dialog is waiting on; cleared when the dialog closes.
  const installFor = useRef<HarnessId | null>(null);
  const mounted = useRef(false);
  const accounts = useQuery({
    queryKey: ACCOUNTS_QUERY_KEY,
    queryFn: () => ensureNativeApi().harnesses.listAccounts(),
    staleTime: 15_000,
  });
  const tools = useQuery(harnessToolsQueryOptions());
  const legacyOpenCode = useQuery({
    queryKey: LEGACY_OPENCODE_QUERY_KEY,
    queryFn: () => ensureNativeApi().harnesses.listLegacyOpenCodeCredentials(),
    enabled:
      accounts.data?.accounts.some((account) => account.id === "opencode" && account.installed) ??
      false,
    staleTime: 15_000,
  });
  const transferLegacyOpenCode = useMutation({
    mutationFn: () => ensureNativeApi().harnesses.transferLegacyOpenCodeCredentials(),
    onSuccess: async () => {
      await refresh();
    },
  });
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ACCOUNTS_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: LEGACY_OPENCODE_QUERY_KEY }),
      ensureNativeApi()
        .server.refreshProviders()
        .then(() =>
          queryClient.invalidateQueries({ queryKey: serverConfigQueryOptions().queryKey }),
        ),
      queryClient.invalidateQueries({ queryKey: providerDiscoveryQueryKeys.all }),
    ]);
  };
  const connect = useMutation({
    mutationFn: async (request: HarnessLoginInput) => {
      const { harness } = request;
      const api = ensureNativeApi();
      pendingHarness.current = harness;
      try {
        const nextSession = await api.harnesses.startLogin(request);
        if (!mounted.current) {
          // Close this exact late result; another panel may already own a new login.
          await api.terminal.close({ ...nextSession, deleteHistory: true });
          return;
        }
        sessionRef.current = nextSession;
        setSession(nextSession);
      } catch (error) {
        // The server may have started a PTY even if the response was lost.
        if (mounted.current) await api.harnesses.endLogin({ harness }).catch(() => undefined);
        throw error;
      } finally {
        pendingHarness.current = null;
      }
    },
  });
  const finish = useMutation({
    mutationFn: async () => {
      if (sessionRef.current)
        await ensureNativeApi().harnesses.endLogin({ harness: sessionRef.current.harness });
      sessionRef.current = null;
      installFor.current = null;
      setSession(null);
      setSignIn(null);
      connect.reset();
      await refresh();
    },
  });
  // Installs the CLI with the same tool install the Provider tools section runs, then lets
  // the account check decide: once it reports the CLI installed, the sign-in starts.
  const install = useMutation({
    mutationFn: async ({ harness, label }: { harness: HarnessId; label: string }) => {
      const api = ensureNativeApi();
      const failure = await api.harnesses.maintainTool({ harness }).then(
        () => null,
        (error: unknown) => error,
      );
      await Promise.allSettled([
        refresh(),
        queryClient.invalidateQueries({ queryKey: harnessToolsQueryOptions().queryKey }),
      ]);
      const latest = await queryClient.fetchQuery({
        queryKey: ACCOUNTS_QUERY_KEY,
        queryFn: () => api.harnesses.listAccounts(),
      });
      // The install can report a problem after the CLI landed (e.g. an unverified latest
      // version); an installed CLI is all the sign-in needs.
      if (latest.accounts.some((account) => account.id === harness && account.installed)) return;
      throw failure ?? new Error(t("accounts.installNotDetected", { provider: label }));
    },
    onSuccess: (_result, { harness }) => {
      if (!mounted.current || installFor.current !== harness) return;
      installFor.current = null;
      setSignIn((current) => current && { ...current, install: { state: "done", error: null } });
      connect.mutate({ harness });
    },
    onError: (error, { harness, label }) => {
      if (!mounted.current || installFor.current !== harness) return;
      const message = settingsLoadErrorDetail(
        error,
        t("accounts.installNotDetected", { provider: label }),
      );
      setSignIn(
        (current) => current && { ...current, install: { state: "failed", error: message } },
      );
    },
  });
  const accountStatus = (harness: HarnessId) =>
    accounts.data?.accounts.find((account) => account.id === harness)?.status;
  const startSignIn = (request: HarnessLoginInput, label: string) => {
    setSignIn({ request, label, statusAtOpen: accountStatus(request.harness), attempt: 0 });
    connect.mutate(request);
  };
  const runInstall = (harness: HarnessId, label: string) => {
    installFor.current = harness;
    install.mutate({ harness, label });
  };
  const startInstallAndSignIn = (harness: HarnessId, label: string) => {
    setSignIn({
      request: { harness },
      label,
      statusAtOpen: accountStatus(harness),
      attempt: 0,
      install: { state: "running", error: null },
    });
    runInstall(harness, label);
  };
  // Ends the attempt that stopped, then starts the same sign-in again in a fresh dialog.
  const retry = useMutation({
    mutationFn: async () => {
      if (!signIn) return;
      await ensureNativeApi()
        .harnesses.endLogin({ harness: signIn.request.harness })
        .catch(() => undefined);
      sessionRef.current = null;
      setSession(null);
      setSignIn({ ...signIn, attempt: signIn.attempt + 1 });
      connect.mutate(signIn.request);
    },
  });
  const { refetch: refetchAccounts } = accounts;
  const checkAccounts = useCallback(() => void refetchAccounts(), [refetchAccounts]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const harness = sessionRef.current?.harness ?? pendingHarness.current;
      if (harness)
        void ensureNativeApi()
          .harnesses.endLogin({ harness })
          .catch(() => undefined);
    };
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          disabled={accounts.isFetching}
          onClick={() => void refresh().catch(() => undefined)}
        >
          {t("accounts.refresh")}
        </Button>
      </div>
      {accounts.isError ? (
        <SettingsLoadError
          summary={t("accounts.loadError")}
          detail={settingsLoadErrorDetail(accounts.error, t("accounts.loadError"))}
          actionLabel={t("accounts.refresh")}
          onAction={() => void accounts.refetch()}
        />
      ) : null}
      <DjlCloudAccountCard />
      <YourSitesSection />
      <SettingsSection title={t("accounts.title")}>
        {HARNESSES.map((harness) => {
          const account = accounts.data?.accounts.find((item) => item.id === harness.id);
          const tool = tools.data?.tools.find((item) => item.id === harness.id);
          const connected = account?.status === "ready";
          const isDefault = settings.defaultProvider === harness.id;
          return (
            <div key={harness.id} className="flex flex-wrap items-center gap-3 px-4 py-3.5">
              <span
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-[var(--color-background-elevated-secondary)]",
                  account && !account.installed && "opacity-55",
                )}
              >
                <ProviderIcon provider={harness.id} className="size-[1.125rem]" />
              </span>
              <div className="min-w-40 flex-1">
                <div className="flex items-center gap-2 text-sm font-medium">
                  {harness.label}
                  {isDefault && connected ? (
                    <span className="flex items-center gap-1 text-xs font-normal text-muted-foreground">
                      <CheckIcon className="size-3.5" />
                      {t("accounts.default")}
                    </span>
                  ) : null}
                </div>
                {account ? (
                  <StatusChip
                    className={cn(
                      "mt-1 text-xs",
                      connected ? "text-foreground/80" : "text-muted-foreground",
                    )}
                    dotClassName={STATUS_DOT_CLASS_NAME[account.status] ?? "hidden"}
                  >
                    {t(`accounts.status.${account.status}`)}
                  </StatusChip>
                ) : (
                  <Skeleton className="mt-1.5 h-3.5 w-24" />
                )}
              </div>
              {harness.id === "kimi" ? (
                <select
                  aria-label={t("subscriptions.kimiRegion")}
                  className="h-8 max-w-44 rounded-lg border bg-background px-2 text-xs sm:h-7"
                  value={settings.kimiRegion ?? "existing"}
                  disabled={connect.isPending || signIn !== null || saveKimiRegion.isPending}
                  onChange={(event) =>
                    saveKimiRegion.mutate(
                      event.target.value as "existing" | "global" | "mainland-cn",
                    )
                  }
                >
                  <option value="existing">{t("subscriptions.existingRegion")}</option>
                  <option value="global">{t("subscriptions.international")}</option>
                  <option value="mainland-cn">{t("subscriptions.china")}</option>
                </select>
              ) : null}
              {!account || connected ? null : (
                <Button
                  size="sm"
                  variant="ghost"
                  render={<a href={harness.docs} target="_blank" rel="noreferrer" />}
                >
                  {t("accounts.setup")}
                  <ExternalLinkIcon />
                </Button>
              )}
              {/* A disabled agent cannot sign in, so it is only offered once turned on. */}
              {account && !account.installed && account.enabled && tool?.canInstall ? (
                <Button
                  size="sm"
                  disabled={
                    tool.maintenanceStatus === "running" ||
                    install.isPending ||
                    connect.isPending ||
                    saveKimiRegion.isPending ||
                    signIn !== null
                  }
                  onClick={() => startInstallAndSignIn(harness.id, harness.label)}
                >
                  {t("accounts.installAndSignIn")}
                </Button>
              ) : null}
              {account?.installed ? (
                <>
                  <Button
                    size="sm"
                    variant={account.status === "required" ? "default" : "outline"}
                    disabled={
                      account.status === "incompatible" ||
                      !account.enabled ||
                      connect.isPending ||
                      saveKimiRegion.isPending ||
                      signIn !== null
                    }
                    onClick={() => startSignIn({ harness: harness.id }, harness.label)}
                  >
                    {t(connected ? "accounts.signInAgain" : "accounts.signIn")}
                  </Button>
                  {(isDefault && connected) || account.status === "required" ? null : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={account.status === "incompatible" || !account.enabled || isDefault}
                      onClick={() => updateSettings({ defaultProvider: harness.id })}
                    >
                      {isDefault ? t("accounts.default") : t("accounts.useForNewChats")}
                    </Button>
                  )}
                </>
              ) : null}
            </div>
          );
        })}
      </SettingsSection>
      <div className="space-y-3 rounded-lg border px-4 py-4">
        <p className="text-sm text-muted-foreground">{t("accounts.openCodeSharedLogin")}</p>
        {legacyOpenCode.data?.availableProviderIds.length ? (
          <>
            <p className="text-sm text-muted-foreground">
              {t("accounts.openCodeLegacyAvailable", {
                providers: legacyOpenCode.data.availableProviderIds.join(", "),
              })}
            </p>
            <Button
              size="sm"
              variant="outline"
              disabled={transferLegacyOpenCode.isPending || connect.isPending || signIn !== null}
              onClick={() => transferLegacyOpenCode.mutate()}
            >
              {transferLegacyOpenCode.isPending
                ? t("accounts.openCodeTransferring")
                : t("accounts.openCodeTransfer")}
            </Button>
          </>
        ) : null}
        {legacyOpenCode.data?.existingProviderIds.length ? (
          <p className="text-xs text-muted-foreground">
            {t("accounts.openCodeExistingKept", {
              providers: legacyOpenCode.data.existingProviderIds.join(", "),
            })}
          </p>
        ) : null}
        {transferLegacyOpenCode.isSuccess ? (
          <p role="status" className="text-sm text-muted-foreground">
            {t("accounts.openCodeTransferComplete")}
          </p>
        ) : null}
        {legacyOpenCode.isError || transferLegacyOpenCode.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {t("accounts.openCodeTransferError")}
          </p>
        ) : null}
      </div>
      {finish.isError || saveKimiRegion.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {settingsLoadErrorDetail(finish.error ?? saveKimiRegion.error, t("accounts.loadError"))}
        </p>
      ) : null}
      {signIn ? (
        <HarnessSignInDialog
          key={signIn.attempt}
          harness={signIn.request.harness}
          label={signIn.label}
          session={session}
          startError={
            connect.isError ? settingsLoadErrorDetail(connect.error, t("accounts.loadError")) : null
          }
          statusAtOpen={signIn.statusAtOpen}
          status={accountStatus(signIn.request.harness)}
          checking={accounts.isFetching}
          closing={finish.isPending || retry.isPending}
          isDefault={settings.defaultProvider === signIn.request.harness}
          {...(signIn.install ? { install: signIn.install } : {})}
          onCheck={checkAccounts}
          onRetry={() => {
            if (signIn.install?.state !== "failed") return retry.mutate();
            setSignIn({ ...signIn, install: { state: "running", error: null } });
            runInstall(signIn.request.harness, signIn.label);
          }}
          onClose={() => finish.mutate()}
          onUseForNewChats={() => {
            updateSettings({ defaultProvider: signIn.request.harness });
            finish.mutate();
          }}
        />
      ) : null}
      <HarnessToolsPanel disabled={connect.isPending || install.isPending || signIn !== null} />
      <SubscriptionPlansPanel {...(revealPlans ? { reveal: true } : {})} />
    </div>
  );
}
