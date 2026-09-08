# Server Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Settings section where a DJL user registers SSH hosts, tests reachability with explicit host-key trust, and sees on-demand stats, with secrets kept in DJL's 0600 secret store.

**Architecture:** Plain-CRUD SQLite table + `ServerRepository`, a `ServerService` that composes the repository, secret store, an OpenSSH-binary `SshRunner`, host-key helpers, a stats parser and an `~/.ssh/config` importer; exposed over the existing Effect RPC group and rendered by a new `ServersSettingsPanel` built from DJL's settings primitives.

**Tech Stack:** Effect (Schema, Layer, `effect/unstable/sql`), SQLite via `@effect/sql`, `@effect/vitest`, React 19 + TanStack Query + Base UI primitives, react-i18next, Tailwind v4, vitest browser mode (Playwright Chromium).

**Spec:** `docs/superpowers/specs/2026-09-08-server-registry-design.md`

## Global Constraints

- Branch: `feat/server-registry`. Never commit to `main`.
- No new runtime dependency. The SSH client is the system OpenSSH binary.
- Secrets (private key, passphrase, password) never appear on argv, in logs, in RPC responses, or in SQLite. They live only in `ServerSecretStore` under `server.<id>.key|passphrase|password`.
- `StrictHostKeyChecking=yes` is always passed. Unknown host keys are never auto-trusted.
- Host and username inputs reject a leading `-`.
- Every UI string exists in all 7 catalogs (`en, es-419, fr, ja, ko, zh-Hans, zh-Hant`) with real translations; `apps/web/src/i18n/catalogEquality.test.ts` rejects English copies.
- All motion is CSS and collapses under `@media (prefers-reduced-motion: reduce)`.
- Package scope is `@synara/*`; product name in UI copy is DJL.
- Timestamps in the new contracts are epoch milliseconds (`Schema.Number`).
- Run server tests with `bun run --cwd apps/server test -- <file>`; web unit tests with `bun run --cwd apps/web test -- <file>`; web browser tests with `bun run --cwd apps/web test:browser -- <file>`; contracts tests with `bun run --cwd packages/contracts test`.
- Commit after every task with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` as the last line.

## File structure

| Path | Responsibility |
| --- | --- |
| `packages/contracts/src/servers.ts` | All server schemas and RPC input/output types |
| `packages/contracts/src/{index,ws,rpc,ipc}.ts` | Export, method names, Rpc definitions, `NativeApi.servers` |
| `apps/server/src/persistence/Migrations/059_Servers.ts` | `servers` table |
| `apps/server/src/persistence/Services/ServerRepository.ts` | Repository tag + shape |
| `apps/server/src/persistence/Layers/ServerRepository.ts` | SQL implementation |
| `apps/server/src/servers/secrets.ts` | Secret names, store/clear helpers over `ServerSecretStore` |
| `apps/server/src/servers/sshArgs.ts` | Pure argv/env builder for ssh (unit-testable, no IO) |
| `apps/server/src/servers/SshRunner.ts` | Spawns ssh via `runProcess`, askpass temp-file lifecycle, outcome mapping |
| `apps/server/src/servers/knownHosts.ts` | `ssh-keygen -F/-R`, `ssh-keyscan`, fingerprint |
| `apps/server/src/servers/stats.ts` | Stats command + parser |
| `apps/server/src/servers/sshConfigImport.ts` | `~/.ssh/config` parser |
| `apps/server/src/servers/localKeys.ts` | Lists candidate private keys in `~/.ssh` |
| `apps/server/src/servers/Services/ServerService.ts` | Service tag + shape |
| `apps/server/src/servers/Layers/ServerService.ts` | Composition of the above |
| `apps/server/src/{wsRpc,serverLayers}.ts` | Handlers, layer wiring |
| `apps/web/src/wsNativeApi.ts` | Client methods |
| `apps/web/src/{settingsNavigation,settingsSearchIndex}.ts`, `routes/_chat.settings.tsx` | Section registration |
| `apps/web/src/i18n/locales/*.json` | Strings |
| `apps/web/src/index.css` | `servers-*` keyframes |
| `apps/web/src/components/settings/servers/serverPanelModel.ts` | Pure helpers: command preview, formatting, validation |
| `apps/web/src/components/settings/servers/ServerStatusDot.tsx` | Status dot |
| `apps/web/src/components/settings/servers/ServerRow.tsx` | Row + expanded region + host-key block |
| `apps/web/src/components/settings/servers/ServerEditorDialog.tsx` | Add/Edit dialog |
| `apps/web/src/components/settings/servers/ServerImportDialog.tsx` | Import dialog |
| `apps/web/src/components/settings/servers/ServersEmptyState.tsx` | Empty state |
| `apps/web/src/components/settings/ServersSettingsPanel.tsx` | Panel: queries, mutations, layout |

---

### Task 1: Contracts

**Files:**
- Create: `packages/contracts/src/servers.ts`
- Modify: `packages/contracts/src/index.ts` (add export)
- Modify: `packages/contracts/src/ws.ts:312` (WS_METHODS) and `:517` (request bodies)
- Modify: `packages/contracts/src/rpc.ts:1134` (Rpcs) and `:1328` (group)
- Modify: `packages/contracts/src/ipc.ts:782` (NativeApi)
- Test: `packages/contracts/src/servers.test.ts`

**Interfaces:**
- Produces every type used by later tasks: `ServerId`, `ServerRecord`, `ServerAuthMethod`, `ServerPermissionTier`, `ServerTag`, `ServerConnectionTest`, `ServerStats`, `ServerSecretInput`, `ServerCreateInput`, `ServerUpdateInput`, `ServerDeleteInput`, `ServerByIdInput`, `ServerListResult`, `ServerTrustHostKeyInput`, `ServerRefreshStatsResult`, `SshConfigCandidate`, `ServerImportPreviewResult`, `ServerImportApplyInput`, `ServerImportApplyResult`, `ServerCapabilities`, `LocalKeyCandidate`, `ServerListLocalKeysResult`.
- WS methods: `serversList, serversCreate, serversUpdate, serversDelete, serversTestConnection, serversTrustHostKey, serversRefreshStats, serversImportPreview, serversImportApply, serversCheckCapabilities, serversListLocalKeys`.

- [ ] **Step 1: Write the failing schema test**

```ts
// packages/contracts/src/servers.test.ts
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { ServerCreateInput, ServerRecord, serverReference } from "./servers";

describe("server contracts", () => {
  it("decodes a minimal create input with defaults", () => {
    const decoded = Schema.decodeUnknownSync(ServerCreateInput)({
      name: "hk-1",
      host: "203.0.113.10",
      username: "root",
      auth: { type: "agent" },
    });
    expect(decoded.port).toBe(22);
    expect(decoded.tags).toEqual([]);
    expect(decoded.permissionTier).toBe("read-only");
    expect(decoded.notes).toBe("");
  });

  it("rejects option-looking host and username", () => {
    expect(() =>
      Schema.decodeUnknownSync(ServerCreateInput)({
        name: "x", host: "-oProxyCommand=evil", username: "root", auth: { type: "agent" },
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(ServerCreateInput)({
        name: "x", host: "h", username: "-l", auth: { type: "agent" },
      }),
    ).toThrow();
  });

  it("rejects tags with spaces and accepts unicode tags", () => {
    const ok = Schema.decodeUnknownSync(ServerCreateInput)({
      name: "x", host: "h", username: "u", auth: { type: "agent" }, tags: ["生产", "web_1"],
    });
    expect(ok.tags).toEqual(["生产", "web_1"]);
    expect(() =>
      Schema.decodeUnknownSync(ServerCreateInput)({
        name: "x", host: "h", username: "u", auth: { type: "agent" }, tags: ["has space"],
      }),
    ).toThrow();
  });

  it("builds the ssh:// reference from a record id", () => {
    const record = Schema.decodeUnknownSync(ServerRecord)({
      id: "abc", name: "n", host: "h", port: 22, username: "u", auth: { type: "password" },
      tags: [], permissionTier: "full", notes: "", source: "manual", createdAt: 1, updatedAt: 1,
    });
    expect(serverReference(record)).toEqual({ name: "n", path: "ssh://abc" });
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `bun run --cwd packages/contracts test -- servers.test.ts`
Expected: FAIL, cannot resolve `./servers`.

- [ ] **Step 3: Write `packages/contracts/src/servers.ts`**

```ts
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
  TrimmedNonEmptyString.check(Schema.isMaxLength(max)).check(Schema.isPattern(/^[^-\s]/));

export const ServerName = TrimmedNonEmptyString.check(Schema.isMaxLength(64));
export const ServerHost = noLeadingDash(253).check(Schema.isPattern(/^[A-Za-z0-9._:\[\]-]+$/));
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
  "ok", "host-key-unknown", "host-key-changed", "auth-failed",
  "unreachable", "timeout", "askpass-unsupported", "error",
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
  load: Schema.optional(Schema.Struct({ one: Schema.Number, five: Schema.Number, fifteen: Schema.Number })),
  memory: Schema.optional(Schema.Struct({ totalBytes: Schema.Number, usedBytes: Schema.Number })),
  disk: Schema.optional(
    Schema.Struct({ totalBytes: Schema.Number, usedBytes: Schema.Number, mountPoint: Schema.String }),
  ),
});
export type ServerStats = typeof ServerStats.Type;

export const ServerSource = Schema.Literals(["manual", "ssh-config"]);

const ServerEditableFields = {
  name: ServerName,
  host: ServerHost,
  port: Schema.optionalKey(ServerPort).pipe(Schema.withDecodingDefault(() => 22)),
  username: ServerUsername,
  auth: ServerAuthMethod,
  tags: Schema.optionalKey(Schema.Array(ServerTag).check(Schema.isMaxLength(16))).pipe(
    Schema.withDecodingDefault(() => []),
  ),
  permissionTier: Schema.optionalKey(ServerPermissionTier).pipe(
    Schema.withDecodingDefault(() => "read-only" as const),
  ),
  notes: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(2000))).pipe(
    Schema.withDecodingDefault(() => ""),
  ),
  sshConfigAlias: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(128))),
};

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
  ...ServerEditableFields,
  source: Schema.optionalKey(ServerSource).pipe(Schema.withDecodingDefault(() => "manual" as const)),
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

export const ServerTrustHostKeyInput = Schema.Struct({ id: ServerId, fingerprint: Schema.String });
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

/** Mention-style reference for the future `@server` composer projection. */
export function serverReference(record: Pick<ServerRecord, "id" | "name">) {
  return { name: record.name, path: `ssh://${record.id}` };
}
```

If `Schema.withDecodingDefault` does not exist in the pinned Effect version, look at how `automation.ts` declares defaults (search `withDecodingDefault\|optionalKey` in `packages/contracts/src`) and use the same construct.

- [ ] **Step 4: Register the module and the methods**

`packages/contracts/src/index.ts`: add `export * from "./servers";` next to the other exports.

`packages/contracts/src/ws.ts`, inside `WS_METHODS` after the automation block:

```ts
  // Server registry methods
  serversList: "servers.list",
  serversCreate: "servers.create",
  serversUpdate: "servers.update",
  serversDelete: "servers.delete",
  serversTestConnection: "servers.testConnection",
  serversTrustHostKey: "servers.trustHostKey",
  serversRefreshStats: "servers.refreshStats",
  serversImportPreview: "servers.importSshConfig.preview",
  serversImportApply: "servers.importSshConfig.apply",
  serversCheckCapabilities: "servers.checkCapabilities",
  serversListLocalKeys: "servers.listLocalKeys",
```

and inside `WebSocketRequestBody` after the automation `tagRequestBody` lines (import the schemas from `./servers`):

```ts
  // Server registry methods
  tagRequestBody(WS_METHODS.serversList, EmptyServersInput),
  tagRequestBody(WS_METHODS.serversCreate, ServerCreateInput),
  tagRequestBody(WS_METHODS.serversUpdate, ServerUpdateInput),
  tagRequestBody(WS_METHODS.serversDelete, ServerDeleteInput),
  tagRequestBody(WS_METHODS.serversTestConnection, ServerByIdInput),
  tagRequestBody(WS_METHODS.serversTrustHostKey, ServerTrustHostKeyInput),
  tagRequestBody(WS_METHODS.serversRefreshStats, ServerByIdInput),
  tagRequestBody(WS_METHODS.serversImportPreview, EmptyServersInput),
  tagRequestBody(WS_METHODS.serversImportApply, ServerImportApplyInput),
  tagRequestBody(WS_METHODS.serversCheckCapabilities, EmptyServersInput),
  tagRequestBody(WS_METHODS.serversListLocalKeys, EmptyServersInput),
```

`packages/contracts/src/rpc.ts`, after `WsAutomationCreateRpc` (import the schemas from `./servers`):

```ts
export const WsServersListRpc = Rpc.make(WS_METHODS.serversList, {
  payload: EmptyServersInput, success: ServerListResult, error: WsRpcError,
});
export const WsServersCreateRpc = Rpc.make(WS_METHODS.serversCreate, {
  payload: ServerCreateInput, success: ServerRecord, error: WsRpcError,
});
export const WsServersUpdateRpc = Rpc.make(WS_METHODS.serversUpdate, {
  payload: ServerUpdateInput, success: ServerRecord, error: WsRpcError,
});
export const WsServersDeleteRpc = Rpc.make(WS_METHODS.serversDelete, {
  payload: ServerDeleteInput, success: Schema.Void, error: WsRpcError,
});
export const WsServersTestConnectionRpc = Rpc.make(WS_METHODS.serversTestConnection, {
  payload: ServerByIdInput, success: ServerConnectionTest, error: WsRpcError,
});
export const WsServersTrustHostKeyRpc = Rpc.make(WS_METHODS.serversTrustHostKey, {
  payload: ServerTrustHostKeyInput, success: ServerConnectionTest, error: WsRpcError,
});
export const WsServersRefreshStatsRpc = Rpc.make(WS_METHODS.serversRefreshStats, {
  payload: ServerByIdInput, success: ServerRefreshStatsResult, error: WsRpcError,
});
export const WsServersImportPreviewRpc = Rpc.make(WS_METHODS.serversImportPreview, {
  payload: EmptyServersInput, success: ServerImportPreviewResult, error: WsRpcError,
});
export const WsServersImportApplyRpc = Rpc.make(WS_METHODS.serversImportApply, {
  payload: ServerImportApplyInput, success: ServerImportApplyResult, error: WsRpcError,
});
export const WsServersCheckCapabilitiesRpc = Rpc.make(WS_METHODS.serversCheckCapabilities, {
  payload: EmptyServersInput, success: ServerCapabilities, error: WsRpcError,
});
export const WsServersListLocalKeysRpc = Rpc.make(WS_METHODS.serversListLocalKeys, {
  payload: EmptyServersInput, success: ServerListLocalKeysResult, error: WsRpcError,
});
```

Add all eleven to `RpcGroup.make(...)` after `WsAutomationCreateRpc`.

`packages/contracts/src/ipc.ts`, after the `automation` block in `NativeApi`:

```ts
  servers: {
    list: () => Promise<ServerListResult>;
    create: (input: ServerCreateInput) => Promise<ServerRecord>;
    update: (input: ServerUpdateInput) => Promise<ServerRecord>;
    delete: (input: ServerDeleteInput) => Promise<void>;
    testConnection: (input: ServerByIdInput) => Promise<ServerConnectionTest>;
    trustHostKey: (input: ServerTrustHostKeyInput) => Promise<ServerConnectionTest>;
    refreshStats: (input: ServerByIdInput) => Promise<ServerRefreshStatsResult>;
    importPreview: () => Promise<ServerImportPreviewResult>;
    importApply: (input: ServerImportApplyInput) => Promise<ServerImportApplyResult>;
    checkCapabilities: () => Promise<ServerCapabilities>;
    listLocalKeys: () => Promise<ServerListLocalKeysResult>;
  };
