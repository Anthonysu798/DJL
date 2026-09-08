import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { AgentAccountProfile } from "~/agentWorkspaceStore";
import { ensureNativeApi } from "~/nativeApi";
import { Dialog, DialogPopup, DialogTitle, DialogDescription, DialogFooter } from "../ui/dialog";
import { Button } from "../ui/button";
import { CheckIcon } from "~/lib/icons";
import {
  terminalRuntimeRegistry,
  buildTerminalRuntimeKey,
} from "../terminal/terminalRuntimeRegistry";
import { createProfileLoginSession, providerSignInUrl } from "./profileLoginSession";
import { PROFILE_ACCOUNT_QUERY_KEY } from "./WorkspaceAccountRow";

export function ProfileSignInDialog({
  profile,
  providerLabel,
  onClose,
  onUseAccount,
}: {
  profile: AgentAccountProfile;
  providerLabel: string;
  onClose: () => void;
  onUseAccount: () => void;
}) {
  const { t } = useTranslation("workspace", { keyPrefix: "agents" });
  const client = useQueryClient();
  const host = useRef<HTMLDivElement>(null);
  const controller = useRef<ReturnType<typeof createProfileLoginSession> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [loginUrl, setLoginUrl] = useState<string | null>(null);
  const [browserError, setBrowserError] = useState(false);
  const [closing, setClosing] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const account = useQuery({
    queryKey: [...PROFILE_ACCOUNT_QUERY_KEY, profile.provider, profile.id],
    queryFn: () =>
      ensureNativeApi().harnesses.getProfileAccount({
        provider: profile.provider,
        profileId: profile.id,
      }),
    enabled: ready,
    refetchInterval: (query) => (ready && query.state.data?.status !== "signedIn" ? 2_000 : false),
    staleTime: 0,
    retry: false,
  });
  const { refetch } = account;
  const signedIn = account.data?.status === "signedIn" && !account.isError;
  useEffect(() => {
    let disposed = false;
    let runtimeKey: string | undefined;
    let output = "";
    setLoginUrl(null);
    setBrowserError(false);
    const session = createProfileLoginSession(ensureNativeApi(), profile, (data) => {
      if (disposed) return;
      output = (output + data).slice(-32_768);
      const url = providerSignInUrl(profile.provider, output);
      if (url) setLoginUrl(url);
    });
    controller.current = session;
    setReady(false);
    setError(null);
    void session.ready
      .then((input) => {
        if (disposed || !input || !host.current) return;
        runtimeKey = buildTerminalRuntimeKey(input.threadId, input.terminalId);
        terminalRuntimeRegistry.attach(
          {
            ...input,
            runtimeKey,
            terminalLabel: providerLabel,
            lightweight: true,
            imageSupport: false,
            screenSnapshot: true,
            callbacks: {
              onSessionExited: () => {
                void refetch();
              },
              onTerminalMetadataChange: () => {},
              onTerminalActivityChange: () => {},
              onTerminalRuntimeStatusChange: (_, status) => {
                if (status === "error") setError(t("signInStartError"));
              },
            },
          },
          { autoFocus: true, isVisible: true },
          host.current,
        );
        setReady(true);
      })
      .catch(() => {
        if (!disposed) setError(t("signInStartError"));
      });
    return () => {
      disposed = true;
      if (runtimeKey) terminalRuntimeRegistry.dispose(runtimeKey);
      void session.close().catch(() => undefined);
    };
  }, [profile, providerLabel, attempt, refetch, t]);
  const finish = async (useAccount: boolean) => {
    setClosing(true);
    try {
      await controller.current?.close();
      await client.invalidateQueries({
        queryKey: [...PROFILE_ACCOUNT_QUERY_KEY, profile.provider, profile.id],
      });
      if (useAccount) onUseAccount();
      else onClose();
    } catch {
      setError(t("signInCloseError"));
      setClosing(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !closing) void finish(false);
      }}
    >
      <DialogPopup
        className="terminal-launch-dialog terminal-workspace-editor terminal-profile-signin"
        bottomStickOnMobile={false}
      >
        <DialogTitle>
          {t(signedIn ? "accountConnected" : "signInWith", { provider: providerLabel })}
        </DialogTitle>
        <DialogDescription>
          {t(signedIn ? "accountReadyHint" : "signInBrowserHint")}
        </DialogDescription>
        {loginUrl && !signedIn && (
          <Button
            className="mt-4"
            onClick={() => {
              setBrowserError(false);
              void ensureNativeApi()
                .shell.openExternal(loginUrl)
                .catch(() => setBrowserError(true));
            }}
          >
            {t("openSignInPage")}
          </Button>
        )}
        {browserError && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {t("signInBrowserError")}
          </p>
        )}
        {signedIn && (
          <div
            role="status"
            className="my-4 flex items-center gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-4 py-3"
          >
            <CheckIcon className="size-5 text-emerald-400" />
            <span className="min-w-0 truncate text-sm">{account.data?.email ?? profile.name}</span>
          </div>
        )}
        {!signedIn && !ready && !error && (
          <p role="status" className="my-3 text-sm text-muted-foreground">
            {t("openingSignIn")}
          </p>
        )}
        <div
          ref={host}
          role="region"
          aria-label={t("signInTerminal")}
          className="my-4 h-64 overflow-hidden rounded-lg bg-[#111111] p-2"
        />
        {account.isError && (
          <p role="alert" className="mb-3 text-sm text-destructive">
            {t("profileStatus.unknown")}
          </p>
        )}
        {error && (
          <p role="alert" className="mb-3 text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" disabled={closing} onClick={() => void finish(false)}>
            {t(closing ? "closing" : "cancel")}
          </Button>
          {error && (
            <Button
              variant="outline"
              disabled={closing}
              onClick={async () => {
                setClosing(true);
                try {
                  await controller.current?.close();
                  setAttempt((value) => value + 1);
                } catch {
                  setError(t("signInCloseError"));
                } finally {
                  setClosing(false);
                }
              }}
            >
              {t("retrySignIn")}
            </Button>
          )}
          {!signedIn && !error && (
            <Button
              variant="outline"
              disabled={!ready || closing || account.isFetching}
              onClick={() => void refetch()}
            >
              {t("checkSignIn")}
            </Button>
          )}
          <Button disabled={!signedIn || closing} onClick={() => void finish(true)}>
            {t("useThisAccount")}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
