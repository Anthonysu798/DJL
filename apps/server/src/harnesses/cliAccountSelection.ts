// FILE: cliAccountSelection.ts
// Purpose: Which Claude Code / Codex login new chats use. An extra subscription account runs the
//          CLI with its own config folder (CLAUDE_CONFIG_DIR / CODEX_HOME); `default` (or no
//          choice) keeps the CLI's normal login.

import {
  DEFAULT_CLI_ACCOUNT_ID,
  type CliAccountProvider,
  type ServerSettings,
} from "@djl/contracts";

/** The active extra account's CLI folder, or undefined for the CLI's normal login. */
export function activeCliAccountDir(
  settings: Pick<ServerSettings, "cliAccounts">,
  provider: CliAccountProvider,
): string | undefined {
  const id = settings.cliAccounts.active[provider];
  if (!id || id === DEFAULT_CLI_ACCOUNT_ID) return undefined;
  const dir = settings.cliAccounts.accounts
    .find((account) => account.id === id && account.provider === provider)
    ?.dir.trim();
  return dir || undefined;
}

/** The same settings with the CLI's normal login selected, for probing that login itself. */
export function withNormalCliLogin(settings: ServerSettings): ServerSettings {
  return { ...settings, cliAccounts: { ...settings.cliAccounts, active: {} } };
}

/**
 * The folder for the account a chat asked for: `default` is the normal login (undefined dir),
 * an extra account its own folder. Null when the id is unknown (removed account), so the
 * caller keeps the app-wide choice.
 */
export function chatCliAccountDir(
  settings: Pick<ServerSettings, "cliAccounts">,
  provider: CliAccountProvider,
  id: string,
): { dir: string | undefined } | null {
  if (id === DEFAULT_CLI_ACCOUNT_ID) return { dir: undefined };
  const dir = settings.cliAccounts.accounts
    .find((account) => account.id === id && account.provider === provider)
    ?.dir.trim();
  return dir ? { dir } : null;
}
