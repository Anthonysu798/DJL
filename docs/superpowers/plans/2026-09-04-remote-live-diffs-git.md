# Remote Live Diffs, Tool Activity, and Git Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Desktop-backed threads on the phone show command runs, file edits, and turn diffs live, and git actions started on the desktop show progress on the phone.

**Architecture:** A new backend stream broadcasts git action progress. The gateway's pure projection maps tool activities and turn diffs to the phone's existing item notifications; the adapter answers `workspace/checkpointDiff` from the backend's turn diff and forwards git progress. The phone keeps desktop git progress per working directory and renders it in the existing toast.

**Tech Stack:** Effect RPC contracts (`packages/contracts`), Effect server (`apps/server`), Node gateway (`apps/remote-gateway`), Swift/XCTest (`apps/ios`). Spec: `docs/superpowers/specs/2026-09-04-remote-live-diffs-git-design.md`.

## Global Constraints

- New phone notification: `djl/git/desktopActionProgress` with the backend event fields verbatim.
- Tool item ids: `data.toolCallId ?? data.callID ?? activity.id`.
- `workspace/checkpointDiff` intercept answers `{ repoRoot, fromCheckpointRef: "turnStart:<turnId>", toCheckpointRef: "turnEnd:<turnId>", diff }`; unknown turns fall through.
- Gateway tests: `cd apps/remote-gateway && node --test ./test/*.test.js`. Contracts/server typecheck: `bun run --cwd packages/contracts build` then `bun run --cwd apps/server typecheck` (fall back to `bunx tsc -p apps/server --noEmit` if no script). iOS: the `xcodebuild test` command from the presence plan.
- Commit after every task with the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

### Task 1: Backend git progress broadcast

**Files:**
- Modify: `packages/contracts/src/rpc.ts` (next to `WsSubscribeTerminalEventsRpc`, and the `WsRpcGroup` list)
- Modify: `apps/server/src/wsRpc.ts` (imports; layer body near line 316; `gitRunStackedAction` handler near line 1096)

- [ ] **Step 1: Contracts**

Add after `WsSubscribeTerminalEventsRpc`:

```ts
export const WsSubscribeGitActionProgressRpc = Rpc.make(WS_METHODS.subscribeGitActionProgress, {
  payload: Schema.Struct({}),
  success: GitActionProgressEvent,
  error: WsRpcError,
  stream: true,
});
```

Import `GitActionProgressEvent` from `./git` if it is not already imported, and add `WsSubscribeGitActionProgressRpc,` to `WsRpcGroup` right after `WsSubscribeTerminalEventsRpc,`.

- [ ] **Step 2: Server**

Add `PubSub` to the `effect` import. In the layer's `Effect.gen`, after the service lookups, add:

```ts
      // Desktop-started git actions fan out here so remote observers (the
      // phone bridge) can follow progress that used to reach only the caller.
      const gitActionProgressPubSub = yield* PubSub.unbounded<GitActionProgressEvent>();
```

In the `gitRunStackedAction` handler change `publish: (event) => Queue.offer(queue, event).pipe(Effect.asVoid),` to:

```ts
                    publish: (event) =>
                      Queue.offer(queue, event).pipe(
                        Effect.andThen(PubSub.publish(gitActionProgressPubSub, event)),
                        Effect.asVoid,
                      ),
```

Add a handler next to `subscribeTerminalEvents`:

```ts
        [WS_METHODS.subscribeGitActionProgress]: () =>
          bufferLiveUiStream(Stream.fromPubSub(gitActionProgressPubSub), {
            label: "git.action-progress",
          }),
```

- [ ] **Step 3: Build and typecheck**

Run: `bun run --cwd packages/contracts build && bun run --cwd apps/server typecheck`
Expected: clean. If the server has no `typecheck` script, run `cd apps/server && bunx tsc --noEmit -p tsconfig.json`.

- [ ] **Step 4: Commit** `feat(server): broadcast git action progress to subscribers`

---

### Task 2: Projection: tool activity, turn diffs, git progress

**Files:**
- Modify: `apps/remote-gateway/src/electron-event-projection.js`
- Test: `apps/remote-gateway/test/electron-event-projection.test.js`

