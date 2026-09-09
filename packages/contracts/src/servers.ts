// FILE: servers.ts
// Purpose: Schemas for the Servers registry (user SSH hosts) and its RPC surface.
// Layer: Contracts

import { Schema } from "effect";

import { PositiveInt, TrimmedNonEmptyString } from "./baseSchemas";

export const ServerId = TrimmedNonEmptyString.pipe(Schema.brand("ServerId"));
export type ServerId = typeof ServerId.Type;

export const SERVER_PERMISSION_TIERS = ["read-only", "approve-each", "full"] as const;
export const ServerPermissionTier = Schema.Literals(SERVER_PERMISSION_TIERS);
export type ServerPermissionTier = typeof ServerPermissionTier.Type;

export const ServerTag = Schema.String.check(Schema.isPattern(/^[\p{L}\p{N}_-]{1,32}$/u));
export type ServerTag = typeof ServerTag.Type;

const noLeadingDash = (max: number) =>
  TrimmedNonEmptyString.check(Schema.isMaxLength(max)).check(Schema.isPattern(/^[^\s-]/));

export const ServerName = TrimmedNonEmptyString.check(Schema.isMaxLength(64));
export const ServerHost = noLeadingDash(253).check(Schema.isPattern(/^[A-Za-z0-9._:[\]-]+$/));
export const ServerUsername = noLeadingDash(64).check(Schema.isPattern(/^[^\s@]+$/));
export const ServerPort = PositiveInt.check(Schema.isLessThanOrEqualTo(65535));

export const ServerAuthMethod = Schema.Union([
  Schema.Struct({ type: Schema.Literal("agent") }),
  Schema.Struct({
    type: Schema.Literal("keyPath"),
    path: TrimmedNonEmptyString.check(Schema.isMaxLength(1024)),
    hasPassphrase: Schema.Boolean,
  }),
  Schema.Struct({ type: Schema.Literal("importedKey"), hasPassphrase: Schema.Boolean }),
  Schema.Struct({ type: Schema.Literal("password") }),
]);
export type ServerAuthMethod = typeof ServerAuthMethod.Type;

export const SERVER_TEST_OUTCOMES = [
  "ok",
  "host-key-unknown",
  "host-key-changed",
  "auth-failed",
  "unreachable",
  "timeout",
  "askpass-unsupported",
  "error",
] as const;
export const ServerTestOutcome = Schema.Literals(SERVER_TEST_OUTCOMES);
export type ServerTestOutcome = typeof ServerTestOutcome.Type;

export const ServerHostKey = Schema.Struct({ type: Schema.String, fingerprint: Schema.String });
export type ServerHostKey = typeof ServerHostKey.Type;

export const ServerConnectionTest = Schema.Struct({
  at: Schema.Number,
  outcome: ServerTestOutcome,
  latencyMs: Schema.optional(Schema.Number),
  message: Schema.optional(Schema.String),
  hostKey: Schema.optional(ServerHostKey),
});
export type ServerConnectionTest = typeof ServerConnectionTest.Type;

export const ServerStats = Schema.Struct({
  collectedAt: Schema.Number,
  hostname: Schema.optional(Schema.String),
  os: Schema.optional(Schema.String),
  kernel: Schema.optional(Schema.String),
  uptimeSeconds: Schema.optional(Schema.Number),
  load: Schema.optional(
    Schema.Struct({ one: Schema.Number, five: Schema.Number, fifteen: Schema.Number }),
  ),
  memory: Schema.optional(Schema.Struct({ totalBytes: Schema.Number, usedBytes: Schema.Number })),
  disk: Schema.optional(
    Schema.Struct({
      totalBytes: Schema.Number,
      usedBytes: Schema.Number,
      mountPoint: Schema.String,
    }),
  ),
});
export type ServerStats = typeof ServerStats.Type;

export const ServerSource = Schema.Literals(["manual", "ssh-config"]);
export type ServerSource = typeof ServerSource.Type;