```

- [ ] **Step 5: Run the test and typecheck**

Run: `bun run --cwd packages/contracts test -- servers.test.ts && bun run --cwd packages/contracts typecheck` (if no `typecheck` script, run `bunx tsc -p packages/contracts --noEmit`).
Expected: PASS. Typecheck will now fail in `apps/web/src/wsNativeApi.ts` because `NativeApi.servers` is unimplemented; that is fixed in Task 8. Do not typecheck the web app yet.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/servers.ts packages/contracts/src/servers.test.ts packages/contracts/src/index.ts packages/contracts/src/ws.ts packages/contracts/src/rpc.ts packages/contracts/src/ipc.ts
git commit -m "feat(contracts): server registry schemas and RPC surface

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Migration and ServerRepository

**Files:**
- Create: `apps/server/src/persistence/Migrations/059_Servers.ts`
- Modify: `apps/server/src/persistence/Migrations.ts:76` (import) and `:146` (entry)
- Modify: `apps/server/src/persistence/Errors.ts:128` (add error type)
- Create: `apps/server/src/persistence/Services/ServerRepository.ts`
- Create: `apps/server/src/persistence/Layers/ServerRepository.ts`
- Test: `apps/server/src/persistence/Layers/ServerRepository.test.ts`

**Interfaces:**
- Produces `ServerRepository` with shape:

```ts
interface ServerRepositoryShape {
  list: () => Effect<ReadonlyArray<ServerRecord>, ServerRepositoryError>;
  getById: (id: ServerId) => Effect<Option<ServerRecord>, ServerRepositoryError>;
  create: (input: { id: ServerId; input: ServerCreateInput; now: number }) => Effect<ServerRecord, ServerRepositoryError>;
  save: (record: ServerRecord) => Effect<ServerRecord, ServerRepositoryError>;
  remove: (id: ServerId) => Effect<void, ServerRepositoryError>;
}
```
- `ServerRepositoryError = PersistenceSqlError | PersistenceDecodeError`.

- [ ] **Step 1: Write the failing repository test**

```ts
// apps/server/src/persistence/Layers/ServerRepository.test.ts
import { assert, it } from "@effect/vitest";
import { ServerId, type ServerCreateInput } from "@synara/contracts";
import { Effect, Layer, Option } from "effect";

import { runMigrations } from "../Migrations.ts";
import { ServerRepository } from "../Services/ServerRepository.ts";
import { ServerRepositoryLive } from "./ServerRepository.ts";
import { SqlitePersistenceMemory } from "./Sqlite.ts";

const layer = it.layer(ServerRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)));

const createInput = {
  name: "hk-1",
  host: "203.0.113.10",
  port: 22,
  username: "root",
  auth: { type: "keyPath", path: "~/.ssh/id_ed25519", hasPassphrase: false },
  tags: ["prod", "hk"],
  permissionTier: "read-only",
  notes: "",
  source: "manual",
} satisfies ServerCreateInput;

layer("ServerRepository", (it) => {
  it.effect("creates, lists, updates and removes servers", () =>
    Effect.gen(function* () {
      const repository = yield* ServerRepository;
      yield* runMigrations();
      const created = yield* repository.create({
        id: ServerId.makeUnsafe("srv-1"), input: createInput, now: 1000,
      });
      assert.strictEqual(created.port, 22);
      assert.deepStrictEqual(created.tags, ["prod", "hk"]);
      assert.strictEqual(created.createdAt, 1000);

      const listed = yield* repository.list();
      assert.strictEqual(listed.length, 1);

      const saved = yield* repository.save({
        ...created,
        name: "hk-primary",
        lastTest: { at: 2000, outcome: "ok", latencyMs: 120 },
        lastStats: { collectedAt: 2000, uptimeSeconds: 86400 },
        updatedAt: 2000,
      });
      const fetched = yield* repository.getById(created.id);
      assert.isTrue(Option.isSome(fetched));
      if (Option.isSome(fetched)) {
        assert.strictEqual(fetched.value.name, "hk-primary");
        assert.deepStrictEqual(fetched.value.lastTest, saved.lastTest);
        assert.strictEqual(fetched.value.lastStats?.uptimeSeconds, 86400);
      }

      yield* repository.remove(created.id);
      assert.isTrue(Option.isNone(yield* repository.getById(created.id)));
    }),
  );

  it.effect("never stores the secret input", () =>
    Effect.gen(function* () {
      const repository = yield* ServerRepository;
      yield* runMigrations();
      const created = yield* repository.create({
        id: ServerId.makeUnsafe("srv-2"),
        input: { ...createInput, auth: { type: "password" }, secret: { password: "hunter2" } },
        now: 1,
      });
      assert.isFalse("secret" in created);
      assert.isFalse(JSON.stringify(created).includes("hunter2"));
    }),
  );

  it.effect("lists servers ordered by name", () =>
    Effect.gen(function* () {
      const repository = yield* ServerRepository;
      yield* runMigrations();
      yield* repository.create({ id: ServerId.makeUnsafe("b"), input: { ...createInput, name: "beta" }, now: 1 });
      yield* repository.create({ id: ServerId.makeUnsafe("a"), input: { ...createInput, name: "alpha" }, now: 2 });
      const names = (yield* repository.list()).map((server) => server.name);
      assert.deepStrictEqual(names, ["alpha", "beta"]);
    }),
  );
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `bun run --cwd apps/server test -- ServerRepository.test.ts`
Expected: FAIL, cannot resolve `./ServerRepository.ts`.

- [ ] **Step 3: Write the migration**

```ts
// apps/server/src/persistence/Migrations/059_Servers.ts
// FILE: 059_Servers.ts
// Purpose: Registry of user SSH hosts for the Servers settings section.
// Layer: Persistence migration

import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS servers (
      server_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      host TEXT NOT NULL,
      port INTEGER NOT NULL,
      username TEXT NOT NULL,
      auth_json TEXT NOT NULL,
      tags_json TEXT NOT NULL DEFAULT '[]',
      permission_tier TEXT NOT NULL CHECK (permission_tier IN ('read-only', 'approve-each', 'full')),
      notes TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL CHECK (source IN ('manual', 'ssh-config')),
      ssh_config_alias TEXT,
      last_test_json TEXT,
      last_stats_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `;
  yield* sql`CREATE INDEX IF NOT EXISTS idx_servers_name ON servers(name)`;
});
```

In `Migrations.ts` add `import Migration0059 from "./Migrations/059_Servers.ts";` after the 058 import and `[59, "Servers", Migration0059],` after the 058 entry.

In `Errors.ts` add after line 128: `export type ServerRepositoryError = PersistenceSqlError | PersistenceDecodeError;`

- [ ] **Step 4: Write the service tag**

```ts
// apps/server/src/persistence/Services/ServerRepository.ts
import type { ServerCreateInput, ServerId, ServerRecord } from "@synara/contracts";
import { ServiceMap } from "effect";
import type { Effect, Option } from "effect";

import type { ServerRepositoryError } from "../Errors.ts";

export interface CreateServerRecordInput {
  readonly id: ServerId;
  readonly input: ServerCreateInput;
  readonly now: number;
}

export interface ServerRepositoryShape {
  readonly list: () => Effect.Effect<ReadonlyArray<ServerRecord>, ServerRepositoryError>;
  readonly getById: (id: ServerId) => Effect.Effect<Option.Option<ServerRecord>, ServerRepositoryError>;
  readonly create: (input: CreateServerRecordInput) => Effect.Effect<ServerRecord, ServerRepositoryError>;
  readonly save: (record: ServerRecord) => Effect.Effect<ServerRecord, ServerRepositoryError>;
  readonly remove: (id: ServerId) => Effect.Effect<void, ServerRepositoryError>;
}

export class ServerRepository extends ServiceMap.Service<ServerRepository, ServerRepositoryShape>()(
  "synara/persistence/Services/ServerRepository",
) {}
```

- [ ] **Step 5: Write the layer**

```ts
// apps/server/src/persistence/Layers/ServerRepository.ts
import {
  ServerAuthMethod, ServerConnectionTest, ServerId, ServerRecord, ServerStats, ServerTag,
} from "@synara/contracts";
import { Effect, Layer, Option, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceDecodeError, toPersistenceSqlError } from "../Errors.ts";
import { ServerRepository, type ServerRepositoryShape } from "../Services/ServerRepository.ts";

const ServerDbRow = Schema.Struct({
  id: ServerId,
  name: Schema.String,
  host: Schema.String,
  port: Schema.Number,
  username: Schema.String,
  auth: Schema.fromJsonString(ServerAuthMethod),
  tags: Schema.fromJsonString(Schema.Array(ServerTag)),
  permissionTier: ServerRecord.fields.permissionTier,
  notes: Schema.String,
  source: ServerRecord.fields.source,
  sshConfigAlias: Schema.NullOr(Schema.String),
  lastTest: Schema.NullOr(Schema.fromJsonString(ServerConnectionTest)),
  lastStats: Schema.NullOr(Schema.fromJsonString(ServerStats)),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
});
type ServerDbRow = typeof ServerDbRow.Type;

const decodeRecord = Schema.decodeUnknownEffect(ServerRecord);

function toRecord(row: ServerDbRow) {
  return decodeRecord({
    ...row,
    sshConfigAlias: row.sshConfigAlias ?? undefined,
    lastTest: row.lastTest ?? undefined,
    lastStats: row.lastStats ?? undefined,
  }).pipe(Effect.mapError(toPersistenceDecodeError("ServerRepository.rowToDomain")));
}

function toRow(record: ServerRecord): ServerDbRow {
  return {
    id: record.id,
    name: record.name,
    host: record.host,
    port: record.port,
    username: record.username,
    auth: record.auth,
    tags: record.tags,
    permissionTier: record.permissionTier,
    notes: record.notes,
    source: record.source,
    sshConfigAlias: record.sshConfigAlias ?? null,
    lastTest: record.lastTest ?? null,
    lastStats: record.lastStats ?? null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

const SELECT_COLUMNS = `
  server_id AS "id", name, host, port, username,
  auth_json AS "auth", tags_json AS "tags", permission_tier AS "permissionTier",
  notes, source, ssh_config_alias AS "sshConfigAlias",
  last_test_json AS "lastTest", last_stats_json AS "lastStats",
  created_at AS "createdAt", updated_at AS "updatedAt"
`;

const makeServerRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const insertRow = SqlSchema.void({
    Request: ServerDbRow,
    execute: (row) => sql`
      INSERT INTO servers (
        server_id, name, host, port, username, auth_json, tags_json, permission_tier, notes,
        source, ssh_config_alias, last_test_json, last_stats_json, created_at, updated_at
      ) VALUES (
        ${row.id}, ${row.name}, ${row.host}, ${row.port}, ${row.username}, ${row.auth}, ${row.tags},
        ${row.permissionTier}, ${row.notes}, ${row.source}, ${row.sshConfigAlias}, ${row.lastTest},
        ${row.lastStats}, ${row.createdAt}, ${row.updatedAt}
      )
    `,
  });

  const updateRow = SqlSchema.void({
    Request: ServerDbRow,
    execute: (row) => sql`
      UPDATE servers SET
        name = ${row.name}, host = ${row.host}, port = ${row.port}, username = ${row.username},
        auth_json = ${row.auth}, tags_json = ${row.tags}, permission_tier = ${row.permissionTier},
        notes = ${row.notes}, source = ${row.source}, ssh_config_alias = ${row.sshConfigAlias},
        last_test_json = ${row.lastTest}, last_stats_json = ${row.lastStats}, updated_at = ${row.updatedAt}
      WHERE server_id = ${row.id}
    `,
  });

  const selectAll = SqlSchema.findAll({
    Request: Schema.Struct({}),
    Result: ServerDbRow,
    execute: () => sql.unsafe(`SELECT ${SELECT_COLUMNS} FROM servers ORDER BY name COLLATE NOCASE ASC`),
  });

  const selectById = SqlSchema.findOneOption({
    Request: Schema.Struct({ id: ServerId }),
    Result: ServerDbRow,
    execute: ({ id }) => sql.unsafe(`SELECT ${SELECT_COLUMNS} FROM servers WHERE server_id = ?`, [id]),
  });

  const deleteRow = SqlSchema.void({
    Request: Schema.Struct({ id: ServerId }),
    execute: ({ id }) => sql`DELETE FROM servers WHERE server_id = ${id}`,
  });

  const list: ServerRepositoryShape["list"] = () =>
    selectAll({}).pipe(
      Effect.mapError(toPersistenceSqlError("ServerRepository.list:query")),
      Effect.flatMap((rows) => Effect.forEach(rows, toRecord)),
    );

  const getById: ServerRepositoryShape["getById"] = (id) =>
    selectById({ id }).pipe(
      Effect.mapError(toPersistenceSqlError("ServerRepository.getById:query")),
      Effect.flatMap((rowOption) =>
        Option.match(rowOption, {
          onNone: () => Effect.succeed(Option.none()),
          onSome: (row) => toRecord(row).pipe(Effect.map(Option.some)),
        }),
      ),
    );

  const create: ServerRepositoryShape["create"] = ({ id, input, now }) => {
    const record: ServerRecord = {
      id,
      name: input.name,
      host: input.host,
      port: input.port,
      username: input.username,
      auth: input.auth,
      tags: [...new Set(input.tags)].toSorted(),
      permissionTier: input.permissionTier,
      notes: input.notes,
      source: input.source,
      ...(input.sshConfigAlias ? { sshConfigAlias: input.sshConfigAlias } : {}),
      createdAt: now,
      updatedAt: now,
    };
    return insertRow(toRow(record)).pipe(
      Effect.mapError(toPersistenceSqlError("ServerRepository.create:insert")),
      Effect.as(record),
    );
  };

  const save: ServerRepositoryShape["save"] = (record) =>
    updateRow(toRow(record)).pipe(
      Effect.mapError(toPersistenceSqlError("ServerRepository.save:update")),
      Effect.as(record),
    );

  const remove: ServerRepositoryShape["remove"] = (id) =>
    deleteRow({ id }).pipe(Effect.mapError(toPersistenceSqlError("ServerRepository.remove:delete")));

  return { list, getById, create, save, remove } satisfies ServerRepositoryShape;
});