**Interfaces:**
- Produces: `applyThreadEvent` handles `thread.activity-appended` (tool tone) and `thread.turn-diff-completed`; `checkpointTurnCount(threadId, turnId)` returns the remembered count or `null`; exported pure helpers `checkpointFileChangeItem(checkpoint)` and `desktopGitProgressNotification(event)`.

- [ ] **Step 1: Tests** (append)

```js
test("command activities become started and completed command items", () => {
  const projection = createThreadEventProjection();
  projection.hydrate(THREAD, 10);
  const activity = (id, kind, payload) =>
    threadEvent("thread.activity-appended", {
      threadId: "thread-1",
      activity: { id, tone: "tool", kind, summary: "Ran command", payload, turnId: "turn-1", createdAt: "2026-09-04T10:00:03.000Z" },
    }, id === "a1" ? 11 : 12);

  const started = projection.applyThreadEvent(activity("a1", "tool.started", {
    itemType: "command_execution", status: "inProgress", detail: "npm test",
    data: { toolCallId: "call-1", command: "npm test" },
  }));
  const done = projection.applyThreadEvent(activity("a2", "tool.completed", {
    itemType: "command_execution", status: "completed", detail: "ok",
    data: { toolCallId: "call-1", output: "ok", exitCode: 0 },
  }));

  assert.equal(started[0].method, "item/started");
  assert.deepEqual(started[0].params.item, {
    id: "call-1", type: "commandExecution", status: "inProgress", command: "npm test", aggregatedOutput: "",
  });
  assert.equal(done[0].method, "item/completed");
  assert.equal(done[0].params.item.id, "call-1");
  assert.equal(done[0].params.item.aggregatedOutput, "ok");
  assert.equal(done[0].params.item.exitCode, 0);
  assert.equal(done[0].params.turnId, "turn-1");
});

test("file change activities and turn diffs become fileChange items", () => {
  const projection = createThreadEventProjection();
  projection.hydrate(THREAD, 10);
  const edit = projection.applyThreadEvent(threadEvent("thread.activity-appended", {
    threadId: "thread-1",
    activity: { id: "a3", tone: "tool", kind: "tool.completed", summary: "Edited", turnId: "turn-1", createdAt: "x",
      payload: { itemType: "file_change", status: "completed", data: { toolCallId: "call-2", path: "src/a.ts", unifiedDiff: "@@ -1 +1 @@\n-a\n+b" } } },
  }, 11));
  assert.equal(edit[0].params.item.type, "fileChange");
  assert.deepEqual(edit[0].params.item.changes, [{ path: "src/a.ts", kind: "update", diff: "@@ -1 +1 @@\n-a\n+b" }]);

  const diff = projection.applyThreadEvent(threadEvent("thread.turn-diff-completed", {
    threadId: "thread-1", turnId: "turn-1", checkpointTurnCount: 4, checkpointRef: "ref", status: "ready",
    files: [{ path: "src/a.ts", kind: "update", additions: 2, deletions: 1 }], assistantMessageId: null, completedAt: "x",
  }, 12));
  assert.equal(diff[0].method, "item/completed");
  assert.equal(diff[0].params.item.id, "turn-diff-turn-1");
  assert.deepEqual(diff[0].params.item.changes, [{ path: "src/a.ts", kind: "update", additions: 2, deletions: 1 }]);
  assert.equal(projection.checkpointTurnCount("thread-1", "turn-1"), 4);
  assert.equal(projection.checkpointTurnCount("thread-1", "nope"), null);
});

test("other tools become toolCall items and non-tool activities are ignored", () => {
  const projection = createThreadEventProjection();
  projection.hydrate(THREAD, 10);
  const mcp = projection.applyThreadEvent(threadEvent("thread.activity-appended", {
    threadId: "thread-1",
    activity: { id: "a4", tone: "tool", kind: "tool.completed", summary: "search", turnId: "turn-1", createdAt: "x",
      payload: { itemType: "web_search", status: "completed", title: "Web search", detail: "3 results", data: {} } },
  }, 11));
  assert.deepEqual(mcp[0].params.item, { id: "a4", type: "toolCall", status: "completed", name: "Web search", output: "3 results" });
  const info = projection.applyThreadEvent(threadEvent("thread.activity-appended", {
    threadId: "thread-1",
    activity: { id: "a5", tone: "info", kind: "context-window.updated", summary: "ctx", payload: {}, turnId: null, createdAt: "x" },
  }, 12));
  assert.deepEqual(info, []);
});

test("checkpoint history items and desktop git progress helpers", () => {
  const { checkpointFileChangeItem, desktopGitProgressNotification } = require("../src/electron-event-projection");
  assert.deepEqual(checkpointFileChangeItem({ turnId: "t", checkpointTurnCount: 2, files: [{ path: "a", kind: "add", additions: 1, deletions: 0 }] }), {
    id: "turn-diff-t", type: "fileChange", status: "completed", changes: [{ path: "a", kind: "add", additions: 1, deletions: 0 }],
  });
  assert.deepEqual(desktopGitProgressNotification({ actionId: "g1", cwd: "/w", action: "push", kind: "phase_started", phase: "push", label: "Pushing" }), {
    kind: "notification", method: "djl/git/desktopActionProgress",
    params: { actionId: "g1", cwd: "/w", action: "push", kind: "phase_started", phase: "push", label: "Pushing" },
  });
});
```

