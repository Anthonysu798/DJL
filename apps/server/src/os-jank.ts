// FILE: os-jank.ts
// Purpose: Smooths over shell/path differences between packaged app launches and login shells.
// Exports: PATH hydration plus base-dir helpers used by server startup.

import { existsSync } from "node:fs";
import * as OS from "node:os";
import nodePath from "node:path";
import { Effect, Path } from "effect";
import {
  listLoginShellCandidates,
  mergePathEntries,
  readPathFromLaunchctl,
  readPathFromLoginShell,
} from "@djl/shared/shell";
import { DJL_HOME_DIR_NAME } from "@djl/shared/djlStoragePaths";

function logPathHydrationWarning(message: string, error?: unknown): void {
  console.warn(`[server] ${message}`, error instanceof Error ? error.message : (error ?? ""));
}

export function fixPath(
  options: {
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
    readPath?: typeof readPathFromLoginShell;
    readLaunchctlPath?: typeof readPathFromLaunchctl;
    userShell?: string;
    logWarning?: (message: string, error?: unknown) => void;
  } = {},
): void {
  const platform = options.platform ?? process.platform;
  if (platform !== "darwin" && platform !== "linux") return;

  const env = options.env ?? process.env;
  // The desktop app already merged the login-shell environment before spawning
  // this process; probing the shell again only delays the HTTP listener.
  if (env.DJL_SHELL_ENV_SYNCED === "1") return;
  const logWarning = options.logWarning ?? logPathHydrationWarning;
  const readPath = options.readPath ?? readPathFromLoginShell;

  try {
    let shellPath: string | undefined;
    for (const shell of listLoginShellCandidates(platform, env.SHELL, options.userShell)) {
      try {
        shellPath = readPath(shell);
      } catch (error) {
        logWarning(`Failed to read PATH from login shell ${shell}.`, error);
      }

      if (shellPath) {
        break;
      }
    }

    const launchctlPath =
      platform === "darwin" && !shellPath
        ? (options.readLaunchctlPath ?? readPathFromLaunchctl)()
        : undefined;
    const mergedPath = mergePathEntries(shellPath ?? launchctlPath, env.PATH, platform);
    if (mergedPath) {
      env.PATH = mergedPath;
    }
  } catch (error) {
    logWarning("Failed to hydrate PATH from the user environment.", error);
  }
}

// Where the AI CLIs DJL drives install themselves (Claude Code's native installer, npm -g
// prefixes, Homebrew, Bun, Volta). Appended after the user's own PATH, so their order still
// wins, but a slow or failing login-shell capture can no longer hide an installed CLI.
const KNOWN_CLI_DIRS = [
  "~/.local/bin",
  "~/.npm-global/bin",
  "~/.bun/bin",
  "~/.volta/bin",
  "~/.cargo/bin",
  "/opt/homebrew/bin",
  "/usr/local/bin",
] as const;

export function appendKnownCliDirs(
  options: {
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
    homeDir?: string;
    exists?: (path: string) => boolean;
  } = {},
): void {
  const platform = options.platform ?? process.platform;
  if (platform !== "darwin" && platform !== "linux") return;
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? OS.homedir();
  const exists = options.exists ?? existsSync;
  const dirs = KNOWN_CLI_DIRS.map((dir) =>
    dir.startsWith("~/") ? nodePath.join(homeDir, dir.slice(2)) : dir,
  ).filter((dir) => exists(dir));
  const merged = mergePathEntries(env.PATH, dirs.join(":"), platform);
  if (merged) {
    env.PATH = merged;
  }
}

export const expandHomePath = Effect.fn(function* (input: string) {
  const { join } = yield* Path.Path;
  if (input === "~") {
    return OS.homedir();
  }
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return join(OS.homedir(), input.slice(2));
  }
  return input;
});

export const resolveBaseDir = Effect.fn(function* (raw: string | undefined) {
  const { join, resolve } = yield* Path.Path;
  if (!raw || raw.trim().length === 0) {
    return join(OS.homedir(), DJL_HOME_DIR_NAME);
  }
  return resolve(yield* expandHomePath(raw.trim()));
});
