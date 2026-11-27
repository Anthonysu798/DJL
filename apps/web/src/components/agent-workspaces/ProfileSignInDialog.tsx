// FILE: ProfileSignInDialog.tsx
// Purpose: Signs one AI account in (the main login or an extra account) with the CLI's own
//          login command. Same guided shape as the agent sign-in in Settings: three live
//          steps, the sign-in page as a button, and the command's screen one click away.

import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { AgentAccountProfile } from "~/agentWorkspaceStore";
import { ensureNativeApi } from "~/nativeApi";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { DisclosureChevron } from "../ui/DisclosureChevron";
import { DisclosureRegion } from "../ui/DisclosureRegion";
import {
  Stepper,
  StepperDescription,
  StepperItem,
  StepperTitle,
  type StepState,
} from "../ui/stepper";
import { ConnectionMark } from "../settings/HarnessSignInDialog";
import type { SignInPhase } from "../settings/harnessSignIn.logic";
import { CheckIcon, CopyIcon, ExternalLinkIcon } from "~/lib/icons";
import { terminalProfileId } from "~/lib/workspaceAccountIds";
import {
  terminalRuntimeRegistry,
  buildTerminalRuntimeKey,
} from "../terminal/terminalRuntimeRegistry";
import { createProfileLoginSession, providerSignInUrl } from "./profileLoginSession";
import { PROFILE_ACCOUNT_QUERY_KEY } from "./WorkspaceAccountRow";