- [ ] **Step 2: Implement** in the projection: add `checkpointCountByThreadTurn` map; `case "thread.activity-appended"` calls `projectActivity` which handles approvals as before and, for `tone === "tool"`, builds the item via `toolItemFromActivity(activity)`; `case "thread.turn-diff-completed"` records the count and returns the fileChange item; export the two helpers. `kind` of a file change is `"update"` unless `data.kind` is present. Status maps `inProgress` to `"inProgress"`, else `"completed"`. `tool.started` emits `item/started`; `tool.updated` and `tool.completed` emit `item/completed`.

- [ ] **Step 3: Run** `node --test ./test/electron-event-projection.test.js` → 14 pass. **Commit** `feat(remote-gateway): project tool activity, turn diffs, and git progress`.

---

### Task 3: Adapter: checkpoint diff intercept, history items, git subscription

**Files:**
- Modify: `apps/remote-gateway/src/electron-app-server-adapter.js` (`rpc.onStarted`, `appServerTurns`, returned object gains `interceptRequest(rawMessage)`)
- Modify: `apps/remote-gateway/src/bridge.js` (`handleApplicationMessage`, before `handleWorkspaceRequest`)
- Test: `apps/remote-gateway/test/electron-app-server-adapter.test.js`

- [ ] **Step 1: Tests** (append): a thread with `checkpoints: [{ turnId: "turn-1", checkpointTurnCount: 3, files: [...] }]` yields a `fileChange` item in `appServerThreadWithHistory(...).turns[0].items`; after hydrating and pushing a `thread.turn-diff-completed` event (count 4), `transport.interceptRequest(JSON.stringify({ id: "d1", method: "workspace/checkpointDiff", params: { threadId: "electron-thread", fromTurnId: "turn-2", toTurnId: "turn-2", cwd: "/x" } }))` returns `true`, the backend receives `orchestration.getTurnDiff` with `{ threadId, fromTurnCount: 3, toTurnCount: 4 }` (use `turn-2` mapped to count 4 in the pushed event), and the outbound response has `result.diff`; an unknown turn returns `false` with no request; `rpc.onStarted` subscribes `git.subscribeActionProgress` and a pushed event is forwarded as `djl/git/desktopActionProgress`.

- [ ] **Step 2: Implement**: `appServerTurns` appends `checkpointFileChangeItem(checkpoint)` to the turn matching `checkpoint.turnId` (create the turn entry if missing). `interceptRequest` parses, matches `workspace/checkpointDiff` + a known count, calls `rpc.request(ORCHESTRATION.getTurnDiff, { threadId, fromTurnCount: Math.max(0, count - 1), toTurnCount: count })`, and emits the JSON-RPC response (or `{ error: { code: -32000, message, data: { errorCode: "checkpoint_missing" } } }`). Subscribe to `WS_METHODS` name `"git.subscribeActionProgress"` in `rpc.onStarted` (once) with `onChunk(values)` forwarding through `desktopGitProgressNotification`. In `bridge.js`, before `handleWorkspaceRequest(...)`, add `if (typeof codex.interceptRequest === "function" && codex.interceptRequest(rawMessage)) return;`.

