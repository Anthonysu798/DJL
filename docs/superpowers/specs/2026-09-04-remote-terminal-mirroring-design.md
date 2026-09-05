# Remote desktop terminal mirroring

Sub-project 4 of the DJL iOS remote-access work. Depends on sub-projects 1–3
(streaming latency, presence, live diffs and git progress).

## Goal

From the phone, open the terminals that DJL desktop runs for a thread, watch
their output live, and type into them, over the same relay path the chat uses.
The phone never spawns or kills a desktop shell on its own initiative: opening a
terminal attaches to the desktop's PTY session (creating it only if none
exists, exactly as the desktop renderer does), and closing the phone view only
detaches.

## What exists today

- Desktop terminals are per `(threadId, terminalId)` PTY sessions owned by the
  Electron backend's `TerminalManager`. `terminal.open` attaches to a running
  session and returns a `TerminalSessionSnapshot` (`history`, optional
  `replayPreamble`, `status`, `cwd`, `pid`, exit info). Reattaching a running
  session does not emit a `started` event; it only resizes the PTY when
  `cols`/`rows` differ and resets ACK accounting.
- `terminal.subscribeEvents` streams every terminal event for every thread:
  `started`, `restarted`, `output` (`data`, `byteLength`), `exited`, `error`,
  `cleared`, `activity`.
- Output backpressure: the renderer acknowledges consumed bytes with
  `terminal.ackOutput`; the PTY pauses above a high-water mark and a watchdog
  force-resumes if ACKs stop. ACKs clamp at zero, so an extra consumer cannot
  corrupt the counter.
- The phone's terminal screen is SSH-only (`DJLNativeSSHTerminal`) and renders
  through Ghostty from a `DJLTerminalSnapshot` (`bufferData` grows by appending;
  a new `instanceId` resets the surface). The snapshot still carries a legacy
  `applyTerminalEvent` decoder from the old bridge-fed terminal.
- The gateway adapter (`electron-app-server-adapter.js`) already subscribes to
  backend streams on start (shell threads, git progress) and answers
  phone JSON-RPC requests in `dispatchAppServerRequest`.

## Design

### Gateway: desktop terminal mirror

New module `apps/remote-gateway/src/desktop-terminal-mirror.js` exporting
`createDesktopTerminalMirror({ request, emit, resolveCwd })`.

State:

- `watched: Map<"threadId::terminalId", { threadId, terminalId, cwd, unackedBytes, lagging }>`
- `known: Map<threadId, Set<terminalId>>` — every terminal id seen in any
  event, so the phone can list terminals the desktop has running.

Phone methods (dispatched by the adapter, all JSON-RPC requests):

| Method | Params | Backend call | Result |
| --- | --- | --- | --- |
| `djl/terminal/list` | `{threadId}` | none | `{terminals: [ids]}` (`known` ∪ `"default"`) |
| `djl/terminal/open` | `{threadId, terminalId, cwd?, cols?, rows?}` | `terminal.open` | `{snapshot}` verbatim; adds to `watched` |
| `djl/terminal/write` | `{threadId, terminalId, data}` | `terminal.write` | `{}` |
| `djl/terminal/resize` | `{threadId, terminalId, cols, rows}` | `terminal.resize` | `{}` |
| `djl/terminal/ack` | `{threadId, terminalId, bytes}` | `terminal.ackOutput` | `{}` |
| `djl/terminal/close` | `{threadId, terminalId}` | none | `{}`; removes from `watched` only |

`cwd` falls back to the thread's worktree path from the last orchestration
snapshot when the phone omits it (`terminal.open` requires a valid directory).

Events: the adapter subscribes to `terminal.subscribeEvents` in `onStarted`
(same pattern as git progress) and feeds every event to `mirror.handleEvent`.
For a watched terminal the event is forwarded as notification
`djl/terminal/event` with the event object as params. Unwatched terminals only
update `known`.

Flow control toward the phone: each forwarded `output` adds `byteLength` to
`unackedBytes`; `djl/terminal/ack` subtracts. Above 1 MiB unacked the mirror
stops forwarding output (`lagging = true`). When an ACK brings the count to or
below 256 KiB, the mirror re-attaches (`terminal.open` with the stored cwd),
emits a synthetic `started` event carrying the fresh snapshot, and resets the
count. The phone replaces its buffer from that snapshot, so a slow link never
produces holes, only a resync.

