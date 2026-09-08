# Fresh DJL Harness Integrations

**Goal:** Build new DJL integration code for Codex, Claude Code, Cursor, and provider-native subscription authentication; deliver the UI in Electron with shared backend contracts for iOS.

**Design:** Implement new native runtime bridges against official CLI/SDK protocols. Do not reactivate or copy the historical disabled adapters. Retain the currently active OpenCode runtime and local-model experience, and add new account access to its native provider login (including supported Chinese coding plans). OpenCode is already running in DJL; its new account integration must use the same managed credential directory. Native Codex/Claude/Cursor login stays with each unmodified official runtime; DJL does not extract or store their OAuth tokens. Use the existing provider event and terminal transport contracts to integrate the new code with chat.

**Constraints:** No release, deployment, merge, token extraction, or automatic subscription purchase. Keep unrelated edits. Do not claim a subscription works until an authenticated runtime test proves it. Chinese web-chat subscriptions are not interchangeable with coding plans; UI must describe this accurately. Frontend is Electron first; contracts remain available to the existing authenticated shared backend. Use existing permission policies without broadening them. New functionality gets focused tests and typechecking.

## Task 1: New native runtime bridges

Create new files under `apps/server/src/harnesses/` for Codex, Claude Code, and Cursor. Implement `ProviderAdapterShape<ProviderAdapterError>` with the current provider IDs `codex`, `claudeAgent`, and `cursor`. Use official provider protocols (Codex app-server, official Claude Agent SDK/CLI, Cursor ACP); generic transport/schema utilities may be reused, historical adapter implementations must not be re-enabled or copied. Export a new layer/factory from this directory and wire it alongside the active OpenCode adapter in `apps/server/src/provider/runtimeLayer.ts` and `Layers/ProviderAdapterRegistry.ts`. Keep new implementation cohesive and minimal.

Required behavior: start/resume sessions, stream assistant responses and tool/request events through current canonical events, complete/fail/interrupt turns, clean up subprocesses and pending calls, pass through explicit project cwd/model/permissions, retain provider-owned credentials, reject unavailable operations explicitly. Declared capabilities must match implemented support. No arbitrary shell interpolation. Bound protocol errors/timeouts. Native requests requiring approval must be surfaced, never auto-approved. The new adapters must be usable by the existing ProviderService orchestration. Models should be queried from native runtimes where available. Do not touch frontend files, account RPC files, or existing disabled adapters. Add focused tests for lifecycle, output translation, cancellation, approval policy, and error behavior. Run tests and server typecheck, and report observed failures separately from assertions about live auth. Leave changes uncommitted for combined review.

## Task 2: New account/sign-in backend

Create `packages/contracts/src/harnessAccounts.ts`, exporting a four-value HarnessId (`codex`, `claudeAgent`, `cursor`, `opencode`), account descriptors, list result, login input/result schemas. Add authenticated NativeApi and RPC methods `harnesses.listAccounts` and `harnesses.startLogin`. The list returns availability/status without credentials. Login uses a dedicated existing DJL terminal scope and official interactive native login commands; it returns the terminal identifiers and cwd for rendering. OpenCode uses the existing pinned runtime and managed credential environment. Repeated login requests must not inject into a running process; closing/cancelling the terminal must be supported through existing terminal APIs. Add tests for direct command arguments/env selection, missing binaries, and disabled/unsupported runtime handling. Preserve existing API-key model connections.

## Task 3: New Electron account UI and chat selection

Build a new Accounts/settings panel (do not revive the old Providers panel). Show the four native harnesses, availability, provider-native sign-in actions, refresh, and an embedded DJL terminal for interactive login. Explain GLM/Z.AI, Kimi, MiniMax and Qwen access using their supported coding-plan/provider login paths. Update the composer to offer the newly built native bridges while retaining OpenCode/local models. Persist a user's chat provider choices instead of forcibly converting them to OpenCode. Reuse common UI controls and localized copy. Test preference persistence and provider selection, typecheck, and visibly verify the settings and composer in Electron.

## Verification

- iOS app installed and visibly launched on iPhone 17 Pro simulator.
- Electron dev app visibly open on localhost:5733.
- New backend unit tests and affected web/contract suites pass; server and web typechecks pass.
- Fresh provider selection, native account status, and login terminal visible in Electron.
- Actual authenticated smoke test only for locally available authorized providers; report unavailable credentials honestly.