export const ServerRepositoryLive = Layer.effect(ServerRepository, makeServerRepository);
```

If `sql.unsafe` is not available on this SqlClient version, write the two SELECTs as tagged templates with the column list inlined, exactly as `AutomationRepository.ts` does.

- [ ] **Step 6: Run the test**

Run: `bun run --cwd apps/server test -- ServerRepository.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/persistence
git commit -m "feat(server): servers table and repository

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Server secrets helper and `ServerSecretStore.pathOf`

**Files:**
- Modify: `apps/server/src/auth/Services/ServerSecretStore.ts` (add `pathOf`)
- Modify: `apps/server/src/auth/Layers/ServerSecretStore.ts` (implement `pathOf`)
- Create: `apps/server/src/servers/secrets.ts`
- Test: `apps/server/src/servers/secrets.test.ts`

**Interfaces:**
- `ServerSecretStoreShape.pathOf(name: string): string` (pure, returns the file path the store would use).
- `secrets.ts` exports:

```ts
export const serverSecretName = (id: ServerId, kind: ServerSecretKind) => `server.${id}.${kind}`;
export const storeServerSecrets: (store: ServerSecretStoreShape, id: ServerId, secret: ServerSecretInput | undefined) => Effect<void, SecretStoreError>;
export const clearServerSecrets: (store: ServerSecretStoreShape, id: ServerId, kinds: ReadonlyArray<ServerSecretKind>) => Effect<void, SecretStoreError>;
export const readServerSecret: (store: ServerSecretStoreShape, id: ServerId, kind: ServerSecretKind) => Effect<string | null, SecretStoreError>;
export const ALL_SERVER_SECRET_KINDS: ReadonlyArray<ServerSecretKind>;
```

- [ ] **Step 1: Write the failing test**

```ts
// apps/server/src/servers/secrets.test.ts
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ServerId } from "@synara/contracts";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import { ServerConfig } from "../config";
import { ServerSecretStore } from "../auth/Services/ServerSecretStore";
import { ServerSecretStoreLive } from "../auth/Layers/ServerSecretStore";
import { clearServerSecrets, readServerSecret, storeServerSecrets, serverSecretName } from "./secrets";

const makeLayer = () =>
  ServerSecretStoreLive.pipe(
    Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "djl-server-secrets-test-" })),
    Layer.provide(NodeServices.layer),
  );

const run = <A>(effect: Effect.Effect<A, unknown, ServerSecretStore>) =>
  effect.pipe(Effect.provide(makeLayer()), Effect.scoped, Effect.runPromise);

describe("server secrets", () => {
  it("stores only the provided kinds and reads them back", async () => {
    await run(
      Effect.gen(function* () {
        const store = yield* ServerSecretStore;
        const id = ServerId.makeUnsafe("srv-1");
        yield* storeServerSecrets(store, id, { password: "hunter2" });
        expect(yield* readServerSecret(store, id, "password")).toBe("hunter2");
        expect(yield* readServerSecret(store, id, "privateKey")).toBeNull();
      }),
    );
  });

  it("clears the requested kinds", async () => {
    await run(
      Effect.gen(function* () {
        const store = yield* ServerSecretStore;
        const id = ServerId.makeUnsafe("srv-2");
        yield* storeServerSecrets(store, id, { privateKey: "KEY", passphrase: "pp" });
        yield* clearServerSecrets(store, id, ["passphrase"]);
        expect(yield* readServerSecret(store, id, "privateKey")).toBe("KEY");
        expect(yield* readServerSecret(store, id, "passphrase")).toBeNull();
      }),
    );
  });

  it("exposes the key file path through pathOf", async () => {
    await run(
      Effect.gen(function* () {
        const store = yield* ServerSecretStore;
        const id = ServerId.makeUnsafe("srv-3");
        const path = store.pathOf(serverSecretName(id, "privateKey"));
        expect(path.endsWith("server.srv-3.privateKey.bin")).toBe(true);
      }),
    );
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `bun run --cwd apps/server test -- servers/secrets.test.ts`
Expected: FAIL, cannot resolve `./secrets`.

- [ ] **Step 3: Add `pathOf` to the store**

In `apps/server/src/auth/Services/ServerSecretStore.ts` add to the shape:

```ts
  /** Absolute on-disk path the store uses for `name`. Pure; the file may not exist. */
  readonly pathOf: (name: string) => string;
```

In `apps/server/src/auth/Layers/ServerSecretStore.ts` add `const pathOf: ServerSecretStoreShape["pathOf"] = (name) => resolveSecretPath(name);` and return `{ get, set, getOrCreateRandom, remove, pathOf }`. Search the repo for other objects that `satisfies ServerSecretStoreShape` (test doubles in `apps/server/src/auth/**/*.test.ts`) and add `pathOf: (name) => name` to each so they still compile.

- [ ] **Step 4: Write `secrets.ts`**

```ts
// apps/server/src/servers/secrets.ts
import type { ServerId, ServerSecretInput, ServerSecretKind } from "@synara/contracts";
import { Effect } from "effect";

import type { SecretStoreError, ServerSecretStoreShape } from "../auth/Services/ServerSecretStore";

export const ALL_SERVER_SECRET_KINDS: ReadonlyArray<ServerSecretKind> = ["privateKey", "passphrase", "password"];

export const serverSecretName = (id: ServerId, kind: ServerSecretKind): string => `server.${id}.${kind}`;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const storeServerSecrets = (
  store: ServerSecretStoreShape,
  id: ServerId,
  secret: ServerSecretInput | undefined,
): Effect.Effect<void, SecretStoreError> =>
  Effect.forEach(
    ALL_SERVER_SECRET_KINDS,
    (kind) => {
      const value = secret?.[kind];
      if (value === undefined) return Effect.void;
      // A private key must end with a newline or OpenSSH rejects the file.
      const normalized = kind === "privateKey" && !value.endsWith("\n") ? `${value}\n` : value;
      return store.set(serverSecretName(id, kind), encoder.encode(normalized));
    },
    { discard: true },
  );

export const clearServerSecrets = (
  store: ServerSecretStoreShape,
  id: ServerId,
  kinds: ReadonlyArray<ServerSecretKind>,
): Effect.Effect<void, SecretStoreError> =>
  Effect.forEach(kinds, (kind) => store.remove(serverSecretName(id, kind)), { discard: true });

export const readServerSecret = (
  store: ServerSecretStoreShape,
  id: ServerId,
  kind: ServerSecretKind,
): Effect.Effect<string | null, SecretStoreError> =>
  store.get(serverSecretName(id, kind)).pipe(Effect.map((bytes) => (bytes ? decoder.decode(bytes) : null)));
```

- [ ] **Step 5: Run the tests**

Run: `bun run --cwd apps/server test -- servers/secrets.test.ts auth/Layers/ServerSecretStore.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/auth apps/server/src/servers/secrets.ts apps/server/src/servers/secrets.test.ts
git commit -m "feat(server): per-server secret helpers and secret store pathOf

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Pure ssh argv and environment builder

**Files:**
- Create: `apps/server/src/servers/sshArgs.ts`
- Test: `apps/server/src/servers/sshArgs.test.ts`

**Interfaces:**
- Produces:

```ts
export interface SshInvocationPlan {
  readonly args: ReadonlyArray<string>;          // everything after `ssh`, ending with the remote command
  readonly needsAskpass: boolean;                // true when a secret must be delivered via askpass
  readonly askpassSecretKind: "password" | "passphrase" | null;
}
export interface SshArgsInput {
  readonly server: Pick<ServerRecord, "host" | "port" | "username" | "auth" | "sshConfigAlias">;
  readonly command: string;
  readonly knownHostsFiles: ReadonlyArray<string>;   // DJL file first, then the user's
  readonly importedKeyPath: string | null;           // from ServerSecretStore.pathOf, when auth.type === "importedKey"
  readonly connectTimeoutSeconds?: number;           // default 10
}
export function buildSshArgs(input: SshArgsInput): SshInvocationPlan;
export function buildSshEnv(base: NodeJS.ProcessEnv, askpass: { helperPath: string; secretFilePath: string } | null): NodeJS.ProcessEnv;
export function knownHostsOptionValue(files: ReadonlyArray<string>): string;  // quotes each path
```

- [ ] **Step 1: Write the failing tests**

```ts
// apps/server/src/servers/sshArgs.test.ts
import { describe, expect, it } from "vitest";
import { buildSshArgs, buildSshEnv, knownHostsOptionValue } from "./sshArgs";

const base = {
  host: "edge.example.test", port: 2222, username: "deploy", auth: { type: "agent" as const },
};
const knownHostsFiles = ["/state/ssh/known_hosts", "/opt/djl-home/known_hosts"];

describe("buildSshArgs", () => {
  it("always enforces strict host key checking and both known_hosts files", () => {
    const plan = buildSshArgs({ server: base, command: "echo ok", knownHostsFiles, importedKeyPath: null });
    expect(plan.args).toContain("StrictHostKeyChecking=yes");
    expect(plan.args).toContain(`UserKnownHostsFile=${knownHostsOptionValue(knownHostsFiles)}`);
    expect(plan.args.at(-1)).toBe("echo ok");
    expect(plan.args).toContain("deploy@edge.example.test");
    expect(plan.args.slice(plan.args.indexOf("-p"), plan.args.indexOf("-p") + 2)).toEqual(["-p", "2222"]);
  });

  it("uses batch mode and no askpass for agent auth", () => {
    const plan = buildSshArgs({ server: base, command: "true", knownHostsFiles, importedKeyPath: null });
    expect(plan.args).toContain("BatchMode=yes");
    expect(plan.args).toContain("PasswordAuthentication=no");
    expect(plan.needsAskpass).toBe(false);
  });

  it("passes -i and IdentitiesOnly for a key path, and askpass only when it has a passphrase", () => {
    const noPass = buildSshArgs({
      server: { ...base, auth: { type: "keyPath", path: "/k/id", hasPassphrase: false } },
      command: "true", knownHostsFiles, importedKeyPath: null,
    });
    expect(noPass.args).toContain("/k/id");
    expect(noPass.args).toContain("IdentitiesOnly=yes");
    expect(noPass.needsAskpass).toBe(false);
    const withPass = buildSshArgs({
      server: { ...base, auth: { type: "keyPath", path: "/k/id", hasPassphrase: true } },
      command: "true", knownHostsFiles, importedKeyPath: null,
    });
    expect(withPass.needsAskpass).toBe(true);
    expect(withPass.askpassSecretKind).toBe("passphrase");
    expect(withPass.args).not.toContain("BatchMode=yes");
  });

  it("points -i at the imported key path", () => {
    const plan = buildSshArgs({
      server: { ...base, auth: { type: "importedKey", hasPassphrase: false } },
      command: "true", knownHostsFiles, importedKeyPath: "/secrets/server.x.privateKey.bin",
    });
    expect(plan.args).toContain("/secrets/server.x.privateKey.bin");
  });

  it("prefers password auth and requires askpass for password", () => {
    const plan = buildSshArgs({
      server: { ...base, auth: { type: "password" } }, command: "true", knownHostsFiles, importedKeyPath: null,
    });
    expect(plan.args).toContain("PreferredAuthentications=password");
    expect(plan.args).toContain("PubkeyAuthentication=no");
    expect(plan.args).toContain("NumberOfPasswordPrompts=1");
    expect(plan.needsAskpass).toBe(true);
    expect(plan.askpassSecretKind).toBe("password");
    expect(plan.args.join(" ")).not.toContain("hunter2");
  });

  it("never emits a secret and never lets the command be parsed as options", () => {
    const plan = buildSshArgs({ server: base, command: "-oProxyCommand=x", knownHostsFiles, importedKeyPath: null });
    const dashDash = plan.args.indexOf("--");
    expect(dashDash).toBeGreaterThan(-1);
    expect(plan.args.indexOf("-oProxyCommand=x")).toBeGreaterThan(dashDash);
  });
});

describe("buildSshEnv", () => {
  it("adds askpass variables only when requested", () => {
    const plain = buildSshEnv({ PATH: "/bin" }, null);
    expect(plain.SSH_ASKPASS).toBeUndefined();
    const withAskpass = buildSshEnv({ PATH: "/bin" }, { helperPath: "/h/djl-askpass", secretFilePath: "/s/1" });
    expect(withAskpass.SSH_ASKPASS).toBe("/h/djl-askpass");
    expect(withAskpass.SSH_ASKPASS_REQUIRE).toBe("force");
    expect(withAskpass.DJL_SSH_SECRET_FILE).toBe("/s/1");
    expect(withAskpass.DISPLAY).toBe("djl");
  });

  it("keeps an existing DISPLAY", () => {
    expect(buildSshEnv({ DISPLAY: ":0" }, { helperPath: "/h", secretFilePath: "/s" }).DISPLAY).toBe(":0");
  });
});

describe("knownHostsOptionValue", () => {
  it("quotes paths so spaces survive", () => {
    expect(knownHostsOptionValue(["/a b/known_hosts", "/c/known_hosts"])).toBe('"/a b/known_hosts" "/c/known_hosts"');
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `bun run --cwd apps/server test -- servers/sshArgs.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// apps/server/src/servers/sshArgs.ts
// FILE: sshArgs.ts
// Purpose: Pure builder for OpenSSH argv/env. No IO, no secrets on argv.
// Layer: Servers domain helpers
import type { ServerRecord } from "@synara/contracts";

export interface SshInvocationPlan {
  readonly args: ReadonlyArray<string>;
  readonly needsAskpass: boolean;
  readonly askpassSecretKind: "password" | "passphrase" | null;
}

export interface SshArgsInput {
  readonly server: Pick<ServerRecord, "host" | "port" | "username" | "auth" | "sshConfigAlias">;
  readonly command: string;
  readonly knownHostsFiles: ReadonlyArray<string>;
  readonly importedKeyPath: string | null;
  readonly connectTimeoutSeconds?: number;
}

export function knownHostsOptionValue(files: ReadonlyArray<string>): string {
  return files.map((file) => `"${file.replace(/"/g, '\\"')}"`).join(" ");
}

