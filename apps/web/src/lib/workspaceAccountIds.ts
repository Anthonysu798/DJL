// FILE: workspaceAccountIds.ts
// Purpose: Ids for the accounts a workspace terminal can use. Besides workspace-only profiles
//          (random UUIDs), terminals can use the app's own Claude Code / Codex accounts from
//          Settings → AI accounts, so nobody has to sign in twice:
//          - `default-<provider>`: the CLI's normal sign-in (what chats use by default);
//          - `codex-…` / `claude-…`: an extra Settings account, whose folder workspace profiles share.
// Layer: Web lib (no React). Used by the workspace store, sessions and view.

import { DEFAULT_CLI_ACCOUNT_ID, type CliAccountProvider } from "@djl/contracts";

export const APP_ACCOUNT_PROVIDERS = [
  "codex",
  "claudeAgent",
] as const satisfies readonly CliAccountProvider[];

export function defaultAppAccountId(provider: CliAccountProvider): string {
  return `default-${provider}`;
}

/** The provider of an app account id, or null for a workspace-only profile id. */
export function appAccountProvider(id: string): CliAccountProvider | null {
  if (id === defaultAppAccountId("codex") || id.startsWith("codex-")) return "codex";
  if (id === defaultAppAccountId("claudeAgent") || id.startsWith("claude-")) return "claudeAgent";
  return null;
}

/** The id the server uses for the account's folder: `default` means the normal sign-in. */
export function terminalProfileId(id: string): string {
  return id.startsWith("default-") ? DEFAULT_CLI_ACCOUNT_ID : id;
}

/**
 * The account a pane uses: a workspace profile, or an app account resolved from its id alone
 * (so terminals relaunch correctly before the Settings account list has loaded).
 */
export function resolveWorkspaceProfile<T extends { id: string; provider: string; name: string }>(
  id: string | null,
  profiles: readonly T[],
): T | { id: string; provider: CliAccountProvider; name: string } | undefined {
  if (!id) return undefined;
  const found = profiles.find((profile) => profile.id === id);
  if (found) return found;
  const provider = appAccountProvider(id);
  return provider ? { id, provider, name: "" } : undefined;
}
