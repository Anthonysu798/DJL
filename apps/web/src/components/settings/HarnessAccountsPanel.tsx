import { HarnessToolsPanel } from "./HarnessToolsPanel";
import { SubscriptionPlansPanel } from "./SubscriptionPlansPanel";
import "@xterm/xterm/css/xterm.css";
import type { HarnessId, HarnessLoginInput, HarnessLoginResult } from "@synara/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppSettings } from "~/appSettings";
import { Button } from "~/components/ui/button";
import { ensureNativeApi } from "~/nativeApi";
import { providerDiscoveryQueryKeys } from "~/lib/providerDiscoveryReactQuery";
import { serverConfigQueryOptions } from "~/lib/serverReactQuery";
import {
  terminalRuntimeRegistry,
  buildTerminalRuntimeKey,
} from "../terminal/terminalRuntimeRegistry";
import { SettingsSection } from "./SettingsPanelPrimitives";
import { SettingsLoadError, settingsLoadErrorDetail } from "./SettingsLoadError";

const LEGACY_OPENCODE_QUERY_KEY = ["legacy-opencode-credentials"] as const;
const ACCOUNTS_QUERY_KEY = ["harness-accounts"] as const;
const HARNESSES: { id: HarnessId; label: string; docs: string }[] = [
  { id: "codex", label: "Codex", docs: "https://developers.openai.com/codex/cli/" },
  { id: "claudeAgent", label: "Claude Code", docs: "https://code.claude.com/docs/en/setup" },
  { id: "cursor", label: "Cursor", docs: "https://cursor.com/docs/cli/installation" },
  { id: "opencode", label: "OpenCode", docs: "https://opencode.ai/docs/providers/" },
];

function LoginTerminal({ session }: { session: HarnessLoginResult }) {
  const container = useRef<HTMLDivElement>(null);
  const { t } = useTranslation("settings");
  useEffect(() => {
    if (!container.current) return;
    const runtimeKey = buildTerminalRuntimeKey(session.threadId, session.terminalId);
    terminalRuntimeRegistry.attach(
      {
        runtimeKey,
        threadId: session.threadId,
        terminalId: session.terminalId,
        terminalLabel: session.harness,
        cwd: session.cwd,
        callbacks: {
          onSessionExited: () => {},
          onTerminalMetadataChange: () => {},
          onTerminalActivityChange: () => {},
        },
      },
      { autoFocus: true, isVisible: true },
      container.current,
    );
    return () => terminalRuntimeRegistry.dispose(runtimeKey);
  }, [session]);
  return (
    <div
      ref={container}
      role="region"
      aria-label={t("accounts.terminalLabel")}
      className="h-80 min-w-0 overflow-hidden rounded-lg bg-[#111111] p-2"
    />
  );
}

export function HarnessAccountsPanel() {
  const { t } = useTranslation("settings");
  const queryClient = useQueryClient();
  const { settings, updateSettings } = useAppSettings();
  const [session, setSession] = useState<HarnessLoginResult | null>(null);
  const sessionRef = useRef<HarnessLoginResult | null>(null);
  const pendingHarness = useRef<HarnessId | null>(null);
  const mounted = useRef(false);
  const accounts = useQuery({
    queryKey: ACCOUNTS_QUERY_KEY,
    queryFn: () => ensureNativeApi().harnesses.listAccounts(),
    staleTime: 15_000,
  });
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
      setSession(null);
      await refresh();
    },
  });
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
      <SettingsSection title={t("accounts.title")}>
        {HARNESSES.map((harness) => {
          const account = accounts.data?.accounts.find((item) => item.id === harness.id);
          return (
            <div key={harness.id} className="flex flex-wrap items-center gap-3 px-4 py-4">
              <div className="min-w-40 flex-1">
                <div className="text-sm font-medium">{harness.label}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {account ? t(`accounts.status.${account.status}`) : t("accounts.checking")}
                </div>
              </div>
              <a
                href={harness.docs}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-muted-foreground underline underline-offset-4"
              >
                {t("accounts.setup")}
              </a>
              <Button
                size="sm"
                variant="outline"
                disabled={
                  !account?.installed ||
                  account.status === "incompatible" ||
                  !account.enabled ||
                  connect.isPending ||
                  session !== null
                }
                onClick={() => connect.mutate({ harness: harness.id })}
              >
                {connect.isPending && connect.variables?.harness === harness.id
                  ? t("accounts.checking")
                  : t("accounts.signIn")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={
                  !account?.installed ||
                  account.status === "required" ||
                  account.status === "incompatible" ||
                  !account.enabled ||
                  settings.defaultProvider === harness.id
                }
                onClick={() => updateSettings({ defaultProvider: harness.id })}
              >
                {settings.defaultProvider === harness.id
                  ? t("accounts.default")
                  : t("accounts.useForNewChats")}
              </Button>
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
              disabled={transferLegacyOpenCode.isPending || connect.isPending || session !== null}
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
      {connect.isError || finish.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {settingsLoadErrorDetail(connect.error ?? finish.error, t("accounts.loadError"))}
        </p>
      ) : null}
      {session ? (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">{t("accounts.loginInstructions")}</p>
            <Button
              size="sm"
              variant="outline"
              disabled={finish.isPending}
              onClick={() => finish.mutate()}
            >
              {t("accounts.finish")}
            </Button>
          </div>
          <LoginTerminal session={session} />
        </section>
      ) : null}
      <HarnessToolsPanel disabled={connect.isPending || session !== null} />
      <SubscriptionPlansPanel
        enabled={
          accounts.data?.accounts.some(
            (account) =>
              account.id === "opencode" &&
              account.installed &&
              account.enabled &&
              account.status !== "incompatible",
          ) ?? false
        }
        disabled={connect.isPending || session !== null || finish.isPending}
        onConnect={(request) => connect.mutate(request)}
      />
    </div>
  );
}