export const ServerRecord = Schema.Struct({
  id: ServerId,
  name: ServerName,
  host: ServerHost,
  port: ServerPort,
  username: ServerUsername,
  auth: ServerAuthMethod,
  tags: Schema.Array(ServerTag),
  permissionTier: ServerPermissionTier,
  notes: Schema.String,
  source: ServerSource,
  sshConfigAlias: Schema.optional(Schema.String),
  lastTest: Schema.optional(ServerConnectionTest),
  lastStats: Schema.optional(ServerStats),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
});
export type ServerRecord = typeof ServerRecord.Type;

export const ServerSecretInput = Schema.Struct({
  privateKey: Schema.optional(Schema.String),
  passphrase: Schema.optional(Schema.String),
  password: Schema.optional(Schema.String),
});
export type ServerSecretInput = typeof ServerSecretInput.Type;

export const ServerCreateInput = Schema.Struct({
  name: ServerName,
  host: ServerHost,
  port: Schema.optional(ServerPort).pipe(Schema.withDecodingDefault(() => 22)),
  username: ServerUsername,
  auth: ServerAuthMethod,
  tags: Schema.optional(Schema.Array(ServerTag).check(Schema.isMaxLength(16))).pipe(
    Schema.withDecodingDefault(() => []),
  ),
  permissionTier: Schema.optional(ServerPermissionTier).pipe(
    Schema.withDecodingDefault(() => "read-only" as const),
  ),
  notes: Schema.optional(Schema.String.check(Schema.isMaxLength(2000))).pipe(
    Schema.withDecodingDefault(() => ""),
  ),
  source: Schema.optional(ServerSource).pipe(Schema.withDecodingDefault(() => "manual" as const)),
  sshConfigAlias: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(128))),
  secret: Schema.optional(ServerSecretInput),
});
export type ServerCreateInput = typeof ServerCreateInput.Type;

export const ServerSecretKind = Schema.Literals(["privateKey", "passphrase", "password"]);
export type ServerSecretKind = typeof ServerSecretKind.Type;

export const ServerUpdateInput = Schema.Struct({
  id: ServerId,
  patch: Schema.Struct({
    name: Schema.optional(ServerName),
    host: Schema.optional(ServerHost),
    port: Schema.optional(ServerPort),
    username: Schema.optional(ServerUsername),
    auth: Schema.optional(ServerAuthMethod),
    tags: Schema.optional(Schema.Array(ServerTag).check(Schema.isMaxLength(16))),
    permissionTier: Schema.optional(ServerPermissionTier),
    notes: Schema.optional(Schema.String.check(Schema.isMaxLength(2000))),
  }),
  secret: Schema.optional(ServerSecretInput),
  clearSecrets: Schema.optional(Schema.Array(ServerSecretKind)),
});
export type ServerUpdateInput = typeof ServerUpdateInput.Type;

export const ServerByIdInput = Schema.Struct({ id: ServerId });
export type ServerByIdInput = typeof ServerByIdInput.Type;
export const ServerDeleteInput = ServerByIdInput;
export type ServerDeleteInput = typeof ServerDeleteInput.Type;

export const ServerListResult = Schema.Struct({ servers: Schema.Array(ServerRecord) });
export type ServerListResult = typeof ServerListResult.Type;

export const ServerTrustHostKeyInput = Schema.Struct({
  id: ServerId,
  fingerprint: Schema.String,
});
export type ServerTrustHostKeyInput = typeof ServerTrustHostKeyInput.Type;

export const ServerRefreshStatsResult = Schema.Union([
  Schema.Struct({ ok: Schema.Literal(true), stats: ServerStats }),
  Schema.Struct({ ok: Schema.Literal(false), test: ServerConnectionTest }),
]);
export type ServerRefreshStatsResult = typeof ServerRefreshStatsResult.Type;

export const SshConfigCandidate = Schema.Struct({
  alias: Schema.String,
  host: Schema.String,
  port: Schema.Number,
  username: Schema.optional(Schema.String),
  identityFile: Schema.optional(Schema.String),
  alreadyImported: Schema.Boolean,
});
export type SshConfigCandidate = typeof SshConfigCandidate.Type;

export const ServerImportPreviewResult = Schema.Struct({
  configPath: Schema.String,
  candidates: Schema.Array(SshConfigCandidate),
});
export type ServerImportPreviewResult = typeof ServerImportPreviewResult.Type;