Shutdown unsubscribes from terminal events and clears `watched`.

### Bridge

No change: unknown `djl/terminal/*` requests already fall through to the
adapter, and the coalescer/replay buffer carry the notifications.

### Phone

- `DJLTerminalSource` (`ssh` | `desktop`) is a new field on
  `DJLTerminalProfile`, defaulting to `ssh` when absent in saved profiles.
- `Services/Terminal/CodexService+DesktopTerminal.swift`:
  - `desktopTerminalBindings: [phoneTerminalId: DesktopTerminalBinding]` where
    the binding holds `threadId` and the desktop `terminalId`. Phone id
    `term-1` maps to desktop id `default`; every other id is used verbatim.
  - `openDesktopTerminal(terminalId:threadId:cwd:cols:rows:)` sends
    `djl/terminal/open`, seeds the snapshot from `replayPreamble + history`
    with a new `instanceId`, status from the snapshot, `resizeSupported: true`.
  - `handleDesktopTerminalEvent(_:)` for `djl/terminal/event`: `output` →
    `appendOutput` and queue an ACK; `started`/`restarted` → replace buffer,
    new `instanceId`; `exited` → `.exited`; `error` → `.error` with message;
    `cleared` → empty buffer; `activity` ignored.
  - ACKs batch: flush when ≥ 64 KiB pending or 150 ms after the first
    unflushed byte.
  - `write`/`resize`/`close` route by binding: `close` sends
    `djl/terminal/close` and marks the snapshot `.closed`.
  - Existing `openTerminal(terminalId:profile:cols:rows:)` branches on
    `profile.source`; the SSH path is unchanged.
- Presence: when the host goes offline or the socket drops, bound desktop
  terminals show `.error` "Device offline". When the secure session is ready
  again, every binding that was running is re-opened (attach) so the buffer
  resyncs from the desktop's history.
- Navigation: `ContentNavigationRoute.terminal` gains `threadID: String?`; the
  thread view passes its id, other entry points pass nil and the screen falls
  back to `codex.activeThreadId`.
- `TerminalScreen`: options menu gets a "Source" section with "DJL desktop"
  and "SSH" (checkmark on the active one, persisted in the profile). Desktop
  source is offered only when a thread id is available; it is the default when
  the host is online and no SSH profile has been saved yet. In desktop mode the
  connection editor is skipped, the chrome title shows the desktop name from
  the trusted pair, "Disconnect" reads "Detach", and the session picker lists
  ids from `djl/terminal/list`.

### Resize trade-off

The phone sends `terminal.resize` when it attaches and when its grid changes,
exactly as a second desktop window would. The desktop renderer refits on its
next layout change. This keeps full-screen programs usable from the phone; the
cost is that the desktop view may show narrow-wrapped output until it refits.

## Error handling

- `terminal.open` failure (bad cwd, backend down) → RPC error → snapshot
  `.error` with the message; the screen shows its existing error banner.
- Events for unknown bindings are ignored.
- Host offline → `.error` "Device offline"; automatic re-attach on recovery.
- Lag → resync from snapshot (never partial output).

## Testing

- Gateway `desktop-terminal-mirror.test.js`: open watches and returns the
  snapshot; output forwarded only for watched terminals; `known` listing;
  lag limit drops output and ACK triggers resync with a synthetic `started`;
  close detaches without a backend call.
- Gateway adapter test: `djl/terminal/open` without cwd uses the thread's
  worktree path; the adapter subscribes to `terminal.subscribeEvents` on start
  and forwards `djl/terminal/event`.
- iOS `CodexServiceDesktopTerminalTests`: output appends and the ack batch
  accumulates; `started` replaces the buffer with a new instance id; `exited`
  and `error` map to statuses; phone/desktop id mapping; profile decoding
  defaults `source` to `ssh`.

## Out of scope

- Spawning extra desktop terminals from the phone beyond what `terminal.open`
  creates for a thread.
- Mirroring the phone's SSH sessions to the desktop.
- Desktop-side awareness of phone resizes.
