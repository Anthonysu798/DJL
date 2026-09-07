# Remote Presence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The iPhone shows within seconds whether the paired laptop is reachable, and recovers on its own when it comes back, using only the existing relay transport.

**Architecture:** The relay pushes plaintext `hostPresence` control frames to phone sockets on host connect and close, and accepts phones that connect while the host is away. The gateway sends an encrypted heartbeat every 5 s. The phone folds both into a `hostPresence` state with a 15 s silence timer, surfaces it as a new `.hostOffline` connection phase, and polls the trusted resolve every 30 s while offline to catch gateway restarts.

**Tech Stack:** Cloudflare Workers TypeScript with Vitest (`apps/remote-relay`), Node 22 `node --test` (`apps/remote-gateway`), Swift/XCTest via `xcodebuild` (`apps/ios`). Spec: `docs/superpowers/specs/2026-09-04-remote-presence-design.md`.

## Global Constraints

- Heartbeat interval 5 000 ms; phone silence timeout 15 000 ms; restart fallback resolve every 30 000 ms, foreground only.
- Presence frame shape: `{ "kind": "hostPresence", "online": <bool>, "at": <unix ms> }`.
- Heartbeat notification: `{ "method": "djl/presence/heartbeat", "params": { "at": <unix ms> } }`; never routed to message handlers on the phone.
- Copy: badge "Device offline"; home title "Device offline"; home body "Your paired device is asleep or has no internet. DJL reconnects when it returns."; settings "Device offline · since <short time>".
- "Offline" alone keeps meaning the phone has no relay connection.
- New iOS test files must be registered in `apps/ios/DJL.xcodeproj/project.pbxproj` (the `DJLTests` group is not a synchronized folder).
- Gateway tests: `cd apps/remote-gateway && node --test ./test/*.test.js`. Relay: `bun run --cwd apps/remote-relay test && bun run --cwd apps/remote-relay build`. iOS: the `xcodebuild test` command in Task 4 Step 5.
- Commit after every task with the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## File Structure

| File | Responsibility |
| --- | --- |
| `apps/remote-relay/src/presence.ts` (new) | Pure: presence frame builder and recipient selection. |
| `apps/remote-relay/src/index.ts` | Send presence on host accept/close; accept host-less phones. |
| `apps/remote-gateway/src/presence-heartbeat.js` (new) | Pure: interval-driven heartbeat sender. |
| `apps/remote-gateway/src/bridge.js` | Start heartbeat on secure session ready; stop on shutdown. |
| `apps/ios/DJL/Services/CodexService+Presence.swift` (new) | `CodexHostPresence`, presence inputs, silence timer, restart fallback loop. |
| `apps/ios/DJL/Services/CodexService.swift` | New stored state and `.hostOffline` phase. |
| `apps/ios/DJL/Services/CodexService+SecureTransport.swift` | Route `hostPresence` frames; map `mac_offline`; mark activity on decrypted frames. |
| `apps/ios/DJL/Services/CodexService+Incoming.swift` | Consume the heartbeat notification; classify `hostPresence` as a control kind. |
| `apps/ios/DJL/Services/CodexService+Connection.swift`, `CodexService+Sync.swift` | Reset presence on disconnect; start/stop the fallback loop with foreground state. |
| Four SwiftUI files listed in Task 5 | Render `.hostOffline`. |

---

### Task 1: Relay presence frames

**Files:**
- Create: `apps/remote-relay/src/presence.ts`
- Test: `apps/remote-relay/src/presence.test.ts`
- Modify: `apps/remote-relay/src/index.ts` (`DJLRelaySession.fetch` lines 225-243, `webSocketClose` lines 289-297)

**Interfaces:**
- Produces: `buildHostPresenceFrame(online: boolean, at: number): { kind: "hostPresence"; online: boolean; at: number }` and `serializeHostPresenceFrame(online, at): string`.

- [ ] **Step 1: Write the failing test**

```ts
// FILE: presence.test.ts
// Purpose: Verifies the relay's host presence control frame.
import { describe, expect, it } from "vitest";

import { buildHostPresenceFrame, serializeHostPresenceFrame } from "./presence";

describe("host presence frames", () => {
  it("builds a plaintext control frame with the host state and timestamp", () => {
    expect(buildHostPresenceFrame(true, 1_700_000_000_000)).toEqual({
      kind: "hostPresence",
      online: true,
      at: 1_700_000_000_000,
    });
  });

  it("serializes to JSON the phone can classify by kind", () => {
    const text = serializeHostPresenceFrame(false, 42);
    expect(JSON.parse(text)).toEqual({ kind: "hostPresence", online: false, at: 42 });
    expect(text).toContain("\"kind\":\"hostPresence\"");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run --cwd apps/remote-relay test`