export const ServerImportApplyInput = Schema.Struct({ aliases: Schema.Array(Schema.String) });
export type ServerImportApplyInput = typeof ServerImportApplyInput.Type;
export const ServerImportApplyResult = Schema.Struct({ servers: Schema.Array(ServerRecord) });
export type ServerImportApplyResult = typeof ServerImportApplyResult.Type;

export const ServerCapabilities = Schema.Struct({
  sshPath: Schema.NullOr(Schema.String),
  sshVersion: Schema.NullOr(Schema.String),
  askpassSupported: Schema.Boolean,
});
export type ServerCapabilities = typeof ServerCapabilities.Type;

export const LocalKeyCandidate = Schema.Struct({ path: Schema.String, label: Schema.String });
export type LocalKeyCandidate = typeof LocalKeyCandidate.Type;
export const ServerListLocalKeysResult = Schema.Struct({ keys: Schema.Array(LocalKeyCandidate) });
export type ServerListLocalKeysResult = typeof ServerListLocalKeysResult.Type;

export const EmptyServersInput = Schema.Struct({});
export type EmptyServersInput = typeof EmptyServersInput.Type;

/** Mention-style reference for the future `@server` composer projection. */
export function serverReference(record: Pick<ServerRecord, "id" | "name">): {
  name: string;
  path: string;
} {
  return { name: record.name, path: `ssh://${record.id}` };
}

// ---------------------------------------------------------------------------
// Agent commands (the `djl-ssh` shim) and the `@server` mention reference.
// ---------------------------------------------------------------------------

export const SERVER_MENTION_PREFIX = "ssh://";

export function isServerMentionPath(path: string): boolean {
  return path.startsWith(SERVER_MENTION_PREFIX);
}

export function serverIdFromMentionPath(path: string): ServerId | null {
  if (!isServerMentionPath(path)) return null;
  const id = path.slice(SERVER_MENTION_PREFIX.length).trim();
  return id.length > 0 ? ServerId.makeUnsafe(id) : null;
}

export const ServerCommandId = TrimmedNonEmptyString.pipe(Schema.brand("ServerCommandId"));
export type ServerCommandId = typeof ServerCommandId.Type;

export const SERVER_COMMAND_STATUSES = [
  "pending",
  "running",
  "succeeded",
  "failed",
  "denied",
  "refused",
  "timed-out",
] as const;
export const ServerCommandStatus = Schema.Literals(SERVER_COMMAND_STATUSES);
export type ServerCommandStatus = typeof ServerCommandStatus.Type;

export const ServerCommandRecord = Schema.Struct({
  id: ServerCommandId,
  serverId: ServerId,
  serverName: Schema.String,
  threadId: Schema.optional(Schema.String),
  command: Schema.String,
  tier: ServerPermissionTier,
  status: ServerCommandStatus,
  exitCode: Schema.optional(Schema.Number),
  /** Combined output, truncated for the audit trail. */
  output: Schema.optional(Schema.String),
  /** Why a command was refused or denied, in user-facing words. */
  reason: Schema.optional(Schema.String),
  requestedAt: Schema.Number,
  finishedAt: Schema.optional(Schema.Number),
});
export type ServerCommandRecord = typeof ServerCommandRecord.Type;

export const ServerCommandDecision = Schema.Literals(["approve", "deny"]);
export type ServerCommandDecision = typeof ServerCommandDecision.Type;

export const ServerResolveCommandInput = Schema.Struct({
  id: ServerCommandId,
  decision: ServerCommandDecision,
});
export type ServerResolveCommandInput = typeof ServerResolveCommandInput.Type;

export const ServerListCommandsInput = Schema.Struct({
  id: ServerId,
  limit: Schema.optional(PositiveInt),
});
export type ServerListCommandsInput = typeof ServerListCommandsInput.Type;

export const ServerListCommandsResult = Schema.Struct({
  commands: Schema.Array(ServerCommandRecord),
});
export type ServerListCommandsResult = typeof ServerListCommandsResult.Type;

export const ServerCommandStreamEvent = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("snapshot"),
    pending: Schema.Array(ServerCommandRecord),
  }),
  Schema.Struct({
    type: Schema.Literal("command-updated"),
    command: ServerCommandRecord,
  }),
]);
export type ServerCommandStreamEvent = typeof ServerCommandStreamEvent.Type;
