import { Schema } from "effect";
import { TrimmedNonEmptyString } from "./baseSchemas";

export const HarnessId = Schema.Literals([
  "codex",
  "claudeAgent",
  "cursor",
  "opencode",
  "grok",
  "kimi",
  "iflow",
  "qwen",
  "codebuddy",
  "pi",
]);
export type HarnessId = typeof HarnessId.Type;

export const HarnessAccount = Schema.Struct({
  id: HarnessId,
  installed: Schema.Boolean,
  enabled: Schema.Boolean,
  status: Schema.Literals(["ready", "required", "unknown", "missing", "disabled", "incompatible"]),
  version: Schema.optional(Schema.String),
});
export type HarnessAccount = typeof HarnessAccount.Type;
export const HarnessAccountsResult = Schema.Struct({ accounts: Schema.Array(HarnessAccount) });
export type HarnessAccountsResult = typeof HarnessAccountsResult.Type;
export const HarnessLoginInput = Schema.Struct({
  harness: HarnessId,
  modelProviderId: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(128))),
});
export type HarnessLoginInput = typeof HarnessLoginInput.Type;
export const HarnessLoginResult = Schema.Struct({
  harness: HarnessId,
  threadId: TrimmedNonEmptyString,
  terminalId: TrimmedNonEmptyString,
  cwd: TrimmedNonEmptyString,
});
export type HarnessLoginResult = typeof HarnessLoginResult.Type;
export const HarnessEndLoginInput = Schema.Struct({ harness: HarnessId });
export type HarnessEndLoginInput = typeof HarnessEndLoginInput.Type;

// Standalone installed CLI tools.
export const HarnessToolId = Schema.Literals([
  "codex",
  "claudeAgent",
  "opencode",
  "grok",
  "kimi",
  "iflow",
  "qwen",
  "codebuddy",
  "pi",
  "cursor",
]);
export type HarnessToolId = typeof HarnessToolId.Type;
export const HarnessTool = Schema.Struct({
  id: HarnessToolId,
  installed: Schema.Boolean,
  compatible: Schema.optional(Schema.Boolean),
  compatibilityMessage: Schema.optional(Schema.String),
  currentVersion: Schema.NullOr(Schema.String),
  latestVersion: Schema.NullOr(Schema.String),
  status: Schema.Literals(["current", "behind_latest", "unknown"]),
  canInstall: Schema.Boolean,
  canUpdate: Schema.Boolean,
  maintenanceStatus: Schema.optional(Schema.Literals(["running", "succeeded", "failed"])),
});
export type HarnessTool = typeof HarnessTool.Type;
export const HarnessToolsResult = Schema.Struct({ tools: Schema.Array(HarnessTool) });
export type HarnessToolsResult = typeof HarnessToolsResult.Type;
export const HarnessMaintainToolInput = Schema.Struct({ harness: HarnessToolId });
export type HarnessMaintainToolInput = typeof HarnessMaintainToolInput.Type;

export const HarnessProfileAccountInput = Schema.Struct({
  // Only runtimes with isolated workspace credential profiles belong here.
  provider: Schema.Literals(["codex", "claudeAgent", "cursor", "opencode"]),
  profileId: Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9_-]{1,80}$/)),
});
export type HarnessProfileAccountInput = typeof HarnessProfileAccountInput.Type;
export const HarnessProfileAccount = Schema.Struct({
  ...HarnessProfileAccountInput.fields,
  status: Schema.Literals(["signedIn", "signedOut", "unavailable", "unknown"]),
  email: Schema.NullOr(Schema.String),
});
export type HarnessProfileAccount = typeof HarnessProfileAccount.Type;

export const HarnessLegacyOpenCodeCredentialsResult = Schema.Struct({
  availableProviderIds: Schema.Array(Schema.String),
  existingProviderIds: Schema.Array(Schema.String),
  transferredProviderIds: Schema.Array(Schema.String),
});
export type HarnessLegacyOpenCodeCredentialsResult =
  typeof HarnessLegacyOpenCodeCredentialsResult.Type;
