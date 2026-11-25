// FILE: providerUsage/cliRefresh.ts
// Purpose: Let a provider's own CLI refresh and persist its OAuth credentials before a usage
// fetch re-reads them. The CLIs rotate single-use refresh tokens, so DJL must never redeem
// them itself: doing so leaves the CLI holding a dead token and signs the user out of it.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { ProviderKind } from "@djl/contracts";

import { resolveClaudeExecutable } from "../harnesses/native/claudeExecutable";
import { acquireClaudeAuthStatusLock } from "../provider/claudeAuthStatusLock";
import { buildClaudeProcessEnv } from "../provider/claudeProcessEnv";

const execFileAsync = promisify(execFile);

const COMMAND_TIMEOUT_MS = 20_000;
// Usage polls every minute while a turn runs; one CLI refresh per window is plenty.
const MIN_INTERVAL_MS = 5 * 60 * 1000;

const lastAttemptAtMs = new Map<string, number>();

async function refreshClaudeCli(homeDir: string, configDir?: string): Promise<void> {
  const env = buildClaudeProcessEnv(homeDir ? { homeDir } : undefined);
  // An extra account refreshes the login stored for its own config folder.
  if (configDir) env.CLAUDE_CONFIG_DIR = configDir;
  const binary = await resolveClaudeExecutable("claude", env);
  // `claude auth status` refreshes a near-expiry token and writes it back to the Keychain.
  // It shares the process-wide lock with every other `claude auth status` caller.
  const release = await acquireClaudeAuthStatusLock();
  try {
    await execFileAsync(binary, ["auth", "status"], { timeout: COMMAND_TIMEOUT_MS, env });
  } finally {
    release();
  }
}

export function makeCliCredentialRefresher(input: {
  readonly homeDir: string;
  /** CLAUDE_CONFIG_DIR of an extra subscription account. */
  readonly claudeConfigDir?: string;
  readonly now?: () => number;
}): (provider: ProviderKind) => Promise<boolean> {
  const now = input.now ?? Date.now;
  return async (provider) => {
    if (provider !== "claudeAgent") {
      return false;
    }
    const key = `${provider}:${input.claudeConfigDir ?? ""}`;
    const last = lastAttemptAtMs.get(key);
    if (last !== undefined && now() - last < MIN_INTERVAL_MS) {
      return false;
    }
    lastAttemptAtMs.set(key, now());
    try {
      await refreshClaudeCli(input.homeDir, input.claudeConfigDir);
      return true;
    } catch {
      // Missing binary, a real sign-out or a timeout: report usage as unavailable.
      return false;
    }
  };
}

/** Test-only: forget throttling state. */
export function __resetCliCredentialRefresher(): void {
  lastAttemptAtMs.clear();
}
