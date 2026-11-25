// FILE: devFakeUsageLimit.ts
// Purpose: Development aid. DJL_DEV_FAKE_USAGE_LIMIT="default,codex-89d2…" makes Claude / Codex
//          turns on those accounts fail as if the account hit its usage limit, so account
//          switching can be tried end to end without burning a real subscription limit.
// Layer: Native harness helper, used by the native adapter before a turn reaches the driver.

import { basename, sep } from "node:path";
import type { ProviderStartOptions } from "@djl/contracts";

import { profileAccountDir } from "./profile";
import type { NativeProvider } from "./types";

const ADDED_ACCOUNTS_FOLDER = `${sep}terminal-accounts${sep}`;

/** The simulated limit error for this turn's account, or null when the account is not named. */
export function fakeUsageLimitError(
  provider: NativeProvider,
  options: ProviderStartOptions,
  setting: string | undefined = process.env.DJL_DEV_FAKE_USAGE_LIMIT,
): string | null {
  const names = (setting ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  if (names.length === 0) return null;
  const dir = profileAccountDir(provider, options);
  // Added accounts live in `terminal-accounts/<provider>/<id>`; anything else is the normal sign-in.
  const accountId = dir?.includes(ADDED_ACCOUNTS_FOLDER) ? basename(dir) : "default";
  return names.includes(accountId)
    ? `You've hit your usage limit (simulated by DJL_DEV_FAKE_USAGE_LIMIT for "${accountId}").`
    : null;
}