Expected: FAIL, cannot resolve `./presence`.

- [ ] **Step 3: Write the module**

```ts
// FILE: presence.ts
// Purpose: Host presence control frames the relay pushes to phone sockets.

export interface HostPresenceFrame {
  readonly kind: "hostPresence";
  readonly online: boolean;
  readonly at: number;
}

// Plaintext by design: the relay already observes host connect and close
// times, so telling the phone adds nothing it could not infer.
export const buildHostPresenceFrame = (online: boolean, at: number): HostPresenceFrame => ({
  kind: "hostPresence",
  online,
  at,
});

export const serializeHostPresenceFrame = (online: boolean, at: number): string =>
  JSON.stringify(buildHostPresenceFrame(online, at));
```

- [ ] **Step 4: Wire the Durable Object**

In `apps/remote-relay/src/index.ts` add the import next to the other local imports:

```ts
import { serializeHostPresenceFrame } from "./presence";
```

In `DJLRelaySession.fetch`, replace:

```ts
    } else if (this.ctx.getWebSockets("role:mac").length === 0) {
      return errorResponse(409, "host_offline", "The paired computer is offline.");
    }
```

with:

```ts
    }
```

and replace the accept block:

```ts
    server.serializeAttachment(attachment);
    this.ctx.acceptWebSocket(server, [`role:${role}`]);
    return new Response(null, { status: 101, webSocket: client });
```

with:

```ts
    server.serializeAttachment(attachment);
    this.ctx.acceptWebSocket(server, [`role:${role}`]);
    if (role === "mac") {
      this.broadcastHostPresence(true);
    } else {
      // A phone may wait for an absent host; tell it the current state at once.
      const hostOnline = this.ctx.getWebSockets("role:mac").length > 0;
      server.send(serializeHostPresenceFrame(hostOnline, Date.now()));
    }
    return new Response(null, { status: 101, webSocket: client });
```

Replace `webSocketClose`:

```ts
  override async webSocketClose(
    socket: WebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean,
  ): Promise<void> {
    const attachment = socket.deserializeAttachment() as SocketAttachment | null;
    if (attachment?.role === "mac" && this.ctx.getWebSockets("role:mac").length === 0) {
      this.broadcastHostPresence(false);
    }
    await finalizeRelaySocketClose(attachment?.role, () => this.markRegistryOffline());
  }

  private broadcastHostPresence(online: boolean): void {
    const frame = serializeHostPresenceFrame(online, Date.now());
    for (const phone of this.ctx.getWebSockets("role:iphone")) {
      if (phone.readyState === WebSocket.OPEN) phone.send(frame);
    }
  }
```

Note: `getWebSockets("role:mac")` inside `webSocketClose` may still include the closing socket depending on runtime timing. Guard by checking `readyState === WebSocket.OPEN` on each: change the condition to
`this.ctx.getWebSockets("role:mac").filter((s) => s !== socket && s.readyState === WebSocket.OPEN).length === 0`.

- [ ] **Step 5: Run relay tests and build**

Run: `bun run --cwd apps/remote-relay test && bun run --cwd apps/remote-relay build`
Expected: 16 tests pass; dry-run build succeeds.

- [ ] **Step 6: Commit**

```bash
git add apps/remote-relay/src/presence.ts apps/remote-relay/src/presence.test.ts apps/remote-relay/src/index.ts
git commit -m "feat(remote-relay): push host presence frames and accept waiting phones

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Gateway heartbeat

**Files:**
- Create: `apps/remote-gateway/src/presence-heartbeat.js`
- Test: `apps/remote-gateway/test/presence-heartbeat.test.js`
- Modify: `apps/remote-gateway/src/bridge.js` (`onSecureSessionReady` at line 845, `prepareBridgeShutdown` at line 999)

**Interfaces:**
- Produces: `createPresenceHeartbeat({ intervalMs = 5000, setIntervalFn = setInterval, clearIntervalFn = clearInterval, now = Date.now, send, isReady = () => true })` with `start()`, `stop()`, `isRunning()`. `send(payloadText)` receives the serialized heartbeat notification.

- [ ] **Step 1: Write the failing test**

```js
// FILE: presence-heartbeat.test.js
// Purpose: Verifies the bridge heartbeat ticks only while running and the channel is ready.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createPresenceHeartbeat } = require("../src/presence-heartbeat");

function createFakeInterval() {
  let callback = null;
  return {
    setIntervalFn(fn) {
      callback = fn;
      return { unref() {} };
    },
    clearIntervalFn() {
      callback = null;
    },
    tick: () => callback?.(),
    isArmed: () => callback !== null,
  };
}

