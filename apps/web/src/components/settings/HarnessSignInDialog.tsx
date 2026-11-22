// FILE: HarnessSignInDialog.tsx
// Purpose: The guided sign-in for an agent account. It runs the agent's own sign-in
//          command, shows three plain steps, offers the sign-in page as a button, and
//          notices by itself when the account is connected. The command's own screen
//          stays one click away for the agents that ask a question there.

import "@xterm/xterm/css/xterm.css";
import type { HarnessAccount, HarnessId, HarnessLoginResult } from "@djl/contracts";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { DjlLogo } from "~/components/DjlLogo";
import { ProviderIcon } from "~/components/ProviderIcon";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { DisclosureChevron } from "~/components/ui/DisclosureChevron";
import { DisclosureRegion } from "~/components/ui/DisclosureRegion";
import {
  Stepper,
  StepperDescription,
  StepperItem,
  StepperTitle,
  type StepState,
} from "~/components/ui/stepper";
import { CheckIcon, CopyIcon, ExternalLinkIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { ensureNativeApi } from "~/nativeApi";

import {
  buildTerminalRuntimeKey,
  terminalRuntimeRegistry,
} from "../terminal/terminalRuntimeRegistry";
import {
  deriveSignInPhase,
  harnessSignInUrl,
  signInGuide,
  type SignInPhase,
} from "./harnessSignIn.logic";

// A browser sign-in prints its link within a moment. Silence this long means the command
// is asking something, so its screen is brought into view.
const NO_LINK_REVEAL_MS = 8_000;

function SignInTerminal(props: { session: HarnessLoginResult; focused: boolean }) {
  const { session } = props;
  const container = useRef<HTMLDivElement>(null);
  const autoFocus = useRef(props.focused);
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
      { autoFocus: autoFocus.current, isVisible: true },
      container.current,
    );
    return () => terminalRuntimeRegistry.dispose(runtimeKey);
  }, [session]);
  return (
    <div
      ref={container}
      role="region"
      aria-label={t("accounts.terminalLabel")}
      className="h-56 min-w-0 overflow-hidden rounded-lg bg-[#111111] p-2"
    />
  );
}

/** DJL and the agent, joined by a link that fills in once the account is connected. */
function ConnectionMark(props: { harness: HarnessId; phase: SignInPhase }) {
  const { phase } = props;
  const tile =
    "flex size-11 items-center justify-center rounded-xl border border-border bg-[var(--color-background-elevated-secondary)]";
  return (
    <div className="flex items-center gap-2.5" aria-hidden="true">
      {/* The DJL artwork is dark metal, so it sits on a light tile in both themes. */}
      <span className={cn(tile, "bg-white")}>
        <DjlLogo className="size-7" />
      </span>
      {phase === "connected" ? (
        <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
          <span className="h-px w-3 bg-current" />
          <CheckIcon className="size-4" />
          <span className="h-px w-3 bg-current" />
        </span>
      ) : (
        <span className="flex w-[3.25rem] items-center justify-center gap-1.5">
          {[0, 1, 2].map((dot) => (
            <span
              key={dot}
              style={{ animationDelay: `${dot * 180}ms` }}
              className={cn(
                "size-1 rounded-full bg-foreground/55",
                phase === "failed" ? "opacity-40" : "animate-pulse motion-reduce:animate-none",
              )}
            />
          ))}
        </span>
      )}
      <span className={tile}>
        <ProviderIcon provider={props.harness} className="size-6" />
      </span>
    </div>
  );
}