// A browser sign-in prints its link within a moment. Silence this long means the command
// is asking something, so its screen is brought into view.
const NO_LINK_REVEAL_MS = 8_000;
const reveal = "animate-in fade-in slide-in-from-bottom-1 duration-200 motion-reduce:animate-none";

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
  const { t: ts } = useTranslation("settings");
  const client = useQueryClient();
  const host = useRef<HTMLDivElement>(null);
  const controller = useRef<ReturnType<typeof createProfileLoginSession> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [exited, setExited] = useState(false);
  const [loginUrl, setLoginUrl] = useState<string | null>(null);
  const [stalled, setStalled] = useState(false);
  const [windowOpen, setWindowOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [checking, setChecking] = useState(false);
  const [browserError, setBrowserError] = useState(false);
  const [closing, setClosing] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // The main account is `default` to the server, whichever id the caller lists it under.
  const profileId = terminalProfileId(profile.id);
  const account = useQuery({
    queryKey: [...PROFILE_ACCOUNT_QUERY_KEY, profile.provider, profile.id],
    queryFn: () =>
      ensureNativeApi().harnesses.getProfileAccount({ provider: profile.provider, profileId }),
    enabled: ready,
    refetchInterval: (query) => (ready && query.state.data?.status !== "signedIn" ? 2_000 : false),
    staleTime: 0,
    retry: false,
  });
  const { refetch } = account;
  const signedIn = account.data?.status === "signedIn" && !account.isError;
  const phase: SignInPhase = signedIn
    ? "connected"
    : error || (exited && !account.isFetching)
      ? "failed"
      : ready
        ? "waiting"
        : "starting";
  const waiting = phase === "waiting";

  useEffect(() => {
    let disposed = false;
    let runtimeKey: string | undefined;
    let output = "";
    setLoginUrl(null);
    setBrowserError(false);
    setStalled(false);
    setExited(false);
    setCopied(false);
    const session = createProfileLoginSession(
      ensureNativeApi(),
      { ...profile, id: profileId },
      (data) => {
        if (disposed) return;
        output = (output + data).slice(-32_768);
        const url = providerSignInUrl(profile.provider, output);
        if (url) setLoginUrl(url);
      },
    );
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
                // Failed only once the check after exit still finds no account.
                void refetch().finally(() => {
                  if (!disposed) setExited(true);
                });
              },
              onTerminalMetadataChange: () => {},
              onTerminalActivityChange: () => {},
              onTerminalRuntimeStatusChange: (_, status) => {
                if (status === "error") setError(t("signInStartError"));
              },
            },
          },
          { autoFocus: false, isVisible: true },
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
  }, [profile, profileId, providerLabel, attempt, refetch, t]);

  // Coming back from the browser is the moment the account most likely changed.
  useEffect(() => {
    if (!waiting) return;
    const check = () => void refetch();
    window.addEventListener("focus", check);
    return () => window.removeEventListener("focus", check);
  }, [waiting, refetch]);

  useEffect(() => {
    if (!waiting || loginUrl) return;
    const timer = window.setTimeout(() => {
      setStalled(true);
      setWindowOpen(true);
    }, NO_LINK_REVEAL_MS);
    return () => window.clearTimeout(timer);
  }, [waiting, loginUrl]);

  useEffect(() => {
    if (phase === "failed") setWindowOpen(true);
  }, [phase]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1_600);
    return () => window.clearTimeout(timer);
  }, [copied]);

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
  const retry = async () => {
    setClosing(true);
    try {
      await controller.current?.close();
      setAttempt((value) => value + 1);
    } catch {
      setError(t("signInCloseError"));
    } finally {
      setClosing(false);
    }
  };
  const check = () => {
    setChecking(true);
    void refetch().finally(() => setChecking(false));
  };

  const linkStep = loginUrl !== null || stalled;
  const steps: [StepState, StepState, StepState] =
    phase === "connected"
      ? ["done", "done", "success"]
      : phase === "failed"
        ? linkStep
          ? ["done", "error", "pending"]
          : ["error", "pending", "pending"]
        : linkStep
          ? ["done", "loading", "pending"]
          : ["loading", "pending", "pending"];
  const title =
    phase === "connected"
      ? ts("accounts.guideConnectedTitle", { provider: providerLabel })
      : phase === "failed"
        ? ts("accounts.guideFailedTitle")
        : t("signInWith", { provider: providerLabel });
  const description =
    phase === "connected"
      ? ts("accounts.guideConnectedDescription")
      : phase === "failed"
        ? (error ?? ts("accounts.guideFailedDescription", { provider: providerLabel }))
        : ts("accounts.guideDescription", { provider: providerLabel });

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !closing) void finish(false);
      }}
    >
      <DialogPopup surface="solid" className="max-w-[440px]" bottomStickOnMobile={false}>
        <DialogHeader className="gap-5 px-6 pt-6 pb-1">
          <ConnectionMark harness={profile.provider} phase={phase} />
          <div className="space-y-2">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5 pe-8">
              <DialogTitle className="text-balance">{title}</DialogTitle>
              {profile.name ? (
                <span className="max-w-full truncate rounded-full border border-border px-2 text-xs leading-5 text-muted-foreground">
                  {profile.name}
                </span>
              ) : null}
            </div>
            <DialogDescription
              role={phase === "failed" ? "alert" : "status"}
              className="text-pretty leading-relaxed"
            >
              {description}
            </DialogDescription>
          </div>
        </DialogHeader>
        <DialogPanel className="px-6">
          <Stepper className="mt-4" aria-label={title}>
            <StepperItem step={1} state={steps[0]}>
              <StepperTitle>{ts("accounts.guideStepOpen")}</StepperTitle>
              {steps[0] === "loading" ? (
                <StepperDescription className={reveal}>
                  {ts("accounts.guideStepOpenStarting", { provider: providerLabel })}
                </StepperDescription>
              ) : null}
            </StepperItem>
            <StepperItem step={2} state={steps[1]}>
              <StepperTitle>{ts("accounts.guideStepApprove")}</StepperTitle>
              {steps[1] === "loading" ? (
                <div className={reveal}>
                  <StepperDescription>
                    {ts(
                      stalled && !loginUrl
                        ? "accounts.guideNeedsAnswer"
                        : "accounts.guideStepApproveHint",
                      { provider: providerLabel },
                    )}
                  </StepperDescription>
                  {loginUrl ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        className="group/open"
                        onClick={() => {
                          setBrowserError(false);
                          void ensureNativeApi()
                            .shell.openExternal(loginUrl)
                            .catch(() => setBrowserError(true));
                        }}
                      >
                        {t("openSignInPage")}
                        <ExternalLinkIcon className="transition-transform duration-200 ease-out group-hover/open:translate-x-0.5 group-hover/open:-translate-y-0.5 motion-reduce:transition-none" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          void navigator.clipboard.writeText(loginUrl).then(() => setCopied(true));
                        }}
                      >
                        <span
                          key={String(copied)}
                          className="animate-in zoom-in-75 fade-in duration-150 motion-reduce:animate-none"
                        >
                          {copied ? (
                            <CheckIcon className="size-4 text-emerald-600 dark:text-emerald-400" />
                          ) : (
                            <CopyIcon className="size-4" />
                          )}
                        </span>
                        {ts(copied ? "accounts.guideLinkCopied" : "accounts.guideCopyLink")}
                      </Button>
                    </div>
                  ) : null}
                  {browserError ? (
                    <p role="alert" className="mt-2 text-sm text-destructive">
                      {t("signInBrowserError")}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </StepperItem>
            <StepperItem step={3} state={steps[2]}>
              <StepperTitle>{ts("accounts.guideStepConnected")}</StepperTitle>
              {phase === "connected" ? (
                <div className="mt-2 inline-flex max-w-full animate-in items-center gap-2 rounded-full bg-emerald-500/10 py-1 ps-1.5 pe-3 text-sm text-emerald-700 fade-in zoom-in-95 duration-300 ease-out motion-reduce:animate-none dark:text-emerald-300">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
                    <CheckIcon className="size-3" />
                  </span>
                  <span className="min-w-0 truncate">{account.data?.email ?? providerLabel}</span>
                </div>
              ) : null}
            </StepperItem>
          </Stepper>
          {account.isError ? (
            <p role="alert" className="mt-4 text-sm text-destructive">
              {t("profileStatus.unknown")}
            </p>
          ) : null}
          <div className={phase === "connected" ? "hidden" : "mt-5 border-t border-border pt-2"}>
            <button
              type="button"
              aria-expanded={windowOpen}
              className="-mx-1.5 flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
              onClick={() => setWindowOpen((open) => !open)}
            >
              <DisclosureChevron open={windowOpen} className="size-3.5" />
              {ts(windowOpen ? "accounts.guideHideWindow" : "accounts.guideShowWindow")}
            </button>
            <DisclosureRegion open={windowOpen} contentClassName="pt-2">
              <div
                ref={host}
                role="region"
                aria-label={t("signInTerminal")}
                className="h-52 min-w-0 overflow-hidden rounded-xl border border-border bg-[var(--color-token-terminal-background,var(--color-background-surface))] p-2"
              />
            </DisclosureRegion>
          </div>
        </DialogPanel>
        <DialogFooter className="px-6 pt-4 pb-5">
          {phase === "connected" ? (
            <>
              <Button variant="ghost" disabled={closing} onClick={() => void finish(false)}>
                {ts("accounts.guideDone")}
              </Button>
              <Button disabled={closing} onClick={() => void finish(true)}>
                {t("useThisAccount")}
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" disabled={closing} onClick={() => void finish(false)}>
                {t(closing ? "closing" : "cancel")}
              </Button>
              {phase === "failed" ? (
                <Button disabled={closing} onClick={() => void retry()}>
                  {t("retrySignIn")}
                </Button>
              ) : (
                <Button variant="outline" disabled={!ready || closing || checking} onClick={check}>
                  {ts(checking ? "accounts.checking" : "accounts.guideCheck")}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
