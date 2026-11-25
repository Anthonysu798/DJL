// FILE: cliAccounts.ts
// Purpose: RPC shapes for extra Claude Code / Codex subscription accounts (Settings → AI accounts):
//          list them with their sign-in state, add, remove, choose the one new chats use, and
//          read each account's live usage.

import { Schema } from "effect";
import { TrimmedNonEmptyString } from "./baseSchemas";
import { ServerProviderUsageSnapshot } from "./server";
import { CliAccountId, CliAccountProvider } from "./settings";

/** The CLI's normal login. Generated account ids never take this value. */
export const DEFAULT_CLI_ACCOUNT_ID = "default";

export const CliAccountStatus = Schema.Literals([
  "signedIn",
  "signedOut",
  "unavailable",
  "unknown",
]);
export type CliAccountStatus = typeof CliAccountStatus.Type;

export const CliAccountSummary = Schema.Struct({
  id: CliAccountId,
  provider: CliAccountProvider,
  /** Empty for the normal login; the UI names it. */
  name: Schema.String,
  isDefault: Schema.Boolean,
  active: Schema.Boolean,
  status: CliAccountStatus,
  email: Schema.NullOr(Schema.String),
});
export type CliAccountSummary = typeof CliAccountSummary.Type;

export const CliAccountsListResult = Schema.Struct({ accounts: Schema.Array(CliAccountSummary) });
export type CliAccountsListResult = typeof CliAccountsListResult.Type;

export const CliAccountAddInput = Schema.Struct({
  provider: CliAccountProvider,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(80)),
});
export type CliAccountAddInput = typeof CliAccountAddInput.Type;

export const CliAccountRemoveInput = Schema.Struct({ id: CliAccountId });
export type CliAccountRemoveInput = typeof CliAccountRemoveInput.Type;

export const CliAccountSetActiveInput = Schema.Struct({
  provider: CliAccountProvider,
  id: CliAccountId,
});
export type CliAccountSetActiveInput = typeof CliAccountSetActiveInput.Type;

export const CliAccountsUsageInput = Schema.Struct({
  forceRefresh: Schema.optional(Schema.Boolean),
});
export type CliAccountsUsageInput = typeof CliAccountsUsageInput.Type;

export const CliAccountUsage = Schema.Struct({
  accountId: CliAccountId,
  provider: CliAccountProvider,
  snapshot: Schema.NullOr(ServerProviderUsageSnapshot),
});
export type CliAccountUsage = typeof CliAccountUsage.Type;

export const CliAccountsUsageResult = Schema.Struct({ usage: Schema.Array(CliAccountUsage) });
export type CliAccountsUsageResult = typeof CliAccountsUsageResult.Type;