export function buildSshArgs(input: SshArgsInput): SshInvocationPlan {
  const { server, command, knownHostsFiles, importedKeyPath } = input;
  const timeout = input.connectTimeoutSeconds ?? 10;
  const auth = server.auth;

  const askpassSecretKind: SshInvocationPlan["askpassSecretKind"] =
    auth.type === "password"
      ? "password"
      : (auth.type === "keyPath" || auth.type === "importedKey") && auth.hasPassphrase
        ? "passphrase"
        : null;
  const needsAskpass = askpassSecretKind !== null;

  const options: string[] = [
    "-T",
    "-o", "StrictHostKeyChecking=yes",
    "-o", `UserKnownHostsFile=${knownHostsOptionValue(knownHostsFiles)}`,
    "-o", `ConnectTimeout=${timeout}`,
    "-o", "LogLevel=ERROR",
    "-o", "NumberOfPasswordPrompts=1",
    "-o", "KbdInteractiveAuthentication=no",
    "-p", String(server.port),
  ];

  if (!needsAskpass) options.push("-o", "BatchMode=yes");

  if (auth.type === "password") {
    options.push("-o", "PreferredAuthentications=password", "-o", "PubkeyAuthentication=no");
  } else {
    options.push("-o", "PasswordAuthentication=no");
  }

  if (auth.type === "keyPath") {
    options.push("-i", auth.path, "-o", "IdentitiesOnly=yes");
  } else if (auth.type === "importedKey" && importedKeyPath) {
    options.push("-i", importedKeyPath, "-o", "IdentitiesOnly=yes");
  }

  const target = `${server.username}@${server.host}`;
  return { args: [...options, target, "--", command], needsAskpass, askpassSecretKind };
}

export function buildSshEnv(
  base: NodeJS.ProcessEnv,
  askpass: { helperPath: string; secretFilePath: string } | null,
): NodeJS.ProcessEnv {
  if (!askpass) return { ...base };
  return {
    ...base,
    SSH_ASKPASS: askpass.helperPath,
    SSH_ASKPASS_REQUIRE: "force",
    DJL_SSH_SECRET_FILE: askpass.secretFilePath,
    DISPLAY: base.DISPLAY ?? "djl",
  };
}
```

- [ ] **Step 4: Run tests**

Run: `bun run --cwd apps/server test -- servers/sshArgs.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/servers/sshArgs.ts apps/server/src/servers/sshArgs.test.ts
git commit -m "feat(server): pure ssh argv/env builder

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: SshRunner with askpass lifecycle and outcome mapping

**Files:**
- Create: `apps/server/src/servers/SshRunner.ts`
- Create: `apps/server/src/servers/sshOutcome.ts`
- Test: `apps/server/src/servers/sshOutcome.test.ts`
- Test: `apps/server/src/servers/SshRunner.test.ts`

**Interfaces:**
- `sshOutcome.ts`:

```ts
export interface RawSshResult { code: number | null; stderr: string; stdout: string; timedOut: boolean }
export function classifySshResult(raw: RawSshResult): ServerTestOutcome;   // never "host-key-unknown" (that is decided before login)
export function sanitizeSshStderr(stderr: string, redactions: ReadonlyArray<string>): string;  // strips redactions, trims, caps at 500 chars
```
- `SshRunner.ts` (an Effect service):

```ts
export interface SshRunResult { outcome: ServerTestOutcome; stdout: string; message: string | undefined; latencyMs: number }
export interface SshRunnerShape {
  readonly run: (input: {
    server: ServerRecord;
    command: string;
    secret: string | null;             // password or passphrase, when needsAskpass
    timeoutMs?: number;                // default 20_000
  }) => Effect.Effect<SshRunResult, SshRunnerError>;
  readonly capabilities: () => Effect.Effect<ServerCapabilities, never>;
  readonly knownHostsFiles: ReadonlyArray<string>;    // [djlKnownHosts, userKnownHosts]
  readonly djlKnownHostsPath: string;
}
export class SshRunner extends ServiceMap.Service<SshRunner, SshRunnerShape>()("synara/servers/SshRunner") {}
export class SshRunnerError extends Data.TaggedError("SshRunnerError")<{ message: string; cause?: unknown }> {}
export const makeSshRunnerLayer: (options?: { sshCommand?: string; sshDir?: string }) => Layer<SshRunner, never, ServerConfig | FileSystem | Path | ServerSecretStore>;
export const SshRunnerLive: Layer<SshRunner, ...>;
```
- Environment override `DJL_SSH_COMMAND` selects the ssh binary (used by tests to point at a fixture script).

- [ ] **Step 1: Write the failing outcome tests**

```ts
// apps/server/src/servers/sshOutcome.test.ts
import { describe, expect, it } from "vitest";
import { classifySshResult, sanitizeSshStderr } from "./sshOutcome";

describe("classifySshResult", () => {
  it("maps exit 0 to ok", () => {
    expect(classifySshResult({ code: 0, stdout: "", stderr: "", timedOut: false })).toBe("ok");
  });
  it("maps permission denied to auth-failed", () => {
    expect(classifySshResult({ code: 255, stdout: "", stderr: "deploy@h: Permission denied (publickey,password).", timedOut: false })).toBe("auth-failed");
  });
  it("maps a changed host key", () => {
    expect(classifySshResult({ code: 255, stdout: "", stderr: "@@@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @@@", timedOut: false })).toBe("host-key-changed");
  });
  it("maps network failures to unreachable", () => {
    for (const line of ["ssh: connect to host h port 22: Connection refused", "ssh: Could not resolve hostname h", "Network is unreachable", "Connection timed out"]) {
      expect(classifySshResult({ code: 255, stdout: "", stderr: line, timedOut: false })).toBe("unreachable");
    }
  });
  it("maps our own kill to timeout", () => {
    expect(classifySshResult({ code: null, stdout: "", stderr: "", timedOut: true })).toBe("timeout");
  });
  it("maps a strict unknown host to host-key-unknown when ssh reports it", () => {
    expect(classifySshResult({ code: 255, stdout: "", stderr: "No ECDSA host key is known for h and you have requested strict checking.\r\nHost key verification failed.", timedOut: false })).toBe("host-key-unknown");
  });
  it("falls back to error", () => {
    expect(classifySshResult({ code: 1, stdout: "", stderr: "something else", timedOut: false })).toBe("error");
  });
});

describe("sanitizeSshStderr", () => {
  it("removes redactions, collapses whitespace and caps length", () => {
    const out = sanitizeSshStderr("bad /tmp/secret-1 thing\n\n  more  ", ["/tmp/secret-1"]);
    expect(out).toBe("bad [redacted] thing more");
    expect(sanitizeSshStderr("x".repeat(900), []).length).toBe(500);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `bun run --cwd apps/server test -- servers/sshOutcome.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `sshOutcome.ts`**

```ts
// apps/server/src/servers/sshOutcome.ts
import type { ServerTestOutcome } from "@synara/contracts";

export interface RawSshResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

export function classifySshResult(raw: RawSshResult): ServerTestOutcome {
  if (raw.timedOut) return "timeout";
  if (raw.code === 0) return "ok";
  const err = raw.stderr;
  if (/REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(err)) return "host-key-changed";
  if (/host key is known for|Host key verification failed/i.test(err)) return "host-key-unknown";
  if (/Permission denied|Too many authentication failures|no supported authentication methods/i.test(err)) return "auth-failed";
  if (/Connection refused|Could not resolve|Network is unreachable|Connection timed out|No route to host|Name or service not known|nodename nor servname/i.test(err)) return "unreachable";
  return "error";
}

const MAX_MESSAGE_LENGTH = 500;

export function sanitizeSshStderr(stderr: string, redactions: ReadonlyArray<string>): string {
  let text = stderr;
  for (const redaction of redactions) {
    if (redaction.length > 0) text = text.split(redaction).join("[redacted]");
  }
  return text.replace(/\s+/g, " ").trim().slice(0, MAX_MESSAGE_LENGTH);
}
```

- [ ] **Step 4: Write the failing runner test with a fixture ssh script**

```ts
// apps/server/src/servers/SshRunner.test.ts
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ServerId, type ServerRecord } from "@synara/contracts";
import { Effect, Layer } from "effect";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ServerConfig } from "../config";
import { ServerSecretStoreLive } from "../auth/Layers/ServerSecretStore";
import { SshRunner, makeSshRunnerLayer } from "./SshRunner";

const isWindows = process.platform === "win32";
let fixtureDir: string;
let fakeSsh: string;
let captureFile: string;

// The fake ssh records its argv and, when DJL_SSH_SECRET_FILE is set, the secret the
// askpass helper would print; it exits per the FAKE_SSH_MODE env variable.
beforeAll(() => {
  fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "djl-ssh-runner-"));
  captureFile = path.join(fixtureDir, "capture.json");
  fakeSsh = path.join(fixtureDir, isWindows ? "fake-ssh.cmd" : "fake-ssh");
  const script = isWindows
    ? `@echo off\r\n(echo {"args":"%*","secretFile":"%DJL_SSH_SECRET_FILE%","askpass":"%SSH_ASKPASS%"}) > "${captureFile}"\r\nif "%FAKE_SSH_MODE%"=="denied" (echo Permission denied 1>&2 & exit /b 255)\r\nif "%FAKE_SSH_MODE%"=="hang" (ping -n 60 127.0.0.1 > nul)\r\necho stdout-ok\r\nexit /b 0\r\n`
    : `#!/bin/sh
secret=""
if [ -n "$DJL_SSH_SECRET_FILE" ]; then secret=$("$SSH_ASKPASS"); fi
printf '{"args":%s,"secret":"%s","secretFileExisted":%s}' "$(printf '%s\\n' "$@" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read().split("\\n")[:-1]))')" "$secret" "$([ -n "$DJL_SSH_SECRET_FILE" ] && [ -f "$DJL_SSH_SECRET_FILE" ] && echo true || echo false)" > "${captureFile}"
case "$FAKE_SSH_MODE" in
  denied) echo "Permission denied (publickey)." >&2; exit 255 ;;
  hang) sleep 60 ;;
esac
echo stdout-ok
exit 0
`;
  fs.writeFileSync(fakeSsh, script, { mode: 0o755 });
});

afterAll(() => {
  fs.rmSync(fixtureDir, { recursive: true, force: true });
});

const server = (auth: ServerRecord["auth"]): ServerRecord => ({
  id: ServerId.makeUnsafe("srv-1"), name: "n", host: "203.0.113.10", port: 22, username: "u",
  auth, tags: [], permissionTier: "read-only", notes: "", source: "manual", createdAt: 1, updatedAt: 1,
});

const makeLayer = () =>
  makeSshRunnerLayer({ sshCommand: fakeSsh }).pipe(
    Layer.provideMerge(ServerSecretStoreLive),
    Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "djl-ssh-runner-test-" })),
    Layer.provide(NodeServices.layer),
  );

const run = <A>(effect: Effect.Effect<A, unknown, SshRunner>) =>
  effect.pipe(Effect.provide(makeLayer()), Effect.scoped, Effect.runPromise);

const readCapture = () => JSON.parse(fs.readFileSync(captureFile, "utf8")) as {
  args: string[] | string; secret?: string; secretFileExisted?: boolean; secretFile?: string;
};

describe("SshRunner", () => {
  it("runs the command and returns stdout on success", async () => {
    process.env.FAKE_SSH_MODE = "ok";
    const result = await run(Effect.flatMap(SshRunner, (r) => r.run({ server: server({ type: "agent" }), command: "echo ok", secret: null })));
    expect(result.outcome).toBe("ok");
    expect(result.stdout.trim()).toBe("stdout-ok");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    const capture = readCapture();
    expect(JSON.stringify(capture.args)).toContain("StrictHostKeyChecking=yes");
  });

  it.skipIf(isWindows)("delivers a password through askpass and deletes the secret file afterwards", async () => {
    process.env.FAKE_SSH_MODE = "ok";
    const result = await run(Effect.flatMap(SshRunner, (r) => r.run({ server: server({ type: "password" }), command: "true", secret: "hunter2" })));
    expect(result.outcome).toBe("ok");
    const capture = readCapture();
    expect(capture.secret).toBe("hunter2");
    expect(capture.secretFileExisted).toBe(true);
    expect(JSON.stringify(capture.args)).not.toContain("hunter2");
    // The askpass directory must be empty once the run completes.
    const runner = await run(Effect.map(SshRunner, (r) => r));
    const askpassDir = path.join(path.dirname(runner.djlKnownHostsPath), "askpass");
    expect(fs.existsSync(askpassDir) ? fs.readdirSync(askpassDir) : []).toEqual([]);
  });

  it("classifies a denied login and sanitizes the message", async () => {
    process.env.FAKE_SSH_MODE = "denied";
    const result = await run(Effect.flatMap(SshRunner, (r) => r.run({ server: server({ type: "agent" }), command: "true", secret: null })));
    expect(result.outcome).toBe("auth-failed");
    expect(result.message).toContain("Permission denied");
  });

  it("kills a hanging ssh and reports timeout", async () => {
    process.env.FAKE_SSH_MODE = "hang";
    const result = await run(Effect.flatMap(SshRunner, (r) => r.run({ server: server({ type: "agent" }), command: "true", secret: null, timeoutMs: 500 })));
    expect(result.outcome).toBe("timeout");
  }, 10_000);

  it("reports capabilities from ssh -V", async () => {
    const capabilities = await run(Effect.flatMap(SshRunner, (r) => r.capabilities()));
    expect(typeof capabilities.askpassSupported).toBe("boolean");
  });
});
```

- [ ] **Step 5: Run and confirm failure**

Run: `bun run --cwd apps/server test -- servers/SshRunner.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 6: Implement `SshRunner.ts`**

```ts
// apps/server/src/servers/SshRunner.ts
// FILE: SshRunner.ts
// Purpose: Runs one command on a registered server through the system OpenSSH client.
//          Secrets reach ssh via SSH_ASKPASS reading a 0600 temp file that is always deleted.
// Layer: Servers runtime service
import type { ServerCapabilities, ServerRecord, ServerTestOutcome } from "@synara/contracts";
import * as Crypto from "node:crypto";
import * as os from "node:os";
import { Data, Effect, FileSystem, Layer, Path, ServiceMap } from "effect";

import { ServerSecretStore } from "../auth/Services/ServerSecretStore";
import { ServerConfig } from "../config";
import { runProcess } from "../processRunner";
import { serverSecretName } from "./secrets";
import { buildSshArgs, buildSshEnv } from "./sshArgs";
import { classifySshResult, sanitizeSshStderr } from "./sshOutcome";

export class SshRunnerError extends Data.TaggedError("SshRunnerError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface SshRunResult {
  readonly outcome: ServerTestOutcome;
  readonly stdout: string;
  readonly message: string | undefined;
  readonly latencyMs: number;
}

export interface SshRunInput {
  readonly server: ServerRecord;
  readonly command: string;
  readonly secret: string | null;
  readonly timeoutMs?: number;
}

export interface SshRunnerShape {
  readonly run: (input: SshRunInput) => Effect.Effect<SshRunResult, SshRunnerError>;
  readonly capabilities: () => Effect.Effect<ServerCapabilities>;
  readonly knownHostsFiles: ReadonlyArray<string>;
  readonly djlKnownHostsPath: string;
  readonly sshCommand: string;
}

export class SshRunner extends ServiceMap.Service<SshRunner, SshRunnerShape>()("synara/servers/SshRunner") {}

const DEFAULT_TIMEOUT_MS = 20_000;
const isWindows = process.platform === "win32";

export function defaultSshCommand(): string {
  if (process.env.DJL_SSH_COMMAND) return process.env.DJL_SSH_COMMAND;
  if (isWindows) {
    const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
    return `${systemRoot}\\System32\\OpenSSH\\ssh.exe`;
  }
  return "ssh";
}