test("heartbeat sends a timestamped notification on every tick", () => {
  const timers = createFakeInterval();
  const sent = [];
  const heartbeat = createPresenceHeartbeat({
    ...timers,
    now: () => 1_700_000_000_000,
    send: (text) => sent.push(JSON.parse(text)),
  });

  heartbeat.start();
  timers.tick();
  timers.tick();

  assert.equal(sent.length, 2);
  assert.deepEqual(sent[0], { method: "djl/presence/heartbeat", params: { at: 1_700_000_000_000 } });
  assert.equal(heartbeat.isRunning(), true);
});

test("heartbeat skips ticks while the channel is not ready", () => {
  const timers = createFakeInterval();
  const sent = [];
  let ready = false;
  const heartbeat = createPresenceHeartbeat({
    ...timers,
    isReady: () => ready,
    send: (text) => sent.push(text),
  });

  heartbeat.start();
  timers.tick();
  ready = true;
  timers.tick();

  assert.equal(sent.length, 1);
});

test("start is idempotent and stop disarms the interval", () => {
  const timers = createFakeInterval();
  const heartbeat = createPresenceHeartbeat({ ...timers, send: () => {} });

  heartbeat.start();
  heartbeat.start();
  assert.equal(timers.isArmed(), true);
  heartbeat.stop();
  assert.equal(timers.isArmed(), false);
  assert.equal(heartbeat.isRunning(), false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/remote-gateway && node --test ./test/presence-heartbeat.test.js`
Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Write the module**

```js
// FILE: presence-heartbeat.js
// Purpose: Sends a periodic encrypted heartbeat so the phone can tell a sleeping laptop from a quiet one.
// Layer: CLI helper
// Exports: createPresenceHeartbeat, PRESENCE_HEARTBEAT_METHOD, DEFAULT_PRESENCE_HEARTBEAT_MS
// Depends on: nothing

const PRESENCE_HEARTBEAT_METHOD = "djl/presence/heartbeat";
const DEFAULT_PRESENCE_HEARTBEAT_MS = 5_000;

function createPresenceHeartbeat({
  intervalMs = DEFAULT_PRESENCE_HEARTBEAT_MS,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  now = Date.now,
  send,
  isReady = () => true,
} = {}) {
  if (typeof send !== "function") {
    throw new Error("presence heartbeat requires a send callback");
  }
  let timer = null;

  function start() {
    if (timer != null) return;
    timer = setIntervalFn(() => {
      if (!isReady()) return;
      send(JSON.stringify({ method: PRESENCE_HEARTBEAT_METHOD, params: { at: now() } }));
    }, intervalMs);
    timer?.unref?.();
  }

  function stop() {
    if (timer == null) return;
    clearIntervalFn(timer);
    timer = null;
  }

  return { start, stop, isRunning: () => timer != null };
}

module.exports = {
  createPresenceHeartbeat,
  PRESENCE_HEARTBEAT_METHOD,
  DEFAULT_PRESENCE_HEARTBEAT_MS,
};
```

- [ ] **Step 4: Wire it into bridge.js**

Add the require next to the reconnect policy require:

```js
const { createPresenceHeartbeat } = require("./presence-heartbeat");
```

After the `sendApplicationResponse` function definition (line ~1365) is not in scope at construction time, so declare the heartbeat right after `secureTransport` is created (after the `createBridgeSecureTransport({...})` call ends, before `sendRelayWireMessage`):

```js
  const presenceHeartbeat = createPresenceHeartbeat({
    send: (payloadText) => sendApplicationResponse(payloadText),
    isReady: () => socket?.readyState === WebSocket.OPEN && secureTransport.isSecureChannelReady(),
  });
```

`sendApplicationResponse` is a hoisted function declaration in the same closure, so referencing it inside the arrow is fine.

In `onSecureSessionReady(session) {` add as the first line:

```js
      presenceHeartbeat.start();
```

In `prepareBridgeShutdown()` add after `secureTransport.flushOutbound?.();`:

```js
    presenceHeartbeat.stop();
```

- [ ] **Step 5: Run the gateway suite**

Run: `cd apps/remote-gateway && node --test ./test/*.test.js`
Expected: all pass (693 tests). The `bridge serves Desktop-owned thread history from cached IPC state` test is a known timing flake under the parallel runner; rerun `node --test ./test/bridge.test.js` alone if it is the only failure.

- [ ] **Step 6: Commit**

```bash
git add apps/remote-gateway/src/presence-heartbeat.js apps/remote-gateway/test/presence-heartbeat.test.js apps/remote-gateway/src/bridge.js
git commit -m "feat(remote-gateway): send a 5s presence heartbeat over the secure channel

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Phone presence state machine

**Files:**
- Create: `apps/ios/DJL/Services/CodexService+Presence.swift`
- Modify: `apps/ios/DJL/Services/CodexService.swift` (`enum CodexConnectionPhase` at line 307, stored vars near line 452, `connectionPhase` at line 1158, `connectionPhaseDisplayLabel` at line 1178)
- Modify: `apps/ios/DJL/Services/CodexService+Incoming.swift` (`secureKindValues` in `WireMessagePreDecoder`, `handleNotification` switch)
- Modify: `apps/ios/DJL/Services/CodexService+SecureTransport.swift` (`processIncomingWireText` at line 222, decrypted payload path at line 1080, resolve error switch at line 1206)
- Modify: `apps/ios/DJL/Services/CodexService+Connection.swift` (`disconnect` at line 152, `handleReceiveError` at line 494)
- Modify: `apps/ios/DJL/Services/CodexService+Sync.swift` (`setForegroundState` at line 98)
- Create: `apps/ios/DJLTests/CodexServicePresenceTests.swift`
- Modify: `apps/ios/DJL.xcodeproj/project.pbxproj` (register the test file)

**Interfaces:**
- Produces: `enum CodexHostPresence { case unknown, online, offline(since: Date) }`; `CodexService.hostPresence`, `CodexService.lastHostActivityAt`, `CodexService.hostPresenceSilenceOverrideNanoseconds` (test hook), `CodexService.hostPresenceFallbackResolveOverrideNanoseconds` (test hook), `func noteHostActivity()`, `func applyHostPresenceFrame(_ rawText: String)`, `func resetHostPresence()`, `CodexConnectionPhase.hostOffline`.

- [ ] **Step 1: Write the failing tests**

```swift
// FILE: CodexServicePresenceTests.swift
// Purpose: Verifies host presence from relay frames, heartbeats, and silence.
// Layer: Unit Test
// Exports: CodexServicePresenceTests
// Depends on: XCTest, DJL

import XCTest
@testable import DJL

@MainActor
final class CodexServicePresenceTests: XCTestCase {
    private static var retainedServices: [CodexService] = []

    func testPresenceFrameSetsOfflineThenOnline() {
        let service = makeConnectedService()

        service.processIncomingWireText("{\"kind\":\"hostPresence\",\"online\":false,\"at\":1700000000000}")
        guard case .offline = service.hostPresence else {
            return XCTFail("Expected offline, got \(service.hostPresence)")
        }
        XCTAssertEqual(service.connectionPhase, .hostOffline)

        service.processIncomingWireText("{\"kind\":\"hostPresence\",\"online\":true,\"at\":1700000005000}")
        XCTAssertEqual(service.hostPresence, .online)
        XCTAssertEqual(service.connectionPhase, .connected)
    }

    func testHeartbeatNotificationMarksOnlineAndIsNotRoutedAsAMessage() {
        let service = makeConnectedService()
        service.hostPresence = .offline(since: Date(timeIntervalSince1970: 0))

        service.processIncomingText("{\"method\":\"djl/presence/heartbeat\",\"params\":{\"at\":1700000000000}}")

        XCTAssertEqual(service.hostPresence, .online)
        XCTAssertNotNil(service.lastHostActivityAt)
        XCTAssertTrue(service.messagesByThread.isEmpty)
        XCTAssertNil(service.lastErrorMessage)
    }

    func testSilenceFlipsToOfflineAndActivityFlipsBack() async {
        let service = makeConnectedService()
        service.hostPresenceSilenceOverrideNanoseconds = 20_000_000
        service.noteHostActivity()
        XCTAssertEqual(service.hostPresence, .online)

        try? await Task.sleep(nanoseconds: 120_000_000)

        guard case .offline = service.hostPresence else {
            return XCTFail("Expected silence to mark the host offline")
        }
        service.noteHostActivity()
        XCTAssertEqual(service.hostPresence, .online)
    }

    func testDisconnectResetsPresence() async {
        let service = makeConnectedService()
        service.noteHostActivity()

        await service.disconnect()

        XCTAssertEqual(service.hostPresence, .unknown)
        XCTAssertEqual(service.connectionPhase, .offline)
    }

    func testMalformedPresenceFrameIsIgnored() {
        let service = makeConnectedService()
        service.noteHostActivity()

        service.processIncomingWireText("{\"kind\":\"hostPresence\",\"online\":\"yes\"}")

        XCTAssertEqual(service.hostPresence, .online)
    }

    func testMacOfflineResolveCodeMapsToOfflineError() {
        XCTAssertEqual(
            CodexService.trustedResolveErrorCodeIsMacOffline("mac_offline"),
            true
        )
        XCTAssertEqual(
            CodexService.trustedResolveErrorCodeIsMacOffline("session_unavailable"),
            true
        )
        XCTAssertEqual(
            CodexService.trustedResolveErrorCodeIsMacOffline("phone_not_trusted"),
            false
        )
    }

    private func makeConnectedService() -> CodexService {
        let suiteName = "CodexServicePresenceTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName) ?? .standard
        defaults.removePersistentDomain(forName: suiteName)
        let service = CodexService(defaults: defaults)
        service.messagesByThread = [:]
        service.isConnected = true
        service.isInitialized = true
        // CodexService currently crashes while deallocating in unit-test environment.
        // Keep instances alive for process lifetime so assertions remain deterministic.
        Self.retainedServices.append(service)
        return service
    }
}
```

- [ ] **Step 2: Register the test file in the project**

In `apps/ios/DJL.xcodeproj/project.pbxproj` add, in the same four places the existing `CodexServiceBatchIncomingTests.swift` entries appear (PBXBuildFile, PBXFileReference, the DJLTests group children, the DJLTests Sources build phase), these lines using fresh ids:

```
		D3A1B2C4E5F60718293A4B05 /* CodexServicePresenceTests.swift in Sources */ = {isa = PBXBuildFile; fileRef = D3A1B2C4E5F60718293A4B06 /* CodexServicePresenceTests.swift */; };
		D3A1B2C4E5F60718293A4B06 /* CodexServicePresenceTests.swift */ = {isa = PBXFileReference; includeInIndex = 1; lastKnownFileType = sourcecode.swift; path = CodexServicePresenceTests.swift; sourceTree = "<group>"; };
				D3A1B2C4E5F60718293A4B06 /* CodexServicePresenceTests.swift */,
				D3A1B2C4E5F60718293A4B05 /* CodexServicePresenceTests.swift in Sources */,
```

- [ ] **Step 3: Run the test class to verify it fails**

Run from `apps/ios`:

```bash
xcodebuild test -project DJL.xcodeproj -scheme DJL -destination 'platform=iOS Simulator,id=AD05D790-2A21-4DF7-9FFB-22177ABBDCEB' -only-testing:DJLTests/CodexServicePresenceTests -derivedDataPath /private/tmp/claude-501/-Users-toni798-Documents-Production-DJL/765f9bc7-caab-49df-b17e-93b2d363c56c/scratchpad/DerivedData CODE_SIGNING_ALLOWED=NO 2>&1 | grep -E "error:|Test Case|\*\* TEST"
```

Expected: build fails on `hostPresence` (undefined).

- [ ] **Step 4: Add the state and phase to CodexService.swift**

Replace the phase enum:

```swift
enum CodexConnectionPhase: Equatable, Sendable {
    case offline
    case connecting
    case loadingChats
    case syncing
    case connected
    // The relay socket is up but the paired device is asleep or unreachable.
    case hostOffline
}
```

After `var isConnected = false` add:

```swift
    // Whether the paired device is reachable through the relay, as reported by
    // relay presence frames, the bridge heartbeat, and a silence timer.
    var hostPresence: CodexHostPresence = .unknown
    var lastHostActivityAt: Date?
    @ObservationIgnored var hostPresenceSilenceTask: Task<Void, Never>?
    @ObservationIgnored var hostPresenceSilenceOverrideNanoseconds: UInt64?
    @ObservationIgnored var hostPresenceFallbackResolveTask: Task<Void, Never>?
    @ObservationIgnored var hostPresenceFallbackResolveOverrideNanoseconds: UInt64?
```

In `connectionPhase`, after the `guard isConnected else { return .offline }` block add:

```swift
        if case .offline = hostPresence {
            return .hostOffline
        }
```

In `connectionPhaseDisplayLabel` add a case:

```swift
        case .hostOffline:
            return "Device offline"
```

- [ ] **Step 5: Write CodexService+Presence.swift**

```swift
// FILE: CodexService+Presence.swift
// Purpose: Tracks whether the paired device is reachable and drives recovery when it returns.
// Layer: Service Extension
// Exports: CodexHostPresence, CodexService presence APIs
// Depends on: CodexService, CodexService+SecureTransport, CodexService+Sync

import Foundation

enum CodexHostPresence: Equatable, Sendable {
    case unknown
    case online
    case offline(since: Date)
}

private struct HostPresenceFrame: Decodable {
    let kind: String
    let online: Bool
    let at: Double?
}

extension CodexService {
    static let hostPresenceSilenceNanoseconds: UInt64 = 15_000_000_000
    static let hostPresenceFallbackResolveNanoseconds: UInt64 = 30_000_000_000
    static let presenceHeartbeatMethod = "djl/presence/heartbeat"

    // Any frame that came through the paired device proves it is alive.
    func noteHostActivity() {
        lastHostActivityAt = Date()
        let wasOffline: Bool
        if case .offline = hostPresence { wasOffline = true } else { wasOffline = false }
        hostPresence = .online
        restartHostPresenceSilenceTimer()
        if wasOffline {
            stopHostPresenceFallbackResolve()
            requestImmediateSync(threadId: activeThreadId)
        }
    }

    // Relay control frame: the host socket connected or closed at the relay.
    func applyHostPresenceFrame(_ rawText: String) {
        guard let data = rawText.data(using: .utf8),
              let frame = try? JSONDecoder().decode(HostPresenceFrame.self, from: data),
              frame.kind == "hostPresence" else {
            return
        }
        if frame.online {
            noteHostActivity()
            return
        }
        markHostOffline(since: frame.at.map { Date(timeIntervalSince1970: $0 / 1000) } ?? Date())
    }

    func markHostOffline(since: Date) {
        if case .offline = hostPresence {
            return
        }
        hostPresence = .offline(since: since)
        hostPresenceSilenceTask?.cancel()
        hostPresenceSilenceTask = nil
        startHostPresenceFallbackResolveIfNeeded()
    }

    func resetHostPresence() {
        hostPresenceSilenceTask?.cancel()
        hostPresenceSilenceTask = nil
        stopHostPresenceFallbackResolve()
        hostPresence = .unknown
        lastHostActivityAt = nil
    }

    // Called from setForegroundState: the fallback poll only runs while visible.
    func updateHostPresenceFallbackForForegroundChange() {
        if isAppInForeground {
            startHostPresenceFallbackResolveIfNeeded()
        } else {
            stopHostPresenceFallbackResolve()
        }
    }

    private func restartHostPresenceSilenceTimer() {
        hostPresenceSilenceTask?.cancel()
        guard isConnected else {
            hostPresenceSilenceTask = nil
            return
        }
        let timeout = hostPresenceSilenceOverrideNanoseconds ?? Self.hostPresenceSilenceNanoseconds
        hostPresenceSilenceTask = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: timeout)
            guard !Task.isCancelled, let self, self.isConnected else { return }
            self.markHostOffline(since: self.lastHostActivityAt ?? Date())
        }
    }

    // A gateway restart registers a new relay session that a waiting socket can
    // never see. Resolving the trusted session every 30s catches that case.
    private func startHostPresenceFallbackResolveIfNeeded() {
        guard hostPresenceFallbackResolveTask == nil,
              isAppInForeground,
              case .offline = hostPresence,
              hasReconnectCandidate else {
            return
        }
        let interval = hostPresenceFallbackResolveOverrideNanoseconds ?? Self.hostPresenceFallbackResolveNanoseconds
        hostPresenceFallbackResolveTask = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: interval)
                guard !Task.isCancelled, let self else { return }
                guard case .offline = self.hostPresence, self.isAppInForeground else { return }
                let currentSessionId = self.relaySessionId
                guard let resolved = try? await self.resolveTrustedMacSessionImpl(),
                      resolved.sessionId != currentSessionId else {
                    continue
                }
                // The bridge came back on a new session: rebuild the socket on it.
                await self.disconnect(preserveReconnectIntent: true)
                self.shouldAutoReconnectOnForeground = true
                return
            }
        }
    }

    private func stopHostPresenceFallbackResolve() {
        hostPresenceFallbackResolveTask?.cancel()
        hostPresenceFallbackResolveTask = nil
    }

    static func trustedResolveErrorCodeIsMacOffline(_ code: String?) -> Bool {
        code == "session_unavailable" || code == "mac_offline"
    }
}
```

Check `hasReconnectCandidate` and `activeThreadId` exist on `CodexService` (`grep -n "var hasReconnectCandidate\|var activeThreadId" apps/ios/DJL/Services/*.swift`); both are used by existing code in `CodexService+Sync.swift` and `ContentViewModel.swift`. Check `resolved.sessionId` is a property of `CodexTrustedSessionResolveResponse` (`grep -n "struct CodexTrustedSessionResolveResponse" -A 8 apps/ios/DJL/Services/CodexSecureTransportModels.swift`).

- [ ] **Step 6: Route frames and the heartbeat**

In `CodexService+Incoming.swift`, `WireMessagePreDecoder.secureKindValues` becomes:

```swift
    private static let secureKindValues = [
        "\"serverHello\"", "\"secureReady\"", "\"secureError\"", "\"encryptedEnvelope\"",
        "\"hostPresence\""
    ]
```

In `handleIncomingRPCMessage`, before `if let method = message.method {`, add:

```swift
        if message.method == Self.presenceHeartbeatMethod {
            noteHostActivity()
            return
        }
```

In `CodexService+SecureTransport.swift` `processIncomingWireText`, add a case to the `switch kind`:

```swift
            case "hostPresence":
                applyHostPresenceFrame(text)
                return
```

In the decrypted envelope path, replace:

```swift
            lastRawMessage = payload.payloadText
            processIncomingText(payload.payloadText)
```

with:

```swift
            noteHostActivity()
            lastRawMessage = payload.payloadText
            processIncomingText(payload.payloadText)
```

In `sendTrustedSessionResolveRequest`, replace:

```swift
        switch errorResponse?.code {
        case "session_unavailable":
            secureConnectionState = .liveSessionUnresolved
            throw CodexTrustedSessionResolveError.macOffline("Your trusted device is offline right now.")
```

with:

```swift
        if Self.trustedResolveErrorCodeIsMacOffline(errorResponse?.code) {
            secureConnectionState = .liveSessionUnresolved
            throw CodexTrustedSessionResolveError.macOffline("Your trusted device is offline right now.")
        }
        switch errorResponse?.code {
```

and delete the now-duplicated `case "session_unavailable":` arm (the two lines under it) so the switch starts at `case "phone_not_trusted", "invalid_signature":`.

In `CodexService+Connection.swift`, in `disconnect(preserveReconnectIntent:)` after `isInitialized = false` add:

```swift
        resetHostPresence()
```

and in `handleReceiveError` after `isInitialized = false` add the same line.

In `CodexService+Sync.swift` `setForegroundState`, add before `updateBackgroundRunGraceTask()`:

```swift
        updateHostPresenceFallbackForForegroundChange()
```

In `CodexService+Connection.swift` `connect(...)`, right after `startWebSocketKeepAliveLoop()` add:

```swift
            noteHostActivity()
```

- [ ] **Step 7: Run the presence test class**

Run the Step 3 command.
Expected: 6 tests pass. If `testSilenceFlipsToOfflineAndActivityFlipsBack` is flaky under 120 ms, raise the sleep to 250 ms; do not raise the override.

- [ ] **Step 8: Commit**

```bash
git add apps/ios/DJL/Services/CodexService+Presence.swift apps/ios/DJL/Services/CodexService.swift apps/ios/DJL/Services/CodexService+Incoming.swift apps/ios/DJL/Services/CodexService+SecureTransport.swift apps/ios/DJL/Services/CodexService+Connection.swift apps/ios/DJL/Services/CodexService+Sync.swift apps/ios/DJLTests/CodexServicePresenceTests.swift apps/ios/DJL.xcodeproj/project.pbxproj
git commit -m "feat(ios): track paired-device presence from relay frames and heartbeats

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Render the host-offline phase

**Files:**
- Modify: `apps/ios/DJL/Views/Sidebar/SidebarConnectionStatusBadge.swift:70-106`
- Modify: `apps/ios/DJL/Views/Home/HomeEmptyStateView.swift:127-195`
- Modify: `apps/ios/DJL/Views/Settings/SettingsConnectionCard.swift:92-127`
- Modify: `apps/ios/DJL/Views/Sidebar/SidebarConnectionEmptyStatePanel.swift:247-286`

The compiler enforces exhaustiveness, so every `switch connectionPhase` gets a `.hostOffline` arm. Apply these rules in all four files:

- `isBusy`: add `.hostOffline` to the `false` arm.
- `statusDotColor`: `case .hostOffline: return Color(.tertiaryLabel)`.
- `statusLabel` and `connectionStatusLabel`: `case .hostOffline: return "Device offline"`.
- `primaryButtonTitle`: `case .hostOffline: return "Waiting for device…"`.
- `isSocketReady`: add `.hostOffline` to the `true` arm (the socket is up; only the host is away).
- `connectionProgressLabel` (settings): add `.hostOffline` to the `""` arm.

- [ ] **Step 1: Edit the four files**

Sidebar badge (`SidebarConnectionStatusBadge.swift`):

```swift
    private var isBusy: Bool {
        switch connectionPhase {
        case .connecting, .loadingChats, .syncing:
            return true
        case .offline, .connected, .hostOffline:
            return false
        }
    }

    private var statusDotColor: Color {
        switch connectionPhase {
        case .connecting, .loadingChats, .syncing:
            return .orange
        case .connected:
            return .green
        case .offline, .hostOffline:
            return Color(.tertiaryLabel)
        }
    }

    private var statusLabel: String {
        switch connectionPhase {
        case .connecting:
            guard let connectionAttemptStartedAt else { return "Connecting" }
            let elapsed = Date().timeIntervalSince(connectionAttemptStartedAt)
            if elapsed >= 12 { return "Still connecting…" }
            return "Connecting"
        case .loadingChats:
            return "Loading chats"
        case .syncing:
            return "Syncing"
        case .connected:
            return "Connected"
        case .offline:
            return "Offline"
        case .hostOffline:
            return "Device offline"
        }
    }
```

Home empty state (`HomeEmptyStateView.swift`): same three edits as the badge, plus:

```swift
    private var primaryButtonTitle: String {
        switch connectionPhase {
        case .connecting:
            return "Reconnecting..."
        case .loadingChats:
            return "Loading chats..."
        case .syncing:
            return "Syncing..."
        case .connected:
            return "Disconnect"
        case .hostOffline:
            return "Waiting for device…"
        case .offline:
            return offlinePrimaryButtonTitle
        }
    }

    private var isSocketReady: Bool {
        switch connectionPhase {
        case .loadingChats, .syncing, .connected, .hostOffline:
            return true
        case .offline, .connecting:
            return false
        }
    }
```

Find the view's title and body text for the `.offline` case in the same file (search `"No device paired yet"` and the subtitle helper) and add a `.hostOffline` branch returning title `"Device offline"` and body `"Your paired device is asleep or has no internet. DJL reconnects when it returns."`.

Settings connection card (`SettingsConnectionCard.swift`):

```swift
    private var connectionPhaseShowsProgress: Bool {
        switch codex.connectionPhase {
        case .connecting, .loadingChats, .syncing:
            return true
        case .offline, .connected, .hostOffline:
            return false
        }
    }

    private var connectionStatusLabel: String {
        switch codex.connectionPhase {
        case .offline:
            return "Offline"
        case .hostOffline:
            if case .offline(let since) = codex.hostPresence {
                return "Device offline · since \(since.formatted(date: .omitted, time: .shortened))"
            }
            return "Device offline"
        case .connecting:
            return "Connecting"
        case .loadingChats:
            return "Loading"
        case .syncing:
            return "Syncing"
        case .connected:
            return "Connected"
        }
    }

    private var connectionProgressLabel: String {
        switch codex.connectionPhase {
        case .connecting:
            return "Connecting to relay…"
        case .loadingChats:
            return "Loading chats…"
        case .syncing:
            return "Syncing workspace…"
        case .offline, .connected, .hostOffline:
            return ""
        }
    }
```

Sidebar empty-state panel (`SidebarConnectionEmptyStatePanel.swift`): `isBusy` gets `.hostOffline` in the `false` arm; `primaryButtonTitle` gets `case .hostOffline: return "Waiting for device…"`; `isSocketReady` gets `.hostOffline` in the `true` arm. Search the file for the `.offline` title/detail helpers around line 259 (`return "Reconnecting…"`) and add a `.hostOffline` branch with the same "Device offline" title and body as the home view.

- [ ] **Step 2: Build the app target and run the whole unit suite**

Run from `apps/ios`:

```bash
xcodebuild test -project DJL.xcodeproj -scheme DJL -destination 'platform=iOS Simulator,id=AD05D790-2A21-4DF7-9FFB-22177ABBDCEB' -only-testing:DJLTests -derivedDataPath /private/tmp/claude-501/-Users-toni798-Documents-Production-DJL/765f9bc7-caab-49df-b17e-93b2d363c56c/scratchpad/DerivedData CODE_SIGNING_ALLOWED=NO 2>&1 | grep -E "error:|\*\* TEST|Executed [0-9]+ tests"
```

Expected: `** TEST SUCCEEDED **`, `Executed 842 tests, with 0 failures`. Any "switch must be exhaustive" error names a file still missing the `.hostOffline` arm; fix it there.

- [ ] **Step 3: Commit**

```bash
git add apps/ios/DJL/Views/Sidebar/SidebarConnectionStatusBadge.swift apps/ios/DJL/Views/Home/HomeEmptyStateView.swift apps/ios/DJL/Views/Settings/SettingsConnectionCard.swift apps/ios/DJL/Views/Sidebar/SidebarConnectionEmptyStatePanel.swift
git commit -m "feat(ios): show a Device offline state distinct from the phone being offline

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: End-to-end check

- [ ] **Step 1: Run every suite**

```bash
cd apps/remote-gateway && node --test ./test/*.test.js
bun run --cwd apps/remote-relay test && bun run --cwd apps/remote-relay build
```

plus the iOS command from Task 4 Step 2. Expected: all green.

- [ ] **Step 2: Simulator check**

Launch the built app on the iPhone 17 Pro simulator and open Settings. With no paired device the badge still reads "Offline" (phone side), confirming the two states stay distinct. The sleep/wake path needs a paired desktop build and is recorded as "not measured" in the spec if unavailable.

- [ ] **Step 3: Record**

Append to the spec:

```markdown
## Verified

- Automated: relay, gateway, iOS suites green on <date>.
- Sleep/wake on hardware: <observed | not measured, reason>.
```

Commit with `docs: record presence verification`.
