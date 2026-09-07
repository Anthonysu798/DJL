# Remote Terminal Mirroring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the phone attach to DJL desktop's per-thread terminals, stream their output live, and type into them over the existing relay path.

**Architecture:** The gateway adapter subscribes to the backend's `terminal.subscribeEvents` stream once and forwards events for terminals the phone has opened as `djl/terminal/event` notifications; phone requests `djl/terminal/*` map 1:1 to backend `terminal.*` calls. The phone adds a `desktop` terminal source next to SSH, reusing `DJLTerminalSnapshot` and the Ghostty surface, and re-attaches automatically after host offline/online transitions.

**Tech Stack:** Node (gateway, `node --test`), Swift/SwiftUI (iOS, XCTest via xcodebuild), Effect RPC contracts already in `packages/contracts`.

## Global Constraints

- Backend method tags: `terminal.open`, `terminal.write`, `terminal.ackOutput`, `terminal.resize`, `terminal.subscribeEvents` (from `WS_METHODS`).
- Phone methods: `djl/terminal/list|open|write|resize|ack|close`; notification `djl/terminal/event`.
- Lag limit 1 MiB unacked; resync threshold 256 KiB.
- Phone ACK batch: flush at ≥ 64 KiB or 150 ms.
- Phone terminal id `term-1` ⇄ desktop terminal id `default`; other ids verbatim.
- Closing from the phone never calls the backend `terminal.close`.
- New iOS test files must be registered in `apps/ios/DJL.xcodeproj/project.pbxproj` (4 places; ids `D3A1B2C4E5F60718293A4B09/0A` and `0B/0C`).

---

### Task 1: Gateway desktop terminal mirror

**Files:**
- Create: `apps/remote-gateway/src/desktop-terminal-mirror.js`
- Test: `apps/remote-gateway/test/desktop-terminal-mirror.test.js`

**Interfaces:**
- Produces: `createDesktopTerminalMirror({ request, emit, resolveCwd, lagLimitBytes = 1_048_576, resyncBytes = 262_144 })` → `{ list({threadId}), open(params), write(params), resize(params), ack(params), close(params), handleEvent(event), reset() }`.
  - `request(tag, payload)` returns a promise (the adapter passes `rpc.request`).
  - `emit(method, params)` sends a notification to the phone.
  - `resolveCwd(threadId)` returns a string or empty string.
  - `open` returns `{ snapshot }`; `list` returns `{ terminals }`; the rest return `{}`.

- [ ] Write tests: open registers the watch and returns the snapshot; output for unwatched terminals only updates `list`; watched output is forwarded with `byteLength`; exceeding the lag limit drops output and the first ack under the resync threshold re-opens and emits a synthetic `started` event; `close` removes the watch without a backend call; `open` without cwd uses `resolveCwd`.
- [ ] Run `node --test ./test/desktop-terminal-mirror.test.js` → fails (module missing).
- [ ] Implement the module.
- [ ] Run again → 6 passing.
- [ ] Commit `feat(remote-gateway): add desktop terminal mirror`.

### Task 2: Adapter integration

**Files:**
- Modify: `apps/remote-gateway/src/electron-app-server-adapter.js` (TERMINAL tags, `onStarted` subscription, dispatch cases, shutdown)
- Test: `apps/remote-gateway/test/electron-app-server-adapter.test.js`

**Interfaces:**
- Consumes: Task 1 factory. `resolveCwd` reads the thread's `worktreePath` from the projection's last snapshot (`threadCwdById` map populated in `applyThreadSnapshot`).
- Produces: phone-facing methods listed in Global Constraints.

- [ ] Write tests: adapter subscribes to `terminal.subscribeEvents` on start and forwards `djl/terminal/event` for an opened terminal; `djl/terminal/open` without cwd sends the thread's worktree path to `terminal.open`; shutdown unsubscribes.
- [ ] Run the adapter test file → new tests fail.
- [ ] Implement; keep `MUTATION_METHODS` unchanged.
- [ ] Run the adapter test file → all pass.
- [ ] Commit `feat(remote-gateway): mirror desktop terminals to the phone`.

### Task 3: iOS terminal source and bindings

