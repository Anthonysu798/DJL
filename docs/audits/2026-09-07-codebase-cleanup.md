# Codebase cleanup audit — 2026-09-07

Verdict: improved, but not clean or fully verified. The repository has useful workspace boundaries, strict TypeScript settings, and extensive tests. Existing failing checks and very large central modules limit confidence and maintainability. This is a conservative static audit and cleanup, not a guarantee that every unused symbol has been found or that every runtime is regression-free.

## Scope and method

- Inventoried first-party apps, packages, scripts, and native source: 2,524 code-like files at the initial snapshot, including generated and bundled assets.
- Ran repository Oxlint across 2,139 files initially and 2,140 at final validation. This checkout changed externally during the audit; counts represent observed snapshots, not an immutable commit.
- Checked local unused declarations with compiler-backed lint diagnostics, parsed declarations with TypeScript, inspected removals and searched references before deleting uncalled helpers.
- Screened exported declarations and dependency references. A symbol mentioned in only one file is only a candidate: package exports, framework conventions, generated schemas, runtime lookup and external consumers require additional analysis. No bulk export or file deletion was performed.
- Preserved files already modified at cleanup selection, untracked feature work, compatibility identities, schemas, persisted storage behavior and release machinery. No dependency manifests or lockfiles were changed.
- iOS, stats worker, vendored OpenCode and generated/bundled code were inventoried but not exhaustively analyzed or built. The JS/TS linter does not certify Swift, vendored code, assets, CSS, or runtime reachability. No Electron, browser, iOS Simulator, packaging or upgrade smoke run was performed.

## Cleanup applied

20 source/test files; 6 inserted lines and 141 deleted lines (135 net lines removed).

Removed seven uncalled local functions:

- `toProjectedThreadShell`: obsolete projection helper; active stored-summary conversion remains.
- `redactOpenCodeRequestDetail`: uncalled local function; no active redaction path changed.
- `runShellCommand`: unused Git test helper.
- `shallowEqualEntryArray`: unused timeline equality helper.
- `idleStatusEvent`: unused OpenCode test fixture builder.
- `hasTrustedPhones`: unused gateway helper.
- `responseItemContentText`: unused local history helper; shared text conversion remains.

Removed 11 unused import bindings and five unused variable bindings. Both branch recovery toast calls are retained; only unused return-value bindings were removed. Removed the unused terminal label read in CLI registration, retaining the label read used by metadata updates.

Files changed:

- `apps/web/src/terminalStateStore.ts`
- `apps/server/src/provider/Layers/OpenCodeAdapter.ts`
- `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts`
- `apps/server/src/git/Layers/GitCore.test.ts`
- `apps/server/src/git/Layers/OpenCodeTextGeneration.ts`
- `apps/web/src/components/chat/MessagesTimeline.logic.ts`
- `apps/server/src/provider/Layers/OpenCodeAdapter.test.ts`
- `apps/server/src/provider/Layers/CursorAdapter.ts`
- `apps/web/src/i18n/index.ts`
- `apps/server/src/djlStorageMigration.ts`
- `apps/web/src/components/BranchToolbarBranchSelector.tsx`
- `apps/server/src/codexAppServerManager.ts`
- `apps/server/src/work/Layers/WorkMcpServer.test.ts`
- `apps/web/src/components/ThemePackEditor.tsx`
- `apps/web/src/hooks/useRecentViewSwitcher.ts`
- `apps/remote-gateway/src/secure-device-state.js`
- `apps/server/src/auth/http.ts`
- `apps/desktop/src/desktopI18n.test.ts`
- `apps/remote-gateway/src/session-jsonl-history.js`
- `apps/server/src/terminal/terminalHistory.test.ts`

## Validation

| Check | Observed result |
|---|---|
| `bun run lint`, initial | 371 warnings, 0 errors |
| `bun run lint`, after cleanup | 350 warnings, 0 errors; exit 0 |
| Unused-variable diagnostics, comparable JSON scans | 56 initially, 33 afterward; repository was changing concurrently |
| Formatter and `git diff --check` on cleanup files | Passed |
| `bun run typecheck`, before and after cleanup | Failed: ChatView imports nonexistent `effectiveRuntimeMode` from `../types`; 8 tasks successful, 1 failed |
| `bun run test` | Failed: contracts had 10 failed suites and 10 passed suites, 64 tests passed; Turbo interrupted other suites |
| Focused server suites | 103 tests passed in 3 files; 5 suites failed at contract import before tests ran |
| Focused gateway state/history tests | 47 tests passed, 0 failed |
| Focused web suites | 3 suites failed at contract import; no tests ran |
| Focused desktop i18n suite | Failed at contract import; no tests ran |

The affected test startup failure is `TypeError: Cannot read properties of undefined (reading 'ast')`. The stack points to `packages/contracts/src/providerDiscovery.ts:97` and `orchestration.ts`. These files were already modified and were not edited by this cleanup. They directly import one another (`RuntimeMode` one way, mention/skill schemas the other), consistent with a circular schema initialization failure; this causal explanation needs a dedicated fix and test.

## Maintainability findings

1. **Restore a green baseline first.** Repair the missing web export and contract initialization problem in the ongoing feature work. Until the full checks pass, comprehensive safety certification is unavailable.
2. **Large central modules need incremental separation.** Observed sizes: ChatView about 12,091 lines; Sidebar 7,853; gateway bridge 5,291; iOS CodexService+Messages 6,619. Size alone is not a defect, but these files combine enough behavior to make review and regression isolation difficult. Extract one cohesive responsibility at a time with behavior tests; a broad rewrite would be risky.
3. **Lint currently permits warning accumulation.** Correctness, suspicious and performance categories are warnings. The lint command succeeds with hundreds of findings. Classify existing warnings, then consider a scoped no-new-warning gate rather than mechanically fixing all suggestions. Copy-on-write and object field omission can be intentional.
4. **Unused findings remain.** See `2026-09-07-dead-code-candidates.json` for the 33 remaining local diagnostics. Some belong to concurrent feature changes; others are API parameters, React hooks with possible lifecycle behavior, or intentional object-rest field exclusion. They are not 33 proven deletions.
5. **Check coverage varies by workspace.** Landing declares no typecheck/test script; marketing no test script; gateway no typecheck script. iOS and stats-worker checks are outside the root package task inventory. A successful root task alone cannot establish whole-repository coverage.
6. **Dependency candidates need packaging-aware review.** No first-party text use was found for `@anthropic-ai/sdk`, `@fontsource-variable/inter`, and `tw-animate-css` beyond manifests in targeted searches. This is insufficient proof for removal: validate runtime staging, CSS/build inputs and clean installs. The web manifest and lockfile are already being edited, so they were preserved.

## Remaining work before calling this codebase clean

- Fix and rerun the failing typecheck and contract-dependent suites.
- Configure an entrypoint-aware unused-file/export/dependency analyzer for routes, Electron preload, package exports, worker entries, CLI commands, tests and release scripts; review its candidates manually.
- Run native Swift reachability analysis with Xcode build information and validate runtime-discovered declarations.
- Audit vendored changes separately from upstream code and generated assets.
- Complete desktop/web/mobile runtime smoke checks after the concurrent changes settle.

No commit, push, deployment, or release was performed. Detailed command logs for this session are in `/tmp/djl-cleanup-audit` (temporary storage).
