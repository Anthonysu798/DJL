// FILE: claudeCredentialKeepalive.ts
// Purpose: Keep every Claude login DJL knows (the main one and each extra AI account) signed in,
//   the way a single terminal stays signed in.
// Layer: server background job (best-effort, never throws).
//
// Why this exists
// ---------------
// Claude's access token lasts hours; its single-use refresh token renews it and is replaced on
// every renewal, and an unused refresh token eventually passes its own expiry. A login that no
// chat touches for weeks (a second or sixth account) therefore expires, and a renewal that is
// cut short loses the new refresh token, after which Claude wipes the login.
//
// So this job is the only DJL code that asks Claude to renew a login: it reads each login's
// store (claudeLogin.ts, no Claude process), and only when a login's access token is about to
// run out does it run the official `claude auth status`, which renews it and saves the result.
// One renewal at a time, under the shared lock, with a timeout long enough that it is never
// killed halfway. Claude Code's own refresh lock keeps it from racing chats and terminals.
//
// On by default. Opt out: DJL_CLAUDE_KEEPALIVE=0
// Tune:                   DJL_CLAUDE_KEEPALIVE_MINUTES=<n>   (default 15)

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { readClaudeLogin } from "../harnesses/claudeLogin";
import { resolveClaudeExecutable } from "../harnesses/native/claudeExecutable";
import { acquireClaudeAuthStatusLock } from "./claudeAuthStatusLock";
import { buildClaudeProcessEnv } from "./claudeProcessEnv";

const execFileAsync = promisify(execFile);

const DEFAULT_INTERVAL_MINUTES = 15;
// A renewal is a network round trip; cutting it short is what loses a refresh token.
const COMMAND_TIMEOUT_MS = 120_000;
// Renew once the access token has this little left (a check runs every interval).
const RENEW_AHEAD_MS = 20 * 60 * 1000;
export const CLAUDE_CREDENTIAL_KEEPALIVE_MAX_INTERVAL_MS = 2_147_483_647;
export const CLAUDE_CREDENTIAL_KEEPALIVE_AUTH_STATUS_ARGS = ["auth", "status"] as const;

export function isClaudeCredentialKeepaliveEnabled(
  input: { readonly env?: NodeJS.ProcessEnv } = {},
) {
  const value = (input.env ?? process.env).DJL_CLAUDE_KEEPALIVE?.trim().toLowerCase();
  return !(value === "0" || value === "false" || value === "off" || value === "no");
}

// Mirrors the Claude Agent adapter default while honoring persisted custom CLI paths.
export function resolveClaudeCredentialKeepaliveBinaryPath(binaryPath: string | undefined): string {
  return binaryPath?.trim() || "claude";
}

// Caps the tuning knob before setInterval can overflow into Node's 1ms clamp behavior.
export function resolveClaudeCredentialKeepaliveIntervalMs(env: NodeJS.ProcessEnv): number {
  const raw = env.DJL_CLAUDE_KEEPALIVE_MINUTES?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  const minutes = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_INTERVAL_MINUTES;
  return Math.min(minutes * 60 * 1000, CLAUDE_CREDENTIAL_KEEPALIVE_MAX_INTERVAL_MS);
}

/**
 * Renews, one at a time, the signed-in logins whose access token is about to run out.
 * `configDirs` lists each login's CLAUDE_CONFIG_DIR; undefined is the main login.
 * Returns the folders it renewed.
 */
export async function renewDueClaudeLogins(input: {
  readonly configDirs: ReadonlyArray<string | undefined>;
  readonly homeDir?: string;
  readonly nowMs?: number;
  readonly readLogin?: typeof readClaudeLogin;
  readonly renew: (configDir: string | undefined) => Promise<void>;
}): Promise<Array<string | undefined>> {
  const readLogin = input.readLogin ?? readClaudeLogin;
  const renewed: Array<string | undefined> = [];
  for (const configDir of new Set(input.configDirs)) {
    const login = await readLogin({
      configDir,
      ...(input.homeDir ? { homeDir: input.homeDir } : {}),
    });
    const due =
      login.signedIn &&
      login.accessExpiresAtMs !== null &&
      login.accessExpiresAtMs - (input.nowMs ?? Date.now()) <= RENEW_AHEAD_MS;
    if (!due) continue;
    await input.renew(configDir);
    renewed.push(configDir);
  }
  return renewed;
}

// `claude auth status` renews a due access token with the refresh token and writes the new
// pair back to the login's store. Held under the shared lock so no other DJL caller runs it
// at the same time.
async function renewClaudeLogin(
  binaryPath: string,
  homeDir: string | undefined,
  configDir: string | undefined,
): Promise<void> {
  const env = buildClaudeProcessEnv(homeDir ? { homeDir } : undefined);
  if (configDir) env.CLAUDE_CONFIG_DIR = configDir;
  const binary = await resolveClaudeExecutable(binaryPath, env);
  const release = await acquireClaudeAuthStatusLock();
  try {
    await execFileAsync(binary, [...CLAUDE_CREDENTIAL_KEEPALIVE_AUTH_STATUS_ARGS], {
      timeout: COMMAND_TIMEOUT_MS,
      env,
    });
  } finally {
    release();
  }
}

export interface ClaudeCredentialKeepaliveHandle {
  readonly stop: () => void;
}

export function startClaudeCredentialKeepalive(input: {
  /** Every login to keep: undefined is the main login, a string an extra account's folder. */
  readonly listConfigDirs: () => Promise<ReadonlyArray<string | undefined>>;
  readonly env?: NodeJS.ProcessEnv;
  readonly binaryPath?: string;
  readonly homeDir?: string;
  readonly log?: (message: string) => void;
}): ClaudeCredentialKeepaliveHandle {
  const env = input.env ?? process.env;
  const binaryPath = resolveClaudeCredentialKeepaliveBinaryPath(input.binaryPath);
  const homeDir = input.homeDir;
  const log = input.log ?? (() => {});

  if (!isClaudeCredentialKeepaliveEnabled({ env })) {
    return { stop: () => {} };
  }

  const intervalMs = resolveClaudeCredentialKeepaliveIntervalMs(env);
  let inFlight = false;

  const tick = async (): Promise<void> => {
    if (inFlight) {
      return;
    }
    inFlight = true;
    try {
      await renewDueClaudeLogins({
        configDirs: await input.listConfigDirs(),
        ...(homeDir ? { homeDir } : {}),
        renew: async (configDir) => {
          try {
            await renewClaudeLogin(binaryPath, homeDir, configDir);
          } catch (cause) {
            // Best-effort: a missing binary or a transient failure retries on the next tick.
            log(
              `[claude-keepalive] renewal failed (non-fatal): ${
                cause instanceof Error ? cause.message : String(cause)
              }`,
            );
          }
        },
      });
    } catch (cause) {
      log(
        `[claude-keepalive] check failed (non-fatal): ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      );
    } finally {
      inFlight = false;
    }
  };

  const timer = setInterval(() => void tick(), intervalMs);
  // Never keep the process alive solely for this background timer.
  if (typeof timer.unref === "function") {
    timer.unref();
  }
  // Check once at startup so a login that ran out while DJL was closed renews promptly.
  void tick();
  log(`[claude-keepalive] started (checks every ${intervalMs / 60_000}m)`);
  return {
    stop: () => clearInterval(timer),
  };
}
