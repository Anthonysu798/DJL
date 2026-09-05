# Remote live diffs, tool activity, and git progress design

Sub-project 3 of 5 for DJL Remote. Goal: a desktop-backed thread on the phone
shows the same command runs, file edits, and diffs the desktop shows, as they
happen, and git actions started on the desktop show their progress on the
phone.

## Problem

The Electron adapter forwards only user and assistant messages and approval
prompts. Tool activity from a desktop turn (commands, edits, MCP calls) is
dropped, and turn diffs never reach the phone unless the phone started the
turn and captured its own git checkpoints. Git actions started on the desktop
report progress only to the desktop window; the backend declares
`git.subscribeActionProgress` but has no handler.

## Design

### 1. Backend: broadcast git action progress

- Contracts (`packages/contracts/src/rpc.ts`): add
  `WsSubscribeGitActionProgressRpc = Rpc.make("git.subscribeActionProgress", { payload: Struct({}), success: GitActionProgressEvent, error: WsRpcError, stream: true })`
  and register it in `WsRpcGroup`.
- Server (`apps/server/src/wsRpc.ts`): the layer owns a
  `PubSub<GitActionProgressEvent>`. `gitRunStackedAction`'s progress reporter
  publishes to the caller queue as today and also to the PubSub. The new
  handler streams from the PubSub through `bufferLiveUiStream`.

### 2. Gateway: project activity, diffs, and git progress

Extend the pure projection (`electron-event-projection.js`):

| Backend event | Phone notification |
| --- | --- |
| `thread.activity-appended`, tone `tool`, kind `tool.started` | `item/started` with a tool item |
| same, kind `tool.updated` or `tool.completed` | `item/completed` with the tool item |
| `thread.turn-diff-completed` | `item/completed` with a `fileChange` item listing every file with totals |

Tool item shapes, keyed by `activity.payload.itemType`:

- `command_execution`: `{ id, type: "commandExecution", status, command: data.command ?? detail, aggregatedOutput: data.output ?? "" , exitCode?: data.exitCode }`
- `file_change`: `{ id, type: "fileChange", status, changes: [...] }` from `data.changes` when present, else from `data.unifiedDiff`/`data.patch`/`data.diff` as one change with `path: data.path ?? "workspace"`.
- anything else: `{ id, type: "toolCall", name: title ?? itemType, status, output: detail ?? "" }`.

The item id is `data.toolCallId ?? data.callID ?? activity.id`, so `started`
and `completed` land on the same phone row. `status` maps `inProgress`
to `"inProgress"` and everything else to `"completed"`.

Turn diffs: the projection remembers `turnId -> checkpointTurnCount`. The
adapter intercepts `workspace/checkpointDiff` for a turn it knows and answers
with `orchestration.getTurnDiff({ threadId, fromTurnCount: count - 1, toTurnCount: count })`
as `{ repoRoot: <thread cwd>, fromCheckpointRef: "turnStart:<turnId>", toCheckpointRef: "turnEnd:<turnId>", diff }`.
Unknown turns fall through to the local git handler as today. Hydration also
adds one `fileChange` item per checkpoint in `thread.checkpoints` to turn
history so reopened threads show their edits.

Git progress: on start, the adapter subscribes to `git.subscribeActionProgress`
and forwards each event as `djl/git/desktopActionProgress` with the event's
fields verbatim (`actionId`, `cwd`, `action`, `kind`, plus the per-kind
fields).

### 3. Phone: desktop git progress toast

`CodexService` keeps `desktopGitActionProgressByCwd: [String: TurnGitActionProgress]`.
`djl/git/desktopActionProgress` updates it: `action_started` creates the entry
with planned phases; `phase_started` sets the current phase and marks earlier
phases completed; `action_finished` and `action_failed` remove it. Phases map
`branch`, `commit`, `push`, `pr` to `TurnGitActionPhase` (`pr` is `createPR`);
actions map `commit`, `push`, `create_pr`, `commit_push`, `commit_push_pr` to
`TurnGitActionKind`. `TurnView` shows the desktop progress in the existing
toast overlay when no phone-run action is active and the thread's git working
directory matches the event `cwd`. Tool and file-change items need no phone
change; they render in existing cards.

## Error handling

- Malformed activity payloads (no item type) are ignored.
- `getTurnDiff` failures return the same `checkpoint_missing` error shape the
  local handler uses, so the phone's optional preview simply stays empty.
- A git progress event for an unknown `actionId` is treated as `action_started`
  with no phases so a phone that connected mid-action still shows a spinner.

## Testing

- Contracts and server: existing suites compile with the new RPC; a Vitest
  case in `wsRpc` is not practical, so the handler is exercised through the
  adapter subscription in manual testing.
- Gateway projection tests: command activity to started/completed items;
  file-change activity; turn-diff to fileChange with totals; git progress
  forwarding; checkpoint diff intercept answers from `getTurnDiff` and falls
  through when unknown.
- Phone: presence of `desktopGitActionProgress(for:)` after start, phase
  progression, removal on finish.

## Out of scope

Terminal mirroring and the iOS profiling pass.
