// FILE: cliAccountsQuery.ts
// Purpose: Shared react-query keys for extra Claude / Codex subscription accounts, so the
//          Settings → AI accounts page and the sidebar usage ring read one cache.

export const CLI_ACCOUNTS_QUERY_KEY = ["cli-accounts"] as const;
export const CLI_ACCOUNTS_USAGE_QUERY_KEY = ["cli-accounts", "usage"] as const;
