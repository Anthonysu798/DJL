# Installed OpenCode migration — implementation and validation

DJL now uses the separately installed official OpenCode CLI. The active checkout no longer contains `vendor/opencode`, and desktop builds no longer prepare, compile, inject, or ship that executable. The deletion removes 6,231 tracked vendor files (1,289,662 lines). Other developers' worktrees were left intact.

The official `@opencode-ai/sdk` remains a normal dependency. A small DJL-owned plugin, loaded only by DJL's server process, replaces the fork-specific behavior through OpenCode's supported plugin hooks and provider fetch extension. The MIT attribution is retained under `docs/licenses/OPENCODE_LICENSE`.

## Resulting behavior

- Installation, updates, login, discovery, chat and auxiliary text generation resolve the same configured executable, falling back to `opencode` on PATH. There is no bundled/cache/TypeScript-source fallback.
- Default Accounts login shares the installed CLI's credentials and configuration. Already-connected OAuth and custom providers remain visible and usable even when they do not support entering an API key in DJL.
- Explicit Workspace account profiles still use separate CLI-owned XDG directories. Sharing the default login does not merge these profiles.
- Tools checks protocol capabilities as well as version. Incompatible installations cannot be selected for new chats or used to start a DJL sign-in terminal. Installer success is verified afterward.
- Fresh profiles start a background readiness probe; users do not need a manual Settings refresh before their first chat.
- New server acquisitions respond to CLI executable changes and shared credential/configuration changes. Active turns retain their server connection. Credential changes do not dispose an instance serving an active turn.
- Work policy keeps tool restrictions, inherited-instruction isolation, local tool-choice requirements and text/JSON/DSML tool-call recovery. Native cloud MCP names remain exact; local compatible transports can expose unambiguous aliases. DeepSeek retains automatic tool choice for reasoning compatibility while still recovering text-form calls and requiring successful evidence. Fork-only policy fields are not sent on the official HTTP protocol.
- Overlapping submissions queue before session-wide policy changes. Setup failure, interruption, stopped sessions and runtime exit release waiting submissions without overwriting another turn's policy.
- Local models that cannot call tools receive none. Default local chat uses a concise DJL agent; web-search tool results retain retrieval timestamps.

## Upgrade and credentials

Legacy conversations migrate when first resumed, read externally, or forked. DJL takes a consistent SQLite online backup, uses official export/import commands, verifies the session ID/transcript, and records completion. The original data and backup remain retained. Repeated migration and adapter restart are idempotent. A missing or conflicting legacy conversation is not silently replaced with an empty session.

Accounts offers an explicit **Copy saved DJL logins to OpenCode** action. It discovers the installed CLI's data directory, retains the source and a private backup, preserves existing destination entries, and exposes only provider identifiers over RPC. No real user credentials were transferred in validation.

## Verification observed

| Verification | Result |
|---|---|
| Full server suite | 235 files passed, 3 skipped; 2,409 tests passed, 11 skipped |
| Desktop build | 6 tasks passed |
| Desktop typecheck | 8 tasks passed |
| Focused packaging/plugin/license script suite | 68 tests passed |
| Real adapter and runtime/migration/credential group | 41 tests passed in the recorded combined run; additional legacy adapter restart coverage also passed |
| Real actual-adapter integration | Work tool recovery and legacy migration/restart both passed against official 1.18.29 |
| Live standalone compatibility | Official 1.18.29: Ollama JSON, LM Studio tagged, DeepSeek DSML, native chat and no-tool variants passed; official 1.17.18 DeepSeek DSML also passed |
| Official protocol probes | 1.17.18 and 1.18.29 passed authenticated health/OpenAPI checks |
| Final runtime/adapter regression group | 115 tests passed after final protocol and chat-only fixes |
| Queue policy regressions | 4 tests passed, including stopping during runtime preparation |
| Account/UI regressions | Shared login, explicit-only transfer, incompatible CLI controls and OAuth/custom catalog behavior passed focused browser checks |
| Seven locale catalogs | Shape and focused localization checks passed |
| Source and compiled-output guards | No bundled runtime found in the active source, desktop output or server output |
| Main/preload/gateway verification | Built entries validated |
| Real Electron | Accounts displayed installed 1.18.29, Connected and Compatible; the app selected the shared custom-provider model and rendered “OpenCode connection verified.” with no renderer errors on the final run |

Electron verification used a disposable DJL profile, synthetic shared credentials and a loopback model fixture. The response traveled through the real rebuilt Electron app, server, official CLI and model protocol. It was not a paid provider call or a real OAuth-account login. Screenshots are saved locally under `output/opencode-migration/`.

## Remaining validation limits

The full web run is not green: 2,820 tests passed and four failed in existing expectations outside this migration:

1. `appSettings.test.ts`: custom-model ordering relative to built-ins.
2. `session-logic.test.ts`: the expectation that DJL is the sole runtime for new turns.
3. `Sidebar.logic.test.ts`: the expectation that sidebar provider icons never appear.
4. `composerProviderRegistry.test.tsx`: Codex fast-mode discovery behavior.

Those production behaviors were not changed by this migration. The failed run is recorded rather than described as a passing full desktop CI run.

The new normal-CI matrix covers Linux, Windows, macOS ARM64 and macOS Intel with separately installed official CLIs. These remote jobs were authored, not executed from this local session. No signed/notarized installer, updater upgrade, iOS Simulator session or production release was performed.

Native local chat retains the upstream skill catalogue because upstream cannot hide it independently of disabling the skill tool. The concise local agent and native project instructions are preserved; no fragile prompt-text stripping was introduced.

Migration and credential-transfer operations serialize DJL's own writers and retain backups. External CLI writers do not participate in DJL's locks; the official import API has no conditional-create operation. Conflicts or incomplete divergent imports fail with retained recovery data instead of being silently accepted.

## Useful commands

```sh
bun run ci:desktop:no-bundled-opencode
bun run build:desktop
bun run ci:desktop:typecheck
bun run --cwd apps/server test
node scripts/probe-installed-opencode.ts /absolute/path/to/opencode --native-permissions --compatibility
DJL_TEST_OPENCODE_BINARY=/absolute/path/to/opencode bun run --cwd apps/server test -- src/provider/openCodeInstalledAdapter.integration.test.ts src/provider/openCodeInstalledMigration.test.ts src/harnesses/openCodeCredentialTransfer.test.ts
```

No commit, push, tag or release was made. Logs from this session are in `/tmp/djl-opencode-migration/`.