- [ ] **Step 3: Run** the adapter tests and the full gateway suite → green. **Commit** `feat(remote-gateway): serve desktop turn diffs and forward git progress`.

---

### Task 4: Phone: desktop git progress toast

**Files:**
- Create: `apps/ios/DJL/Services/CodexService+DesktopGitProgress.swift`
- Modify: `apps/ios/DJL/Services/CodexService.swift` (stored `desktopGitActionProgressByCwd: [String: TurnGitActionProgress] = [:]`)
- Modify: `apps/ios/DJL/Services/CodexService+Incoming.swift` (`handleNotification` case `"djl/git/desktopActionProgress"`)
- Modify: `apps/ios/DJL/Views/Turn/Core/TurnView.swift` (toast `progress:` argument)
- Create: `apps/ios/DJLTests/CodexServiceDesktopGitProgressTests.swift` (register in `project.pbxproj` with ids `D3A1B2C4E5F60718293A4B07/08`)

- [ ] **Step 1: Test**: `handleNotification(method: "djl/git/desktopActionProgress", params:)` with `action_started` (`action: "commit_push"`, `phases: ["commit","push"]`) yields `desktopGitActionProgress(for: "/w")` with `plannedPhases == [.commit, .push]`; `phase_started` with `phase: "push"` marks commit completed and push current; `action_finished` removes it; a `hook_output` for an unknown action creates a spinner entry with no phases.

- [ ] **Step 2: Implement** `CodexService+DesktopGitProgress.swift`:

```swift
extension CodexService {
    func desktopGitActionProgress(for workingDirectory: String?) -> TurnGitActionProgress? {
        guard let workingDirectory else { return nil }
        return desktopGitActionProgressByCwd[workingDirectory]
    }

    func handleDesktopGitActionProgress(_ params: IncomingParamsObject?) {
        guard let params, let cwd = params["cwd"]?.stringValue, let kind = params["kind"]?.stringValue else { return }
        let action = TurnGitActionKind(desktopStackedAction: params["action"]?.stringValue ?? "")
        switch kind {
        case "action_started":
            let phases = (params["phases"]?.arrayValue ?? []).compactMap { $0.stringValue }.compactMap(TurnGitActionPhase.init(desktopPhase:))
            desktopGitActionProgressByCwd[cwd] = TurnGitActionProgress(action: action, plannedPhases: phases)
        case "phase_started":
            var progress = desktopGitActionProgressByCwd[cwd] ?? TurnGitActionProgress(action: action, plannedPhases: [])
            if let phase = params["phase"]?.stringValue.flatMap(TurnGitActionPhase.init(desktopPhase:)) {
                if let current = progress.currentPhase { progress.completedPhases.insert(current) }
                progress.currentPhase = phase
            }
            desktopGitActionProgressByCwd[cwd] = progress
        case "action_finished", "action_failed":
            desktopGitActionProgressByCwd.removeValue(forKey: cwd)
        default:
            if desktopGitActionProgressByCwd[cwd] == nil {
                desktopGitActionProgressByCwd[cwd] = TurnGitActionProgress(action: action, plannedPhases: [])
            }
        }
    }
}

extension TurnGitActionPhase {
    init?(desktopPhase: String) {
        switch desktopPhase {
        case "branch": self = .branch
        case "commit": self = .commit
        case "push": self = .push
        case "pr": self = .createPR
        default: return nil
        }
    }
}

extension TurnGitActionKind {
    init(desktopStackedAction: String) {
        switch desktopStackedAction {
        case "push": self = .push
        case "create_pr": self = .createPR
        case "commit_push": self = .commitAndPush
        case "commit_push_pr": self = .commitPushCreatePR
        default: self = .commit
        }
    }
}
```

In `TurnView`, the overlay's `progress:` becomes `viewModel.gitActionProgress ?? codex.desktopGitActionProgress(for: codex.gitWorkingDirectory(for: thread.id))`.

- [ ] **Step 3: Run** the new test class, then the full iOS suite → green. **Commit** `feat(ios): show desktop git action progress in the turn toast`.

---

### Task 5: Verification

Run the gateway suite, relay suite, contracts build, server typecheck, and the iOS suite. Append a `## Verified` section to the spec with the results and commit `docs: record live diffs and git verification`.