export function parseSshVersion(banner: string): string | null {
  const match = /OpenSSH[_ ]([0-9]+\.[0-9]+)/i.exec(banner);
  return match ? match[1] : null;
}

export function askpassSupportedForVersion(version: string | null): boolean {
  if (!version) return false;
  const [major, minor] = version.split(".").map(Number);
  return major > 8 || (major === 8 && minor >= 4);
}

const POSIX_HELPER = `#!/bin/sh\ncat "$DJL_SSH_SECRET_FILE"\n`;
const WINDOWS_HELPER = `@echo off\r\ntype "%DJL_SSH_SECRET_FILE%"\r\n`;

export const makeSshRunner = (options: { sshCommand?: string } = {}) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const config = yield* ServerConfig;
    const secretStore = yield* ServerSecretStore;

    const sshCommand = options.sshCommand ?? defaultSshCommand();
    const sshDir = path.join(config.stateDir, "ssh");
    const askpassDir = path.join(sshDir, "askpass");
    const helperPath = path.join(sshDir, isWindows ? "djl-askpass.cmd" : "djl-askpass");
    const djlKnownHostsPath = path.join(sshDir, "known_hosts");
    const userKnownHostsPath = path.join(os.homedir(), ".ssh", "known_hosts");
    const knownHostsFiles = [djlKnownHostsPath, userKnownHostsPath];

    const ioError = (message: string) => (cause: unknown) => new SshRunnerError({ message, cause });

    yield* fileSystem.makeDirectory(askpassDir, { recursive: true }).pipe(Effect.mapError(ioError("Failed to create ssh state directory.")));
    yield* fileSystem.chmod(sshDir, 0o700).pipe(Effect.orElseSucceed(() => undefined));
    yield* fileSystem.chmod(askpassDir, 0o700).pipe(Effect.orElseSucceed(() => undefined));
    yield* fileSystem.writeFileString(helperPath, isWindows ? WINDOWS_HELPER : POSIX_HELPER).pipe(Effect.mapError(ioError("Failed to write askpass helper.")));
    yield* fileSystem.chmod(helperPath, 0o700).pipe(Effect.orElseSucceed(() => undefined));
    const knownHostsExists = yield* fileSystem.exists(djlKnownHostsPath).pipe(Effect.orElseSucceed(() => false));
    if (!knownHostsExists) {
      yield* fileSystem.writeFileString(djlKnownHostsPath, "").pipe(Effect.mapError(ioError("Failed to create known_hosts.")));
      yield* fileSystem.chmod(djlKnownHostsPath, 0o600).pipe(Effect.orElseSucceed(() => undefined));
    }

    const writeSecretFile = (secret: string) =>
      Effect.gen(function* () {
        const secretFilePath = path.join(askpassDir, `${Crypto.randomUUID()}.secret`);
        yield* fileSystem.writeFileString(secretFilePath, secret).pipe(Effect.mapError(ioError("Failed to stage askpass secret.")));
        yield* fileSystem.chmod(secretFilePath, 0o600).pipe(Effect.orElseSucceed(() => undefined));
        return secretFilePath;
      });

    const removeSecretFile = (secretFilePath: string) =>
      fileSystem.remove(secretFilePath, { force: true }).pipe(Effect.ignore);

    const run: SshRunnerShape["run"] = (input) =>
      Effect.gen(function* () {
        const importedKeyPath =
          input.server.auth.type === "importedKey"
            ? secretStore.pathOf(serverSecretName(input.server.id, "privateKey"))
            : null;
        const plan = buildSshArgs({
          server: input.server,
          command: input.command,
          knownHostsFiles,
          importedKeyPath,
        });
        if (plan.needsAskpass && input.secret === null) {
          return {
            outcome: "auth-failed" as const,
            stdout: "",
            message: "This server needs a stored password or passphrase, but none is saved.",
            latencyMs: 0,
          };
        }
        const secretFilePath = plan.needsAskpass && input.secret !== null ? yield* writeSecretFile(input.secret) : null;
        const env = buildSshEnv(process.env, secretFilePath ? { helperPath, secretFilePath } : null);
        const started = Date.now();
        const raw = yield* Effect.tryPromise({
          try: () =>
            runProcess(sshCommand, plan.args, {
              env,
              timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
              allowNonZeroExit: true,
              maxBufferBytes: 1024 * 1024,
              outputMode: "truncate",
            }),
          catch: (cause) => new SshRunnerError({ message: "Failed to start ssh.", cause }),
        }).pipe(Effect.ensuring(secretFilePath ? removeSecretFile(secretFilePath) : Effect.void));
        const latencyMs = Date.now() - started;
        const outcome = classifySshResult(raw);
        const redactions = [secretFilePath ?? "", input.secret ?? ""];
        const message = outcome === "ok" ? undefined : sanitizeSshStderr(raw.stderr || (raw.timedOut ? "Timed out." : ""), redactions) || undefined;
        return { outcome, stdout: raw.stdout, message, latencyMs };
      });

    const capabilities: SshRunnerShape["capabilities"] = () =>
      Effect.tryPromise(() => runProcess(sshCommand, ["-V"], { timeoutMs: 5_000, allowNonZeroExit: true })).pipe(
        Effect.map((result) => {
          const version = parseSshVersion(`${result.stderr}\n${result.stdout}`);
          return {
            sshPath: sshCommand,
            sshVersion: version,
            askpassSupported: isWindows ? askpassSupportedForVersion(version) : version !== null,
          } satisfies ServerCapabilities;
        }),
        Effect.orElseSucceed(() => ({ sshPath: null, sshVersion: null, askpassSupported: false })),
      );

    return { run, capabilities, knownHostsFiles, djlKnownHostsPath, sshCommand } satisfies SshRunnerShape;
  });

export const makeSshRunnerLayer = (options: { sshCommand?: string } = {}) =>
  Layer.effect(SshRunner, makeSshRunner(options));

export const SshRunnerLive = makeSshRunnerLayer();
```

Notes for the implementer: `Effect.tryPromise` with `Effect.ensuring` guarantees the secret file is removed on success, failure, and interruption. `runProcess` with `allowNonZeroExit: true` resolves instead of rejecting on exit 255; confirm by reading `apps/server/src/processRunner.ts:126-220`. If `FileSystem.writeFileString` is not available in the pinned Effect version, use `fileSystem.writeFile(path, new TextEncoder().encode(text))`.

- [ ] **Step 7: Run both tests**

Run: `bun run --cwd apps/server test -- servers/sshOutcome.test.ts servers/SshRunner.test.ts`
Expected: PASS. The askpass test is skipped on Windows.

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/servers
git commit -m "feat(server): SshRunner with askpass secret delivery and outcome mapping

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Host key helpers

**Files:**
- Create: `apps/server/src/servers/knownHosts.ts`
- Test: `apps/server/src/servers/knownHosts.test.ts`

**Interfaces:**

```ts
export function hostPattern(host: string, port: number): string;             // "h" for 22, "[h]:2222" otherwise
export function fingerprintOfKeyLine(line: string): { type: string; fingerprint: string } | null;  // "SHA256:<base64 no padding>"
export interface KnownHostsShape {
  readonly isKnown: (host: string, port: number) => Effect<boolean, SshRunnerError>;          // ssh-keygen -F across both files
  readonly scan: (host: string, port: number) => Effect<ReadonlyArray<string>, SshRunnerError>;  // ssh-keyscan lines (non-comment)
  readonly trust: (lines: ReadonlyArray<string>) => Effect<void, SshRunnerError>;           // append to DJL known_hosts
  readonly forget: (host: string, port: number) => Effect<void, SshRunnerError>;            // ssh-keygen -R on DJL file only
}
export const makeKnownHosts: (input: { sshCommand: string; knownHostsFiles: ReadonlyArray<string>; djlKnownHostsPath: string }) => Effect<KnownHostsShape, never, FileSystem>;
```

The `ssh-keygen` and `ssh-keyscan` binaries are resolved as siblings of `sshCommand` when it is an absolute path, otherwise by bare name; override with `DJL_SSH_KEYGEN_COMMAND` / `DJL_SSH_KEYSCAN_COMMAND` for tests.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/server/src/servers/knownHosts.test.ts
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect } from "effect";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { fingerprintOfKeyLine, hostPattern, makeKnownHosts } from "./knownHosts";

// Real ed25519 public key; fingerprint verified with `ssh-keygen -lf`.
const KEY_LINE = "203.0.113.10 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBl9dS4A9c2tVw9hVHCnXH0d8Q+2wq3o0y2TjCJXk5vQ";

describe("hostPattern", () => {
  it("formats default and non-default ports", () => {
    expect(hostPattern("h", 22)).toBe("h");
    expect(hostPattern("h", 2222)).toBe("[h]:2222");
  });
});

describe("fingerprintOfKeyLine", () => {
  it("computes the SHA256 fingerprint OpenSSH prints", () => {
    const parsed = fingerprintOfKeyLine(KEY_LINE);
    expect(parsed?.type).toBe("ssh-ed25519");
    expect(parsed?.fingerprint).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/);
  });
  it("ignores comments and garbage", () => {
    expect(fingerprintOfKeyLine("# comment")).toBeNull();
    expect(fingerprintOfKeyLine("nonsense")).toBeNull();
  });
});

describe("makeKnownHosts with fixtures", () => {
  let dir: string;
  let keygen: string;
  let keyscan: string;
  const isWindows = process.platform === "win32";

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "djl-known-hosts-"));
    keygen = path.join(dir, "fake-keygen");
    keyscan = path.join(dir, "fake-keyscan");
    // fake ssh-keygen: -F <pattern> -f <file> => exit 0 if the file contains the pattern; -R removes matching lines.
    fs.writeFileSync(keygen, `#!/bin/sh
mode=$1; pattern=$2; file=$4
case "$mode" in
  -F) grep -q "^$pattern " "$file" ;;
  -R) grep -v "^$pattern " "$file" > "$file.tmp"; mv "$file.tmp" "$file" ;;
