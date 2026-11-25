// FILE: providerUsage/types.ts
// Purpose: Shared contract for the server-side live provider-usage fetchers. Each provider
// implements ProviderUsageFetcher; the registry maps ProviderKind -> fetcher. Fetchers must
// never throw — they resolve to a snapshot whose `status` describes the outcome. Fetchers
// never redeem a CLI's refresh token themselves (they rotate, so doing so signs the CLI out);
// they ask the CLI to refresh its own credentials through `refreshCliCredentials` instead.

import type { ProviderKind, ServerProviderUsageSnapshot } from "@djl/contracts";

export interface ProviderUsageContext {
  /** Resolved user home directory (ServerConfig.homeDir). */
  readonly homeDir: string;
  /** Process environment (lets fetchers honor CODEX_HOME, CLAUDE_CONFIG_DIR, etc.). */
  readonly env: NodeJS.ProcessEnv;
  /** Host platform; keychain reads only run on darwin. */
  readonly platform: NodeJS.Platform;
  /** Reference "now" in epoch ms, used for token-expiry checks (kept injectable for tests). */
  readonly nowMs: number;
  /**
   * Runs the provider's own CLI so it refreshes and persists its credentials. Resolves true
   * when the CLI ran, so the fetcher should read the credential stores again.
   */
  readonly refreshCliCredentials?: (provider: ProviderKind) => Promise<boolean>;
  /**
   * An extra subscription account's CLI folder (CLAUDE_CONFIG_DIR / CODEX_HOME). When set,
   * fetchers read only that account's own login and never fall back to the normal one.
   */
  readonly accountDir?: string;
}

export interface ProviderUsageFetcher {
  readonly provider: ProviderKind;
  /** Resolve credentials and fetch live usage. Never throws. */
  fetch(ctx: ProviderUsageContext): Promise<ServerProviderUsageSnapshot>;
}
