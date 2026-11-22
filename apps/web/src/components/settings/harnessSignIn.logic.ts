// FILE: harnessSignIn.logic.ts
// Purpose: What the guided sign-in dialog shows, worked out from what the agent's own
//          sign-in command printed, whether it has finished, and the account check.

import type { HarnessAccount, HarnessId } from "@djl/contracts";

import { providerSignInUrl } from "../agent-workspaces/profileLoginSession";

type AccountStatus = HarnessAccount["status"];

/**
 * How an agent signs in. "browser" agents open the browser themselves and need nothing
 * typed; the others start inside their own terminal screen, so that screen is shown.
 */
export type SignInGuide = "browser" | "pick" | "slashLogin";

const SIGN_IN_GUIDE: Record<HarnessId, SignInGuide> = {
  codex: "browser",
  claudeAgent: "browser",
  cursor: "browser",
  grok: "browser",
  kimi: "browser",
  gemini: "pick",
  iflow: "pick",
  qwen: "pick",
  opencode: "pick",
  codebuddy: "slashLogin",
  pi: "slashLogin",
};

export function signInGuide(harness: HarnessId): SignInGuide {
  return SIGN_IN_GUIDE[harness];
}

const ESCAPE_SEQUENCE = new RegExp(String.fromCharCode(27) + "\\[[0-?]*[ -/]*[@-~]", "g");

/**
 * The sign-in page the agent printed, when it printed one. Agents with a known sign-in host
 * are held to it; for the rest only an https link that reads as a sign-in page counts.
 */
export function harnessSignInUrl(harness: HarnessId, output: string): string | null {
  if (
    harness === "codex" ||
    harness === "claudeAgent" ||
    harness === "cursor" ||
    harness === "opencode"
  ) {
    return providerSignInUrl(harness, output);
  }
  for (const candidate of output.replace(ESCAPE_SEQUENCE, "").match(/https:\/\/[^\s<>]+(?=\s)/g) ??
    []) {
    try {
      const url = new URL(candidate);
      if (
        !url.username &&
        !url.password &&
        /auth|login|signin|device|authorize/i.test(url.pathname + url.search)
      ) {
        return url.href;
      }
    } catch {
      /* Ignore incomplete chunks. */
    }
  }
  return null;
}

export type SignInPhase = "starting" | "waiting" | "connected" | "failed";

export function deriveSignInPhase(input: {
  started: boolean;
  startFailed: boolean;
  /** The account's status when the dialog opened. */
  statusAtOpen: AccountStatus | undefined;
  status: AccountStatus | undefined;
  /** undefined while the sign-in command runs; null when it was killed by a signal. */
  exitCode: number | null | undefined;
  /** True while the account check that follows an exit is still running. */
  checking: boolean;
}): SignInPhase {
  if (input.startFailed) return "failed";
  if (!input.started) return "starting";
  const finishedCleanly = input.exitCode === 0;
  // An account that was already connected only counts again once its sign-in command
  // finishes cleanly: its status alone says nothing about this attempt.
  if (input.status === "ready" && (input.statusAtOpen !== "ready" || finishedCleanly)) {
    return "connected";
  }
  if (input.exitCode === undefined || input.checking) return "waiting";
  // The agent's own command reported success and DJL's check could not tell either way.
  if (finishedCleanly && input.status === "unknown") return "connected";
  return "failed";
}