esac
`, { mode: 0o755 });
    fs.writeFileSync(keyscan, `#!/bin/sh\necho "# comment"\necho "${KEY_LINE}"\n`, { mode: 0o755 });
    process.env.DJL_SSH_KEYGEN_COMMAND = keygen;
    process.env.DJL_SSH_KEYSCAN_COMMAND = keyscan;
  });

  afterAll(() => {
    delete process.env.DJL_SSH_KEYGEN_COMMAND;
    delete process.env.DJL_SSH_KEYSCAN_COMMAND;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it.skipIf(isWindows)("scans, trusts, recognizes and forgets a host", async () => {
    const djl = path.join(dir, "known_hosts");
    fs.writeFileSync(djl, "");
    const user = path.join(dir, "user_known_hosts");
    fs.writeFileSync(user, "");
    const program = Effect.gen(function* () {
      const kh = yield* makeKnownHosts({ sshCommand: "ssh", knownHostsFiles: [djl, user], djlKnownHostsPath: djl });
      expect(yield* kh.isKnown("203.0.113.10", 22)).toBe(false);
      const lines = yield* kh.scan("203.0.113.10", 22);
      expect(lines).toEqual([KEY_LINE]);
      yield* kh.trust(lines);
      expect(fs.readFileSync(djl, "utf8")).toContain(KEY_LINE);
      expect(yield* kh.isKnown("203.0.113.10", 22)).toBe(true);
      yield* kh.forget("203.0.113.10", 22);
      expect(yield* kh.isKnown("203.0.113.10", 22)).toBe(false);
    });
    await Effect.runPromise(program.pipe(Effect.provide(NodeServices.layer)));
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `bun run --cwd apps/server test -- servers/knownHosts.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// apps/server/src/servers/knownHosts.ts
// FILE: knownHosts.ts
// Purpose: Explicit host-key trust for registered servers via ssh-keygen/ssh-keyscan.
// Layer: Servers domain helpers
import * as Crypto from "node:crypto";
import * as nodePath from "node:path";
import { Effect, FileSystem } from "effect";

import { runProcess } from "../processRunner";
import { SshRunnerError } from "./SshRunner";

export function hostPattern(host: string, port: number): string {
  return port === 22 ? host : `[${host}]:${port}`;
}

export function fingerprintOfKeyLine(line: string): { type: string; fingerprint: string } | null {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.startsWith("#")) return null;
  const parts = trimmed.split(/\s+/);
  if (parts.length < 3) return null;
  const [, type, base64] = parts;
  if (!/^(ssh-|ecdsa-|sk-)/.test(type)) return null;
  let blob: Buffer;
  try {
    blob = Buffer.from(base64, "base64");
  } catch {
    return null;
  }
  if (blob.length === 0) return null;
  const digest = Crypto.createHash("sha256").update(blob).digest("base64").replace(/=+$/, "");
  return { type, fingerprint: `SHA256:${digest}` };
}

function siblingTool(sshCommand: string, tool: string): string {
  const override = process.env[`DJL_SSH_${tool.toUpperCase().replace("SSH-", "")}_COMMAND`];
  if (override) return override;
  if (nodePath.isAbsolute(sshCommand)) {
    const ext = process.platform === "win32" ? ".exe" : "";
    return nodePath.join(nodePath.dirname(sshCommand), `${tool}${ext}`);
  }
  return tool;
}

export interface KnownHostsShape {
  readonly isKnown: (host: string, port: number) => Effect.Effect<boolean, SshRunnerError>;
  readonly scan: (host: string, port: number) => Effect.Effect<ReadonlyArray<string>, SshRunnerError>;
  readonly trust: (lines: ReadonlyArray<string>) => Effect.Effect<void, SshRunnerError>;
  readonly forget: (host: string, port: number) => Effect.Effect<void, SshRunnerError>;
}

export const makeKnownHosts = (input: {
  sshCommand: string;
  knownHostsFiles: ReadonlyArray<string>;
  djlKnownHostsPath: string;
}) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const keygen = process.env.DJL_SSH_KEYGEN_COMMAND ?? siblingTool(input.sshCommand, "ssh-keygen");
    const keyscan = process.env.DJL_SSH_KEYSCAN_COMMAND ?? siblingTool(input.sshCommand, "ssh-keyscan");

    const exec = (command: string, args: string[], timeoutMs: number) =>
      Effect.tryPromise({
        try: () => runProcess(command, args, { timeoutMs, allowNonZeroExit: true, outputMode: "truncate" }),
        catch: (cause) => new SshRunnerError({ message: `Failed to run ${command}.`, cause }),
      });

    const isKnown: KnownHostsShape["isKnown"] = (host, port) =>
      Effect.gen(function* () {
        const pattern = hostPattern(host, port);
        for (const file of input.knownHostsFiles) {
          const exists = yield* fileSystem.exists(file).pipe(Effect.orElseSucceed(() => false));
          if (!exists) continue;
          const result = yield* exec(keygen, ["-F", pattern, "-f", file], 5_000);
          if (result.code === 0 && result.stdout.trim().length > 0) return true;
          if (result.code === 0 && process.env.DJL_SSH_KEYGEN_COMMAND) return true; // fixture prints nothing
        }
        return false;
      });

    const scan: KnownHostsShape["scan"] = (host, port) =>
      exec(keyscan, ["-p", String(port), "-T", "5", "--", host], 10_000).pipe(
        Effect.map((result) =>
          result.stdout
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line.length > 0 && !line.startsWith("#")),
        ),
      );

    const trust: KnownHostsShape["trust"] = (lines) =>
      Effect.gen(function* () {
        const existing = yield* fileSystem.readFileString(input.djlKnownHostsPath).pipe(Effect.orElseSucceed(() => ""));
        const prefix = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
        yield* fileSystem
          .writeFileString(input.djlKnownHostsPath, `${existing}${prefix}${lines.join("\n")}\n`)
          .pipe(Effect.mapError((cause) => new SshRunnerError({ message: "Failed to write known_hosts.", cause })));
        yield* fileSystem.chmod(input.djlKnownHostsPath, 0o600).pipe(Effect.orElseSucceed(() => undefined));
      });

    const forget: KnownHostsShape["forget"] = (host, port) =>
      exec(keygen, ["-R", hostPattern(host, port), "-f", input.djlKnownHostsPath], 5_000).pipe(Effect.asVoid);

    return { isKnown, scan, trust, forget } satisfies KnownHostsShape;
  });
```

Replace the fixture-only branch in `isKnown` (the line mentioning `DJL_SSH_KEYGEN_COMMAND`) by making the fixture print the matched line: change the fake keygen's `-F` case to `grep "^$pattern " "$file"` (no `-q`) and delete that branch. Do not ship the fixture-only branch.

- [ ] **Step 4: Run tests**

Run: `bun run --cwd apps/server test -- servers/knownHosts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/servers/knownHosts.ts apps/server/src/servers/knownHosts.test.ts
git commit -m "feat(server): known_hosts trust helpers with SHA256 fingerprints

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Stats command and parser

**Files:**
- Create: `apps/server/src/servers/stats.ts`
- Test: `apps/server/src/servers/stats.test.ts`

**Interfaces:**

```ts
export const STATS_COMMAND: string;                       // one POSIX sh line
export function parseStatsOutput(stdout: string, collectedAt: number): ServerStats;
```

- [ ] **Step 1: Write the failing tests**

```ts
// apps/server/src/servers/stats.test.ts
import { describe, expect, it } from "vitest";
import { STATS_COMMAND, parseStatsOutput } from "./stats";

const linux = `@@hostname
web-1
@@uname
Linux 6.8.0-45-generic
@@os
PRETTY_NAME="Ubuntu 24.04.1 LTS"
@@uptime
123456.78 400000.00
@@loadavg
0.42 0.35 0.30 1/512 12345
@@meminfo
MemTotal:        8123456 kB
MemAvailable:    5123456 kB
@@df
/dev/vda1 40000000 12345678 27654322 31% /
@@bsd_boottime
@@bsd_loadavg
`;

const macos = `@@hostname
studio.local
@@uname
Darwin 24.6.0
@@os
@@uptime
@@loadavg
@@meminfo
@@df
/dev/disk3s1s1 971350180 10485760 400000000 3% /
@@bsd_boottime
{ sec = 1700000000, usec = 0 } Tue Nov 14 22:13:20 2023
@@bsd_loadavg
{ 1.23 1.45 1.50 }
`;

describe("parseStatsOutput", () => {
  it("parses a Linux host", () => {
    const stats = parseStatsOutput(linux, 1_000_000);
    expect(stats.hostname).toBe("web-1");
    expect(stats.kernel).toBe("Linux 6.8.0-45-generic");
    expect(stats.os).toBe("Ubuntu 24.04.1 LTS");
    expect(stats.uptimeSeconds).toBe(123456);
    expect(stats.load).toEqual({ one: 0.42, five: 0.35, fifteen: 0.3 });
    expect(stats.memory).toEqual({ totalBytes: 8123456 * 1024, usedBytes: (8123456 - 5123456) * 1024 });
    expect(stats.disk).toEqual({ totalBytes: 40000000 * 1024, usedBytes: 12345678 * 1024, mountPoint: "/" });
    expect(stats.collectedAt).toBe(1_000_000);
  });

  it("parses a macOS host and degrades missing fields", () => {
    const now = 1_700_100_000_000;
    const stats = parseStatsOutput(macos, now);
    expect(stats.hostname).toBe("studio.local");
    expect(stats.os).toBeUndefined();
    expect(stats.memory).toBeUndefined();
    expect(stats.uptimeSeconds).toBe(100000);
    expect(stats.load).toEqual({ one: 1.23, five: 1.45, fifteen: 1.5 });
    expect(stats.disk?.mountPoint).toBe("/");
  });

  it("survives garbage", () => {
    const stats = parseStatsOutput("not the output you expect", 5);
    expect(stats).toEqual({ collectedAt: 5 });
  });

  it("uses only POSIX tools in the command", () => {
    expect(STATS_COMMAND).not.toMatch(/\b(bash|jq|python)\b/);
    expect(STATS_COMMAND).toContain("@@df");
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `bun run --cwd apps/server test -- servers/stats.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// apps/server/src/servers/stats.ts
// FILE: stats.ts
// Purpose: Single remote command for basic host stats plus a tolerant parser.
// Layer: Servers domain helpers
import type { ServerStats } from "@synara/contracts";

const section = (name: string, body: string) => `printf '@@${name}\\n'; ${body} 2>/dev/null;`;

export const STATS_COMMAND = [
  section("hostname", "hostname"),
  section("uname", "uname -sr"),
  section("os", "grep ^PRETTY_NAME= /etc/os-release"),
  section("uptime", "cat /proc/uptime"),
  section("loadavg", "cat /proc/loadavg"),
  section("meminfo", "grep -E '^(MemTotal|MemAvailable):' /proc/meminfo"),
  section("df", "df -Pk / | tail -1"),
  section("bsd_boottime", "sysctl -n kern.boottime"),
  section("bsd_loadavg", "sysctl -n vm.loadavg"),
  "true",
].join(" ");

function splitSections(stdout: string): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  let current: string | null = null;
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (line.startsWith("@@")) {
      current = line.slice(2).trim();
      sections.set(current, []);
      continue;
    }
    if (current !== null && line.trim().length > 0) sections.get(current)?.push(line.trim());
  }
  return sections;
}

const num = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export function parseStatsOutput(stdout: string, collectedAt: number): ServerStats {
  const sections = splitSections(stdout);
  const first = (name: string) => sections.get(name)?.[0];
  const stats: { -readonly [K in keyof ServerStats]: ServerStats[K] } = { collectedAt };

  const hostname = first("hostname");
  if (hostname) stats.hostname = hostname;
  const kernel = first("uname");
  if (kernel) stats.kernel = kernel;
  const osLine = first("os");
  const osMatch = osLine ? /^PRETTY_NAME="?([^"]*)"?$/.exec(osLine) : null;
  if (osMatch?.[1]) stats.os = osMatch[1];

  const uptime = num(first("uptime")?.split(/\s+/)[0]);
  if (uptime !== undefined) stats.uptimeSeconds = Math.floor(uptime);
  else {
    const boot = /sec\s*=\s*(\d+)/.exec(first("bsd_boottime") ?? "");
    if (boot) stats.uptimeSeconds = Math.max(0, Math.floor(collectedAt / 1000) - Number(boot[1]));
  }

  const loadParts = first("loadavg")?.split(/\s+/) ?? [];
  const bsdLoad = /\{\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\}/.exec(first("bsd_loadavg") ?? "");
  const load = loadParts.length >= 3 ? loadParts : bsdLoad ? [bsdLoad[1], bsdLoad[2], bsdLoad[3]] : null;
  if (load) {
    const [one, five, fifteen] = [num(load[0]), num(load[1]), num(load[2])];
    if (one !== undefined && five !== undefined && fifteen !== undefined) stats.load = { one, five, fifteen };
  }

  const mem = new Map<string, number>();
  for (const line of sections.get("meminfo") ?? []) {
    const match = /^(MemTotal|MemAvailable):\s+(\d+)\s*kB$/.exec(line);
    if (match) mem.set(match[1], Number(match[2]) * 1024);
  }
  const memTotal = mem.get("MemTotal");
  const memAvailable = mem.get("MemAvailable");
  if (memTotal !== undefined && memAvailable !== undefined) {
    stats.memory = { totalBytes: memTotal, usedBytes: Math.max(0, memTotal - memAvailable) };
  }

  const df = first("df")?.split(/\s+/);
  if (df && df.length >= 6) {
    const total = num(df[1]);
    const used = num(df[2]);
    if (total !== undefined && used !== undefined) {
      stats.disk = { totalBytes: total * 1024, usedBytes: used * 1024, mountPoint: df[df.length - 1] };
    }
  }

  return stats;
}
```

- [ ] **Step 4: Run tests**

Run: `bun run --cwd apps/server test -- servers/stats.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/servers/stats.ts apps/server/src/servers/stats.test.ts
git commit -m "feat(server): remote stats command and parser

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: SSH config import and local key discovery

**Files:**
- Create: `apps/server/src/servers/sshConfigImport.ts`
- Create: `apps/server/src/servers/localKeys.ts`
- Test: `apps/server/src/servers/sshConfigImport.test.ts`
- Test: `apps/server/src/servers/localKeys.test.ts`

**Interfaces:**

```ts
// sshConfigImport.ts
export interface ParsedSshHost { alias: string; hostName: string; port: number; user?: string; identityFile?: string }
export function parseSshConfig(text: string): { hosts: ParsedSshHost[]; includes: string[] };   // pure; wildcard/negated Host patterns skipped
export function expandHomePath(input: string, homeDir: string): string;                          // "~/x" -> "<home>/x"
export const readSshConfigHosts: (homeDir: string) => Effect<{ configPath: string; hosts: ParsedSshHost[] }, never, FileSystem | Path>;  // reads ~/.ssh/config + one level of Include (glob on basename `*` only)

// localKeys.ts
export const listLocalPrivateKeys: (homeDir: string) => Effect<ReadonlyArray<{ path: string; label: string }>, never, FileSystem | Path>;
// Lists files in ~/.ssh whose first line starts with "-----BEGIN" and name does not end in ".pub"; label is the basename.
```

- [ ] **Step 1: Write the failing tests**

```ts
// apps/server/src/servers/sshConfigImport.test.ts
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect } from "effect";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { expandHomePath, parseSshConfig, readSshConfigHosts } from "./sshConfigImport";

describe("parseSshConfig", () => {
  it("collects concrete hosts and skips wildcards and negations", () => {
    const parsed = parseSshConfig(`
# comment
Include conf.d/*
Host *
  ServerAliveInterval 30
Host hk web-1 !bad
  HostName 203.0.113.10
  Port 2222
  User deploy
  IdentityFile ~/.ssh/id_hk
Host plain
Host staging.*
  HostName ignored
`);
    expect(parsed.includes).toEqual(["conf.d/*"]);
    expect(parsed.hosts).toEqual([
      { alias: "hk", hostName: "203.0.113.10", port: 2222, user: "deploy", identityFile: "~/.ssh/id_hk" },
      { alias: "web-1", hostName: "203.0.113.10", port: 2222, user: "deploy", identityFile: "~/.ssh/id_hk" },
      { alias: "plain", hostName: "plain", port: 22 },
    ]);
  });

  it("is case-insensitive on keywords and accepts key=value", () => {
    const parsed = parseSshConfig("host a\n  hostname=1.2.3.4\n  PORT 22\n");
    expect(parsed.hosts[0]).toEqual({ alias: "a", hostName: "1.2.3.4", port: 22 });
  });
});

describe("expandHomePath", () => {
  it("expands ~ only at the start", () => {
    expect(expandHomePath("~/.ssh/id", "/home/me")).toBe(path.join("/home/me", ".ssh/id"));
    expect(expandHomePath("/abs/~x", "/home/me")).toBe("/abs/~x");
  });
});

describe("readSshConfigHosts", () => {
  let home: string;
  beforeAll(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "djl-ssh-home-"));
    fs.mkdirSync(path.join(home, ".ssh", "conf.d"), { recursive: true });
    fs.writeFileSync(path.join(home, ".ssh", "config"), "Include conf.d/*.conf\nHost main\n  HostName 10.0.0.1\n");
    fs.writeFileSync(path.join(home, ".ssh", "conf.d", "work.conf"), "Host work\n  HostName 10.0.0.2\n  User w\n");
    fs.writeFileSync(path.join(home, ".ssh", "conf.d", "ignored.txt"), "Host nope\n");
  });
  afterAll(() => fs.rmSync(home, { recursive: true, force: true }));

  it("reads the main file and one level of includes", async () => {
    const result = await Effect.runPromise(readSshConfigHosts(home).pipe(Effect.provide(NodeServices.layer)));
    expect(result.configPath).toBe(path.join(home, ".ssh", "config"));
    expect(result.hosts.map((h) => h.alias).toSorted()).toEqual(["main", "work"]);
  });

  it("returns no hosts when the config is missing", async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "djl-ssh-empty-"));
    const result = await Effect.runPromise(readSshConfigHosts(empty).pipe(Effect.provide(NodeServices.layer)));
    expect(result.hosts).toEqual([]);
    fs.rmSync(empty, { recursive: true, force: true });
  });
});
```

```ts
// apps/server/src/servers/localKeys.test.ts
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect } from "effect";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { listLocalPrivateKeys } from "./localKeys";