export function HarnessSignInDialog(props: {
  harness: HarnessId;
  /** The account's name as the list shows it, e.g. "Cursor". */
  label: string;
  /** Null until the agent's sign-in command has started. */
  session: HarnessLoginResult | null;
  startError: string | null;
  statusAtOpen: HarnessAccount["status"] | undefined;
  status: HarnessAccount["status"] | undefined;
  checking: boolean;
  closing: boolean;
  isDefault: boolean;
  /** Set when DJL installs the agent's CLI first; the sign-in steps wait until it is done. */
  install?: { state: "running" | "failed" | "done"; error: string | null };
  onCheck: () => void;
  /** Starts the install again when it failed, otherwise the sign-in. */
  onRetry: () => void;
  onClose: () => void;
  onUseForNewChats: () => void;
}) {
  const { t } = useTranslation(["settings", "common"]);
  const { harness, label: provider, session, onCheck } = props;
  const guide = signInGuide(harness);
  const [exitCode, setExitCode] = useState<number | null | undefined>(undefined);
  const [url, setUrl] = useState<string | null>(null);
  const [windowOpen, setWindowOpen] = useState(guide !== "browser");
  const [stalled, setStalled] = useState(false);
  const [copied, setCopied] = useState(false);
  const [browserError, setBrowserError] = useState(false);

  const install = props.install;
  const installPending = install !== undefined && install.state !== "done";
  const installFailed = install?.state === "failed";
  const signInPhase = deriveSignInPhase({
    started: session !== null,
    startFailed: props.startError !== null,
    statusAtOpen: props.statusAtOpen,
    status: props.status,
    exitCode,
    checking: props.checking,
  });
  const phase: SignInPhase = installFailed ? "failed" : installPending ? "starting" : signInPhase;
  const waiting = phase === "waiting";
  const needsAnswer = waiting && stalled && !url;

  // Read what the command prints (for its sign-in link) and notice when it ends.
  useEffect(() => {
    if (!session) return;
    let output = "";
    return ensureNativeApi().terminal.onEvent((event) => {
      if (event.threadId !== session.threadId || event.terminalId !== session.terminalId) return;
      if (event.type === "output") {
        output = (output + event.data).slice(-32_768);
        const found = harnessSignInUrl(session.harness, output);
        if (found) setUrl(found);
      } else if (event.type === "exited") {
        setExitCode(event.exitCode);
        onCheck();
      }
    });
  }, [session, onCheck]);

  // Coming back from the browser is the moment the account most likely changed.
  useEffect(() => {
    if (!waiting) return;
    window.addEventListener("focus", onCheck);
    return () => window.removeEventListener("focus", onCheck);
  }, [waiting, onCheck]);

  useEffect(() => {
    if (!waiting || guide !== "browser" || url) return;
    const timer = window.setTimeout(() => {
      setStalled(true);
      setWindowOpen(true);
    }, NO_LINK_REVEAL_MS);
    return () => window.clearTimeout(timer);
  }, [waiting, guide, url]);

  useEffect(() => {
    if (phase === "failed") setWindowOpen(true);
  }, [phase]);

  const startedInWindow = guide !== "browser" && !url;
  const installStep: StepState | null = !install
    ? null
    : install.state === "running"
      ? "loading"
      : install.state === "failed"
        ? "error"
        : "done";
  const steps: [StepState, StepState, StepState] = installPending
    ? ["pending", "pending", "pending"]
    : phase === "connected"
      ? ["done", "done", "success"]
      : phase === "starting"
        ? ["loading", "pending", "pending"]
        : phase === "failed"
          ? session && !startedInWindow
            ? ["done", "error", "pending"]
            : ["error", "pending", "pending"]
          : startedInWindow
            ? ["active", "pending", "pending"]
            : ["done", "loading", "pending"];

  // The sign-in steps follow the install step when DJL installs the CLI first.
  const firstSignInStep = installStep ? 2 : 1;

  const title = installFailed
    ? t("accounts.guideInstallFailedTitle")
    : phase === "connected"
      ? t("accounts.guideConnectedTitle", { provider })
      : phase === "failed"
        ? t("accounts.guideFailedTitle")
        : t("accounts.loginFor", { provider });
  const description = installFailed
    ? (install.error ?? t("accounts.installNotDetected", { provider }))
    : installPending
      ? t("accounts.guideInstalling", { provider })
      : phase === "connected"
        ? t("accounts.guideConnectedDescription")
        : phase === "failed"
          ? (props.startError ?? t("accounts.guideFailedDescription", { provider }))
          : t("accounts.guideDescription", { provider });

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !props.closing) props.onClose();
      }}
    >
      <DialogPopup className="max-w-lg" bottomStickOnMobile={false}>
        <DialogHeader className="gap-4 pt-5">
          <ConnectionMark harness={harness} phase={phase} />
          <div className="space-y-1.5">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription role={phase === "failed" ? "alert" : "status"}>
              {description}
            </DialogDescription>
          </div>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          <Stepper className="mt-4" aria-label={t("accounts.loginFor", { provider })}>
            {installStep ? (
              <StepperItem step={1} state={installStep}>
                <StepperTitle>{t("accounts.guideStepInstall", { provider })}</StepperTitle>
                {installStep === "loading" ? (
                  <StepperDescription>{t("accounts.guideStepInstallHint")}</StepperDescription>
                ) : null}
              </StepperItem>
            ) : null}
            <StepperItem step={firstSignInStep} state={steps[0]}>
              <StepperTitle>
                {t(guide === "browser" ? "accounts.guideStepOpen" : "accounts.guideStepStart")}
              </StepperTitle>
              {steps[0] === "loading" ? (
                <StepperDescription>
                  {t("accounts.guideStepOpenStarting", { provider })}
                </StepperDescription>
              ) : steps[0] === "active" ? (
                <StepperDescription>
                  {t(
                    guide === "slashLogin"
                      ? "accounts.guideStepStartSlash"
                      : "accounts.guideStepStartPick",
                  )}
                </StepperDescription>
              ) : null}
            </StepperItem>
            <StepperItem step={firstSignInStep + 1} state={steps[1]}>
              <StepperTitle>{t("accounts.guideStepApprove")}</StepperTitle>
              {steps[1] === "loading" ? (
                <>
                  <StepperDescription>
                    {t(
                      needsAnswer ? "accounts.guideNeedsAnswer" : "accounts.guideStepApproveHint",
                      {
                        provider,
                      },
                    )}
                  </StepperDescription>
                  {url ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        onClick={() => {
                          setBrowserError(false);
                          void ensureNativeApi()
                            .shell.openExternal(url)
                            .catch(() => setBrowserError(true));
                        }}
                      >
                        <ExternalLinkIcon />
                        {t("accounts.guideOpenPage")}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          void navigator.clipboard.writeText(url).then(() => setCopied(true));
                        }}
                      >
                        {copied ? <CheckIcon /> : <CopyIcon />}
                        {t(copied ? "accounts.guideLinkCopied" : "accounts.guideCopyLink")}
                      </Button>
                    </div>
                  ) : null}
                  {browserError ? (
                    <p role="alert" className="mt-2 text-sm text-destructive">
                      {t("accounts.guideBrowserError")}
                    </p>
                  ) : null}
                </>
              ) : null}
            </StepperItem>
            <StepperItem step={firstSignInStep + 2} state={steps[2]}>
              <StepperTitle>{t("accounts.guideStepConnected")}</StepperTitle>
              {steps[2] === "success" ? (
                <StepperDescription>
                  {t("accounts.guideStepConnectedHint", { provider })}
                </StepperDescription>
              ) : null}
            </StepperItem>
          </Stepper>
          {session && phase !== "connected" ? (
            <div className="border-t border-border pt-2">
              <button
                type="button"
                aria-expanded={windowOpen}
                className="-mx-1.5 flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                onClick={() => setWindowOpen((open) => !open)}
              >
                <DisclosureChevron open={windowOpen} className="size-3.5" />
                {t(windowOpen ? "accounts.guideHideWindow" : "accounts.guideShowWindow")}
              </button>
              <DisclosureRegion open={windowOpen} contentClassName="pt-2">
                <SignInTerminal session={session} focused={guide !== "browser"} />
              </DisclosureRegion>
            </div>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          {phase === "connected" ? (
            <>
              {props.isDefault ? null : (
                <Button variant="outline" disabled={props.closing} onClick={props.onUseForNewChats}>
                  {t("accounts.useForNewChats")}
                </Button>
              )}
              <Button disabled={props.closing} onClick={props.onClose}>
                {t("accounts.guideDone")}
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" disabled={props.closing} onClick={props.onClose}>
                {t("common:actions.cancel")}
              </Button>
              {phase === "failed" ? (
                <Button disabled={props.closing} onClick={props.onRetry}>
                  {t("accounts.guideRetry")}
                </Button>
              ) : (
                <Button
                  variant="outline"
                  disabled={!session || props.checking || props.closing}
                  onClick={onCheck}
                >
                  {t(props.checking ? "accounts.checking" : "accounts.guideCheck")}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