**Files:**
- Modify: `apps/ios/DJL/Services/Terminal/DJLTerminalModels.swift` (`DJLTerminalSource`, `DJLTerminalProfile.source`, `DesktopTerminalBinding`, id mapping helpers)
- Test: `apps/ios/DJLTests/DesktopTerminalBindingTests.swift`

**Interfaces:**
- `enum DJLTerminalSource: String, Codable { case ssh, desktop }`
- `DJLTerminalProfile.source: DJLTerminalSource` (decoded with default `.ssh`).
- `struct DesktopTerminalBinding: Equatable { let threadId: String; let terminalId: String }`
- `DesktopTerminalBinding.desktopTerminalId(forPhoneTerminalId:)` and `.phoneTerminalId(forDesktopTerminalId:)`.

- [ ] Write tests: decoding a profile without `source` yields `.ssh`; round-trip keeps `.desktop`; `term-1` ⇄ `default`; other ids verbatim.
- [ ] Register the test file in the pbxproj.
- [ ] Implement.
- [ ] Run the test class → pass.
- [ ] Commit `feat(ios): add desktop terminal source and bindings`.

### Task 4: iOS desktop terminal service

**Files:**
- Create: `apps/ios/DJL/Services/Terminal/CodexService+DesktopTerminal.swift`
- Modify: `apps/ios/DJL/Services/CodexService.swift` (state: `desktopTerminalBindings`, `desktopTerminalPendingAckBytes`, `desktopTerminalAckFlushTask`), `Services/CodexService+Incoming.swift` (`case "djl/terminal/event"`), `Services/Terminal/CodexService+Terminal.swift` (branch on `profile.source` in open/write/resize/close), `Services/CodexService+Presence.swift` (offline marking), `Services/CodexService+Sync.swift` (re-attach after reconnect).
- Test: `apps/ios/DJLTests/CodexServiceDesktopTerminalTests.swift`

**Interfaces:**
- `func openDesktopTerminal(terminalId: String, threadId: String, cwd: String?, cols: Int, rows: Int) async throws`
- `func handleDesktopTerminalEvent(_ paramsObject: IncomingParamsObject?)`
- `func markDesktopTerminalsOffline()` and `func reattachDesktopTerminalsIfNeeded()`
- Snapshot seeding: `applyDesktopTerminalSnapshot(_ object: [String: JSONValue], phoneTerminalId:)`.

- [ ] Write tests using `requestTransportOverride`: open sends `djl/terminal/open` with mapped ids and seeds the buffer from `replayPreamble + history`; `output` appends and accumulates pending ack bytes; `started` replaces the buffer with a new instance id; `exited`/`error` statuses; `markDesktopTerminalsOffline` sets the offline error.
- [ ] Register the test file in the pbxproj.
- [ ] Implement.
- [ ] Run the test class → pass.
- [ ] Commit `feat(ios): attach to desktop terminals over the relay`.

### Task 5: iOS navigation and terminal screen

**Files:**
- Modify: `apps/ios/DJL/ContentView.swift` (`terminal(preferredWorkingDirectory:threadID:)`), `Views/Terminal/TerminalScreen.swift` (source state, open branch, labels, session list), `Views/Terminal/TerminalOptionsMenu.swift` (Source section, "Detach" label).

- [ ] Add `threadID` to the route and pass `thread.id` from the thread view; other call sites pass nil.
- [ ] Add `@State private var terminalSource` initialised from the saved profile, defaulting to `.desktop` when a thread id is available, the host is online, and no SSH host is saved.
- [ ] In `openTerminal()`: desktop source → `codex.openDesktopTerminal(...)` with `threadID ?? codex.activeThreadId`; SSH path unchanged.
- [ ] Options menu: "Source" section with two checkmark buttons; hide SSH-only items (connection editor, reset host key) in desktop mode; toggle label "Detach".
- [ ] Build the app for the simulator → succeeds.
- [ ] Commit `feat(ios): open desktop terminals from the terminal screen`.

### Task 6: Verification

- [ ] Gateway: `node --test ./test/*.test.js` without concurrent load.
- [ ] iOS: full unit suite on the iPhone 17 simulator.
- [ ] Append `## Verified` to the spec and commit.