describe("listLocalPrivateKeys", () => {
  let home: string;
  beforeAll(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "djl-keys-home-"));
    const sshDir = path.join(home, ".ssh");
    fs.mkdirSync(sshDir);
    fs.writeFileSync(path.join(sshDir, "id_ed25519"), "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n");
    fs.writeFileSync(path.join(sshDir, "id_ed25519.pub"), "ssh-ed25519 AAAA");
    fs.writeFileSync(path.join(sshDir, "config"), "Host x\n");
    fs.writeFileSync(path.join(sshDir, "known_hosts"), "");
    fs.writeFileSync(path.join(sshDir, "aliyun.pem"), "-----BEGIN RSA PRIVATE KEY-----\nxyz\n");
  });
  afterAll(() => fs.rmSync(home, { recursive: true, force: true }));

  it("lists only private key files", async () => {
    const keys = await Effect.runPromise(listLocalPrivateKeys(home).pipe(Effect.provide(NodeServices.layer)));
    expect(keys.map((k) => k.label).toSorted()).toEqual(["aliyun.pem", "id_ed25519"]);
    expect(keys.every((k) => path.isAbsolute(k.path))).toBe(true);
  });

  it("returns an empty list without a ~/.ssh directory", async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "djl-keys-empty-"));
    expect(await Effect.runPromise(listLocalPrivateKeys(empty).pipe(Effect.provide(NodeServices.layer)))).toEqual([]);
    fs.rmSync(empty, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `bun run --cwd apps/server test -- servers/sshConfigImport.test.ts servers/localKeys.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `sshConfigImport.ts`**

```ts
// apps/server/src/servers/sshConfigImport.ts
// FILE: sshConfigImport.ts
// Purpose: Read concrete Host entries from ~/.ssh/config for one-click import.
// Layer: Servers domain helpers
import { Effect, FileSystem, Path } from "effect";

export interface ParsedSshHost {
  readonly alias: string;
  readonly hostName: string;
  readonly port: number;
  readonly user?: string;
  readonly identityFile?: string;
}

const isConcreteAlias = (alias: string) => !/[*?!]/.test(alias);

export function parseSshConfig(text: string): { hosts: ParsedSshHost[]; includes: string[] } {
  const hosts: ParsedSshHost[] = [];
  const includes: string[] = [];
  let currentAliases: string[] = [];
  let current: { hostName?: string; port?: number; user?: string; identityFile?: string } = {};

  const flush = () => {
    for (const alias of currentAliases) {
      hosts.push({
        alias,
        hostName: current.hostName ?? alias,
        port: current.port ?? 22,
        ...(current.user ? { user: current.user } : {}),
        ...(current.identityFile ? { identityFile: current.identityFile } : {}),
      });
    }
    currentAliases = [];
    current = {};
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const match = /^(\S+?)(?:\s*=\s*|\s+)(.+)$/.exec(line);
    if (!match) continue;
    const keyword = match[1].toLowerCase();
    const value = match[2].trim();
    if (keyword === "include") {
      includes.push(...value.split(/\s+/));
      continue;
    }
    if (keyword === "host") {
      flush();
      currentAliases = value.split(/\s+/).filter(isConcreteAlias);
      continue;
    }
    if (keyword === "match") {
      flush();
      continue;
    }
    if (currentAliases.length === 0) continue;
    if (keyword === "hostname") current.hostName = value;
    else if (keyword === "port") {
      const port = Number(value);
      if (Number.isInteger(port) && port > 0 && port <= 65535) current.port = port;
    } else if (keyword === "user") current.user = value;
    else if (keyword === "identityfile" && current.identityFile === undefined) current.identityFile = value.replace(/^"|"$/g, "");
  }
  flush();
  return { hosts, includes };
}

export function expandHomePath(input: string, homeDir: string): string {
  if (input === "~") return homeDir;
  if (input.startsWith("~/")) return `${homeDir}${input.slice(1)}`.replace(/\//g, homeDir.includes("\\") ? "\\" : "/");
  return input;
}

export const readSshConfigHosts = (homeDir: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const sshDir = path.join(homeDir, ".ssh");
    const configPath = path.join(sshDir, "config");
    const readText = (file: string) => fileSystem.readFileString(file).pipe(Effect.orElseSucceed(() => null));

    const main = yield* readText(configPath);
    if (main === null) return { configPath, hosts: [] as ParsedSshHost[] };
    const parsed = parseSshConfig(main);
    const hosts: ParsedSshHost[] = [...parsed.hosts];

    for (const include of parsed.includes) {
      const expanded = expandHomePath(include, homeDir);
      const absolute = path.isAbsolute(expanded) ? expanded : path.join(sshDir, expanded);
      const dir = path.dirname(absolute);
      const base = path.basename(absolute);
      const entries = base.includes("*")
        ? yield* fileSystem.readDirectory(dir).pipe(Effect.orElseSucceed(() => [] as string[]))
        : [base];
      const pattern = new RegExp(`^${base.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
      for (const entry of entries) {
        if (!pattern.test(entry)) continue;
        const text = yield* readText(path.join(dir, entry));
        if (text !== null) hosts.push(...parseSshConfig(text).hosts);
      }
    }
    return { configPath, hosts };
  });
```

- [ ] **Step 4: Implement `localKeys.ts`**

```ts
// apps/server/src/servers/localKeys.ts
// FILE: localKeys.ts
// Purpose: Candidate private keys in ~/.ssh for the key-path picker.
// Layer: Servers domain helpers
import { Effect, FileSystem, Path } from "effect";

export const listLocalPrivateKeys = (homeDir: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const sshDir = path.join(homeDir, ".ssh");
    const entries = yield* fileSystem.readDirectory(sshDir).pipe(Effect.orElseSucceed(() => [] as string[]));
    const keys: Array<{ path: string; label: string }> = [];
    for (const entry of entries.toSorted()) {
      if (entry.endsWith(".pub") || entry === "config" || entry.startsWith("known_hosts") || entry === "authorized_keys") continue;
      const file = path.join(sshDir, entry);
      const info = yield* fileSystem.stat(file).pipe(Effect.orElseSucceed(() => null));
      if (!info || info.type !== "File") continue;
      const head = yield* fileSystem.readFileString(file).pipe(
        Effect.map((text) => text.slice(0, 64)),
        Effect.orElseSucceed(() => ""),
      );
      if (head.startsWith("-----BEGIN")) keys.push({ path: file, label: entry });
    }
    return keys;
  });
```

- [ ] **Step 5: Run tests**

Run: `bun run --cwd apps/server test -- servers/sshConfigImport.test.ts servers/localKeys.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/servers/sshConfigImport.ts apps/server/src/servers/sshConfigImport.test.ts apps/server/src/servers/localKeys.ts apps/server/src/servers/localKeys.test.ts
git commit -m "feat(server): ssh config import parser and local key discovery

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: ServerService, RPC handlers, layer wiring, web client

**Files:**
- Create: `apps/server/src/servers/Services/ServerService.ts`
- Create: `apps/server/src/servers/Layers/ServerService.ts`
- Modify: `apps/server/src/wsRpc.ts` (yield service at ~line 344, handlers after automation block ~line 1750)
- Modify: `apps/server/src/serverLayers.ts` (compose + merge)
- Modify: `apps/web/src/wsNativeApi.ts` (client block after `automation`)
- Test: `apps/server/src/servers/Layers/ServerService.test.ts`

**Interfaces:**

```ts
export type ServerServiceError = ServerRepositoryError | SecretStoreError | SshRunnerError | ServerNotFoundError;
export class ServerNotFoundError extends Data.TaggedError("ServerNotFoundError")<{ id: string }> {}
export interface ServerServiceShape {
  list: () => Effect<ServerListResult, ServerServiceError>;
  create: (input: ServerCreateInput) => Effect<ServerRecord, ServerServiceError>;
  update: (input: ServerUpdateInput) => Effect<ServerRecord, ServerServiceError>;
  remove: (input: ServerDeleteInput) => Effect<void, ServerServiceError>;
  testConnection: (input: ServerByIdInput) => Effect<ServerConnectionTest, ServerServiceError>;
  trustHostKey: (input: ServerTrustHostKeyInput) => Effect<ServerConnectionTest, ServerServiceError>;
  refreshStats: (input: ServerByIdInput) => Effect<ServerRefreshStatsResult, ServerServiceError>;
  importPreview: () => Effect<ServerImportPreviewResult, ServerServiceError>;
  importApply: (input: ServerImportApplyInput) => Effect<ServerImportApplyResult, ServerServiceError>;
  checkCapabilities: () => Effect<ServerCapabilities>;
  listLocalKeys: () => Effect<ServerListLocalKeysResult>;
}
```

Behavior rules (each has a test):
1. `create`: id = `ServerId.makeUnsafe(crypto.randomUUID())`, `now = Date.now()`; stores secrets via `storeServerSecrets` after the row insert; the returned record has no secret.
2. `update`: loads record, applies `patch`, sets `updatedAt`, stores `secret`, clears `clearSecrets`; if `auth.type` changes, secrets not used by the new type are cleared (agent → all; keyPath → privateKey, password; importedKey → password; password → privateKey, passphrase).
3. `remove`: deletes row, all secrets, and `knownHosts.forget(host, port)`.
4. `testConnection`: if `!isKnown` → scan; if scan empty → `{outcome:"unreachable", message:"No host key returned by ssh-keyscan."}`; else `{outcome:"host-key-unknown", hostKey: fingerprintOfKeyLine(first line)}`; scanned lines are cached in an in-memory `Map<ServerId, string[]>` for `trustHostKey`. Otherwise run `echo djl-ok` with `secret = readServerSecret(id, plan kind)`; persist `lastTest`; return it.
5. `trustHostKey`: pending scan lines for that id must exist and the first line's fingerprint must equal `input.fingerprint`, else fail with `SshRunnerError("Host key changed since it was scanned. Test again.")`; `knownHosts.trust(lines)`; clear cache; return `testConnection`.
6. `refreshStats`: run `STATS_COMMAND`; on `ok` parse and persist `lastStats` and `lastTest`; on any other outcome persist `lastTest` and return `{ ok: false, test }`. If the host is unknown, return `{ ok: false, test }` where `test` is the `host-key-unknown` result from rule 4.
7. `importPreview`: `readSshConfigHosts(config.homeDir)`; `alreadyImported = existing.some(s => s.sshConfigAlias === alias)`.
8. `importApply`: for each alias in the preview that is not already imported, create with `source:"ssh-config"`, `sshConfigAlias`, `auth = identityFile ? {type:"keyPath", path: expandHomePath(identityFile, homeDir), hasPassphrase:false} : {type:"agent"}`, `username = user ?? os.userInfo().username`, `name = alias`.

- [ ] **Step 1: Write the failing service test** using `SqlitePersistenceMemory`, `ServerSecretStoreLive` with `ServerConfig.layerTest`, and a stub `SshRunner` layer (`Layer.succeed(SshRunner, {...})`) whose `run` records calls and returns a scripted result, plus stub known-hosts behavior by pointing `DJL_SSH_KEYGEN_COMMAND`/`DJL_SSH_KEYSCAN_COMMAND` at fixture scripts as in Task 6. Cover rules 1-6 and 8 (`importApply` with a temp home dir written like Task 8).

- [ ] **Step 2: Run and confirm failure.**

- [ ] **Step 3: Implement service tag and layer** in the two files, composing `ServerRepository`, `ServerSecretStore`, `SshRunner`, `makeKnownHosts({ sshCommand: runner.sshCommand, knownHostsFiles: runner.knownHostsFiles, djlKnownHostsPath: runner.djlKnownHostsPath })`, `ServerConfig`, `FileSystem`, `Path`. `ServerServiceLive = Layer.effect(ServerService, makeServerService)`.

- [ ] **Step 4: Wire wsRpc.ts.** Add `import { ServerService } from "./servers/Services/ServerService";`, `const serverService = yield* ServerService;`, and handlers:

```ts
        [WS_METHODS.serversList]: () => rpcEffect(serverService.list(), "Failed to list servers"),
        [WS_METHODS.serversCreate]: (input) => rpcEffect(serverService.create(input), "Failed to add server"),
        [WS_METHODS.serversUpdate]: (input) => rpcEffect(serverService.update(input), "Failed to update server"),
        [WS_METHODS.serversDelete]: (input) => rpcEffect(serverService.remove(input), "Failed to remove server"),
        [WS_METHODS.serversTestConnection]: (input) => rpcEffect(serverService.testConnection(input), "Failed to test connection"),
        [WS_METHODS.serversTrustHostKey]: (input) => rpcEffect(serverService.trustHostKey(input), "Failed to trust host key"),
        [WS_METHODS.serversRefreshStats]: (input) => rpcEffect(serverService.refreshStats(input), "Failed to refresh stats"),
        [WS_METHODS.serversImportPreview]: () => rpcEffect(serverService.importPreview(), "Failed to read SSH config"),
        [WS_METHODS.serversImportApply]: (input) => rpcEffect(serverService.importApply(input), "Failed to import servers"),
        [WS_METHODS.serversCheckCapabilities]: () => rpcEffect(serverService.checkCapabilities(), "Failed to check ssh"),
        [WS_METHODS.serversListLocalKeys]: () => rpcEffect(serverService.listLocalKeys(), "Failed to list keys"),
```

- [ ] **Step 5: Wire serverLayers.ts.** `const serverRegistryLayer = ServerServiceLive.pipe(Layer.provideMerge(ServerRepositoryLive), Layer.provideMerge(SshRunnerLive), Layer.provideMerge(authServicesLayer))` and add `serverRegistryLayer` to the final `Layer.mergeAll`. If `wsRpc` cannot see `ServerService`, follow how `AutomationService` reaches it (search `automationServiceLayer` usages).

- [ ] **Step 6: Wire wsNativeApi.ts.**

```ts
    servers: {
      list: () => transport.request(WS_METHODS.serversList, {}),
      create: (input) => transport.request(WS_METHODS.serversCreate, input),
      update: (input) => transport.request(WS_METHODS.serversUpdate, input),
      delete: (input) => transport.request(WS_METHODS.serversDelete, input),
      testConnection: (input) => transport.request(WS_METHODS.serversTestConnection, input, { timeoutMs: 45_000 }),
      trustHostKey: (input) => transport.request(WS_METHODS.serversTrustHostKey, input, { timeoutMs: 45_000 }),
      refreshStats: (input) => transport.request(WS_METHODS.serversRefreshStats, input, { timeoutMs: 45_000 }),
      importPreview: () => transport.request(WS_METHODS.serversImportPreview, {}),
      importApply: (input) => transport.request(WS_METHODS.serversImportApply, input),
      checkCapabilities: () => transport.request(WS_METHODS.serversCheckCapabilities, {}),
      listLocalKeys: () => transport.request(WS_METHODS.serversListLocalKeys, {}),
    },
```

- [ ] **Step 7: Run** `bun run --cwd apps/server test -- servers/Layers/ServerService.test.ts`, then `bun run typecheck` at the repo root (or per package). Expected: PASS, no type errors.

- [ ] **Step 8: Commit** `feat(server): ServerService with RPC and layer wiring`.

---

### Task 10: Section registration, i18n, CSS

**Files:**
- Modify: `apps/web/src/settingsNavigation.ts` (`"servers"` id after `"local-models"`; nav item `{ id: "servers", group: "synara", labelKey: "navigation.items.servers.label", descriptionKey: "navigation.items.servers.description", icon: "server", eyebrowKey: "navigation.items.servers.eyebrow", desktopOnly: true }`)
- Modify: `apps/web/src/routes/_chat.settings.tsx` (`case "servers": return <ServersSettingsPanel />;` + import)
- Modify: `apps/web/src/settingsSearchIndex.ts` (`panel("servers:registry", "servers")`)
- Modify: all 7 `apps/web/src/i18n/locales/*.json`: `settings.navigation.items.servers.{label,description,eyebrow}`, `settings.search.entries.servers.registry.{title,keywords}`, and the full `settings.servers.*` namespace listed below.
- Modify: `apps/web/src/index.css` (append keyframes)
- Create: `apps/web/src/components/settings/ServersSettingsPanel.tsx` as a placeholder that renders `<SettingsSection title={t("servers.title")}><SettingsListRow title={t("servers.empty.title")} /></SettingsSection>` so the route compiles; replaced in Task 12.

`settings.servers` keys (English values; translate every one for the other six catalogs):

```
title: "Servers"
subtitle: "Your VPS and SSH hosts, ready for agents."
actions.add: "Add server" | actions.import: "Import from SSH config" | actions.test: "Test connection" | actions.refresh: "Refresh" | actions.edit: "Edit" | actions.remove: "Remove" | actions.cancel: "Cancel" | actions.save: "Save" | actions.saveChanges: "Save changes" | actions.trust: "Trust this key" | actions.notNow: "Not now" | actions.copy: "Copy" | actions.copied: "Copied" | actions.testBeforeSaving: "Test before saving" | actions.importSelected: "Import {{count}} selected" | actions.more: "More options" | actions.reveal: "Show" | actions.hide: "Hide"
empty.title: "No servers yet" | empty.body: "Add a VPS by hand or import the hosts already in your SSH config." 
status.neverTested: "Never tested" | status.testing: "Testing…" | status.refreshing: "Refreshing…" | status.ok: "Reachable" | status.hostKeyUnknown: "Host key needs your approval" | status.hostKeyChanged: "Host key changed" | status.authFailed: "Login failed" | status.unreachable: "Unreachable" | status.timeout: "Timed out" | status.askpassUnsupported: "Password login needs OpenSSH 8.4 or newer" | status.error: "Error" | status.lastTested: "Last tested {{when}}" | status.latency: "{{ms}} ms"
tier.read-only: "Read-only" | tier.approve-each: "Approve each" | tier.full: "Full" | tier.hint.read-only: "Agents may only inspect this server." | tier.hint.approve-each: "Every command waits for your approval." | tier.hint.full: "Agents run commands without asking."
stats.load: "Load" | stats.memory: "Memory" | stats.disk: "Disk" | stats.uptime: "Up" | stats.os: "System" | stats.kernel: "Kernel" | stats.hostname: "Hostname" | stats.collected: "Stats from {{when}}" | stats.unavailable: "Not reported" | stats.uptimeDays: "{{count}}d {{hours}}h" | stats.uptimeHours: "{{count}}h {{minutes}}m" | stats.uptimeMinutes: "{{count}}m"
hostKey.title: "Confirm this server's identity" | hostKey.body: "Compare the fingerprint with the one your provider shows before trusting it." | hostKey.changedTitle: "This server's host key has changed" | hostKey.changedBody: "Someone may be intercepting the connection, or the server was rebuilt. Remove the old entry from your known_hosts before connecting again." | hostKey.keyType: "Key type"
form.addTitle: "Add server" | form.editTitle: "Edit server" | form.name: "Name" | form.host: "Host" | form.hostHint: "Hostname or IP address" | form.port: "Port" | form.username: "Username" | form.auth: "Authentication" | form.auth.agent: "SSH agent" | form.auth.agentHint: "Uses your ssh-agent and ~/.ssh/config." | form.auth.keyPath: "Key file" | form.auth.importedKey: "Import key" | form.auth.password: "Password" | form.keyPath: "Private key path" | form.keyPathPlaceholder: "~/.ssh/id_ed25519" | form.passphrase: "Passphrase" | form.passphraseHint: "Only needed for encrypted keys. Stored on this computer." | form.passphraseKeep: "Keep the saved passphrase" | form.importKey: "Private key" | form.importKeyDrop: "Drop a key file here or paste its contents" | form.importKeyChoose: "Choose file" | form.importKeyDetected: "{{type}} key detected" | form.importKeyKeep: "Keep the saved key" | form.password: "Password" | form.passwordHint: "Stored on this computer and sent to ssh only through askpass." | form.passwordKeep: "Keep the saved password" | form.tags: "Tags" | form.tagsPlaceholder: "Add a tag and press Enter" | form.tier: "Agent permissions" | form.notes: "Notes" | form.preview: "What DJL will run" | form.previewHint: "Secrets are never placed on the command line."
errors.nameRequired: "Give this server a name." | errors.hostRequired: "Enter a hostname or IP address." | errors.hostInvalid: "That does not look like a hostname or IP address." | errors.portInvalid: "Port must be between 1 and 65535." | errors.usernameRequired: "Enter the login username." | errors.keyPathRequired: "Choose or enter a key path." | errors.keyRequired: "Paste or drop a private key." | errors.keyInvalid: "That is not a private key." | errors.passwordRequired: "Enter the password." | errors.tagInvalid: "Tags may only contain letters, numbers, _ and -." | errors.loadFailed: "Could not load servers."
import.title: "Import from SSH config" | import.body: "Found {{count}} hosts in {{path}}. Nothing is tested until you ask." | import.none: "No importable hosts in {{path}}." | import.alreadyAdded: "Already added"
remove.title: "Remove {{name}}?" | remove.body: "DJL forgets this server, its saved secrets and its trusted host key. Nothing changes on the server itself."
toasts.added: "{{name}} added" | toasts.saved: "{{name}} saved" | toasts.removed: "{{name}} removed" | toasts.imported: "{{count}} servers imported" | toasts.trusted: "Host key trusted"
```

`index.css` additions (after the `chat-message-send-enter` block):

```css
@keyframes servers-row-enter { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
@keyframes servers-stat-enter { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: none; } }
@keyframes servers-dot-breathe { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.35); opacity: 0.55; } }
@keyframes servers-highlight-sweep { from { background-position: -200% 0; } to { background-position: 200% 0; } }
@keyframes servers-cursor-blink { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } }
@keyframes servers-stroke-draw { to { stroke-dashoffset: 0; } }
@keyframes servers-chip-enter { from { opacity: 0; transform: scale(0.9); } to { opacity: 1; transform: scale(1); } }
@keyframes servers-fields-enter { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
@keyframes servers-check-pop { 0% { transform: scale(0.6); opacity: 0; } 60% { transform: scale(1.15); opacity: 1; } 100% { transform: scale(1); } }
.servers-row-enter { animation: servers-row-enter 200ms ease-out both; }
.servers-stat-enter { animation: servers-stat-enter 240ms ease-out both; animation-delay: calc(var(--servers-stat-index, 0) * 40ms); }
.servers-dot-breathe { animation: servers-dot-breathe 1.2s ease-in-out infinite; }
.servers-highlight-sweep { background-image: linear-gradient(90deg, transparent 0%, color-mix(in oklab, var(--color-primary) 10%, transparent) 50%, transparent 100%); background-size: 200% 100%; animation: servers-highlight-sweep 900ms ease-out 1; }
.servers-cursor-blink { animation: servers-cursor-blink 1.1s steps(1) infinite; }
.servers-stroke-draw { stroke-dasharray: 120; stroke-dashoffset: 120; animation: servers-stroke-draw 600ms ease-out forwards; }
.servers-chip-enter { animation: servers-chip-enter 140ms ease-out both; }
.servers-fields-enter { animation: servers-fields-enter 180ms ease-out both; }
.servers-check-pop { animation: servers-check-pop 300ms ease-out both; }
.servers-bar-fill { transition: width 600ms cubic-bezier(0.16, 1, 0.3, 1); }
.servers-press:active { transform: scale(0.98); }
@media (prefers-reduced-motion: reduce) {
  .servers-row-enter, .servers-stat-enter, .servers-dot-breathe, .servers-highlight-sweep, .servers-cursor-blink,
  .servers-stroke-draw, .servers-chip-enter, .servers-fields-enter, .servers-check-pop { animation: none; }
  .servers-stroke-draw { stroke-dashoffset: 0; }
  .servers-bar-fill { transition: none; }
}
```

Verify: `bun run i18n:check` and `bun run --cwd apps/web test -- catalogEquality settingsNavigation SettingsSidebarNav` pass. Commit `feat(web): register Servers settings section with i18n and motion tokens`.

---

### Task 11: Pure panel helpers

**Files:**
- Create: `apps/web/src/components/settings/servers/serverPanelModel.ts`
- Test: `apps/web/src/components/settings/servers/serverPanelModel.test.ts`

**Interfaces:**

```ts
export interface ServerFormValues { name: string; host: string; port: string; username: string; authType: "agent"|"keyPath"|"importedKey"|"password"; keyPath: string; passphrase: string; keepPassphrase: boolean; privateKey: string; keepPrivateKey: boolean; password: string; keepPassword: boolean; tags: string[]; permissionTier: ServerPermissionTier; notes: string }
export const emptyServerForm: () => ServerFormValues;
export function formFromRecord(record: ServerRecord): ServerFormValues;
export type ServerFormErrors = Partial<Record<"name"|"host"|"port"|"username"|"keyPath"|"privateKey"|"password", string>>;   // values are i18n keys under settings.servers.errors
export function validateServerForm(values: ServerFormValues, mode: "create"|"edit"): ServerFormErrors;
export function toCreateInput(values: ServerFormValues): ServerCreateInput;
export function toUpdateInput(id: ServerId, values: ServerFormValues, previous: ServerRecord): ServerUpdateInput;
export function previewSshCommand(values: ServerFormValues): string;   // "ssh -p 2222 -i ~/.ssh/id deploy@host"; password → "ssh -p 22 deploy@host  # password via askpass"
export function detectPrivateKeyType(pem: string): string | null;       // "OpenSSH" | "RSA" | "EC" | "PKCS#8" | null
export function formatBytes(bytes: number): string;                     // "7.7 GB"
export function percent(used: number, total: number): number;           // 0-100 rounded
export function uptimeParts(seconds: number): { days: number; hours: number; minutes: number };
export function isStatsStale(stats: ServerStats | undefined, now: number): boolean;   // undefined or older than 10 min
export function statusKey(record: ServerRecord, pending: "test"|"refresh"|null): string;  // i18n key under settings.servers.status
export function statusTone(record: ServerRecord): "neutral"|"success"|"warning"|"danger";
```

Write tests first for each function (at least: validation catches every error key; `toUpdateInput` emits `clearSecrets` when a keep-flag is false and the field is empty; `previewSshCommand` never contains the password/passphrase/private key; `detectPrivateKeyType` on the four headers; `formatBytes` on 0, 1536, 8123456*1024; `uptimeParts(90061)` → 1d 1h 1m; `isStatsStale` boundaries; `statusTone` per outcome). Then implement. Commit `feat(web): server panel model helpers`.

---

### Task 12: Panel, row, status dot, empty state

**Files:**
- Create: `apps/web/src/components/settings/servers/ServerStatusDot.tsx`
- Create: `apps/web/src/components/settings/servers/ServersEmptyState.tsx`
- Create: `apps/web/src/components/settings/servers/ServerRow.tsx`
- Replace: `apps/web/src/components/settings/ServersSettingsPanel.tsx`
- Test: `apps/web/src/components/settings/ServersSettingsPanel.browser.tsx`

Panel responsibilities: `useQuery(["servers"], () => ensureNativeApi().servers.list())`; mutations for test, trust, refresh, delete; a `pendingById` map (`"test" | "refresh"`); auto-refresh effect that, once per panel mount, sequentially calls `refreshStats` for servers whose `lastTest?.outcome === "ok"` and `isStatsStale(lastStats, Date.now())`; dialogs state (`editor: null | {mode:"create"} | {mode:"edit", record}`, `importOpen`, `removeTarget`). Each mutation's `onSuccess` calls `queryClient.setQueryData(["servers"], ...)` to update the single record, avoiding a full refetch flash. Toasts via `toastManager.add`.

Row structure (from spec §9): status dot, name, mono `user@host:port`, tag chips (`Badge variant="outline"`), stats strip (`font-mono tabular-nums text-xs`, each figure in a `span.servers-stat-enter` with `style={{"--servers-stat-index": i}}`), tier badge, `Menu` with the four actions, clickable body toggling `DisclosureRegion` with the bars (`div.servers-bar-fill` width in %), details grid, last test, and the two buttons. The host-key block renders inside the expanded region when `lastTest.outcome` is `host-key-unknown` or `host-key-changed`, and the row auto-expands when a test result lands with one of those outcomes.

Browser test cases (mock `~/nativeApi` like `LocalModelsSettingsPanel.browser.tsx`): empty state renders both buttons; a list of two servers shows names, addresses, tier badges and stats; clicking a row expands details; "Test connection" invokes `testConnection` and shows the host-key block with fingerprint and Trust when the mock resolves `host-key-unknown`; Trust calls `trustHostKey`; Remove opens the alert dialog and calls `delete` on confirm. Take screenshots of the empty state and the list.

Commit `feat(web): Servers settings panel with rows, stats and host-key trust`.

---

### Task 13: Editor dialog and import dialog

**Files:**
- Create: `apps/web/src/components/settings/servers/ServerEditorDialog.tsx`
- Create: `apps/web/src/components/settings/servers/ServerImportDialog.tsx`
- Modify: `apps/web/src/components/settings/ServersSettingsPanel.tsx` (mount both)
- Test: `apps/web/src/components/settings/servers/ServerEditorDialog.browser.tsx`
- Test: `apps/web/src/components/settings/servers/ServerImportDialog.browser.tsx`

Editor: `DialogPopup className="max-w-2xl"`, `grid md:grid-cols-[1fr_minmax(0,18rem)]`, fields per spec §9 using `Label` + `Input` + `Textarea`, `ToggleGroup` for auth and tier (single value), conditional field block with `servers-fields-enter` keyed by `authType`, tag chip input, key-path `<datalist>` fed by `servers.listLocalKeys()`, import-key `<input type="file">` read with `FileReader` plus a textarea, preview pane (`<pre class="font-mono text-xs">`) that re-keys on text change to replay a 120 ms fade, "Test before saving" that creates a transient record through `create` is NOT allowed (it would persist); instead it validates and calls `create` only on Save. For test-before-save, add `servers.testDraft` later if needed; in this step the button is omitted and the preview pane explains what will run. Save button: disabled until `validateServerForm` is empty; shows spinner while pending; on success closes and the panel highlights the new row.

Import: loads `importPreview` on open, list with `Checkbox` per candidate (unchecked when `alreadyImported`), "Import N selected" calls `importApply`, then closes and toasts.

Browser tests: editor validation shows the name/host/username errors on empty Save attempt; switching auth to Password reveals the password field and the preview reads `# password via askpass`; tags chip add/remove; Save calls `create` with the expected input. Import: renders candidates, already-added ones disabled, Import calls `importApply` with the checked aliases.

Commit `feat(web): server editor and SSH config import dialogs`.

---

### Task 14: Verification and live run

1. `bun run typecheck` (root) or per package; `bun run lint`; `bun run i18n:check`.
2. `bun run --cwd apps/server test`, `bun run --cwd packages/contracts test`, `bun run --cwd apps/web test`, `bun run --cwd apps/web test:browser -- Servers`.
3. Start the dev app (`bun run dev` from the repo root, or the launch config in `.claude/launch.json`), open Settings → Servers, and exercise end to end: add a server with agent auth against a real or local host (`localhost` with the user's own key, if sshd is enabled), see the host-key prompt, trust, test, refresh stats, edit, import from SSH config, remove.
4. Commit any fixes; push `feat/server-registry`; open a PR against `main` in `Anthonysu798/DJL` with the spec and plan linked.
