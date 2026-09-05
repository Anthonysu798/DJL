# Remote streaming latency design

Sub-project 1 of 5 for DJL Remote. Goal: a turn running on the DJL desktop, or
started from the phone, streams to the paired iPhone with the same feel as the
desktop UI. Later sub-projects cover presence, live diffs and git, terminal
mirroring, and the iOS audit.

## Problem

Production desktop builds spawn the remote gateway with
`DJL_ELECTRON_BACKEND_ENDPOINT`, so the phone path is:

```
iPhone <-E2EE-> Cloudflare relay <-E2EE-> gateway child <-Effect RPC ws-> DJL backend
```

Three defects make streaming slow:

1. **Per-event full snapshot.** `electron-app-server-adapter.js` subscribes to
   `orchestration.subscribeThread`, ignores the event payloads, and on every
   `kind: "event"` chunk calls `orchestration.getSnapshot`, which returns every
   project and thread with all messages. It then diffs the whole assistant text
   to reconstruct a delta. A fast model triggers dozens of full serializations a
   second on the laptop.
2. **Phone-started turns are buffered.** The desktop UI starts turns with
   `assistantDeliveryMode: "streaming"`, so every token is a domain event. The
   adapter omits the flag, the backend defaults to `"buffered"`, and text is
   released only at tool boundaries or after 24k characters.
3. **One relay frame per notification, no rate handling.** The relay caps each
   socket at 200 frames per 10 s (`policy.ts`). Sustained streaming above 20
   frames/s closes the Mac socket with 4008. Neither side treats 4008 specially,
   so the phone loses the rest of the turn until a 1 to 5 s reconnect.

The phone side already coalesces deltas and repaints every 80 ms; it is not the
bottleneck.

## Design

### 1. Event-driven adapter (`apps/remote-gateway/src/electron-app-server-adapter.js`)

The adapter consumes thread stream events directly. `getSnapshot` is used only
for hydration at connect, after a subscription error, and after the server
reports dropped events.

The backend encodes assistant streaming as `thread.message-sent` events: a
delta is `role: "assistant", streaming: true, text: <chunk>`; completion is the
same event with `streaming: false` and `text` equal to the full message.

| Backend event | Phone notification |
| --- | --- |
| `thread.message-sent`, user role | `codex/event/user_message` |
| `thread.message-sent`, assistant, `streaming: true` | `item/agentMessage/delta` (`threadId`, `turnId`, `itemId`, `delta`, `djlEmittedAt`) |
| `thread.message-sent`, assistant, `streaming: false` | `item/completed` with the assistant item |
| `thread.session-set` with a new `activeTurnId` | `turn/started` |
| `thread.session-set` clearing `activeTurnId` | `turn/completed` with status from the latest turn |
| `thread.activity-appended` with `approval.requested` | approval server request (unchanged shape) |
| `thread-upserted` shell event with a changed `runtimeMode` | `djl/thread/runtimeMode/updated` |
| `thread.meta-updated` name change | `thread/name/updated` |

`thread.runtime-mode-set` is not forwarded on the per-thread stream, so runtime
mode changes are read from the shell stream's `thread-upserted` items instead.

Rules:

- A per-thread `lastAppliedSequence` guard drops any event whose `sequence` is
  at or below the sequence of the snapshot that hydrated the thread.
- Assistant text is tracked per message id by appending delta chunks. The
  completion event's full `text` replaces the tracked text so the
  `item/completed` payload is exact even if a chunk was missed.
- `turn/start` from the phone dispatches `thread.turn.start` with
  `assistantDeliveryMode: "streaming"`.
- `subscribeShell` chunks no longer trigger a full refresh. `thread-upserted`
  for an unknown thread subscribes that thread; `thread-removed` unsubscribes.
- The existing `reconcileStartedTurn` fallback stays, but only arms when no
  event for the started turn arrives within 250 ms.
- Events carry `occurredAt`; the adapter forwards it as `djlEmittedAt` on delta
  notifications for latency measurement.

### 2. Outbound frame coalescing (`apps/remote-gateway/src/secure-transport.js`)

`queueOutboundApplicationMessage` gains a coalescing window.

- Notifications (`method` present, no `id`) are appended to a pending list.
  A 40 ms timer, started by the first append, flushes the list as one JSON-RPC
  batch array in one encrypted frame with one `bridgeOutboundSeq`.
- Consecutive `item/agentMessage/delta` notifications for the same
  `threadId` + `itemId` inside a window are merged into one delta.
- Responses (`id` present) and server requests (`id` + `method`) flush the
  pending list and are sent immediately after it, preserving order.
- A single pending notification flushes as a plain object, not a one-element
  array, so older phones keep working.
- The replay buffer stores the batch text as one entry, so reconnect replay and
  the `lastAppliedBridgeOutboundSeq` cursor are unchanged.
- Upper bound: 25 frames/s per direction, under the raised relay budget.

### 3. Relay budget and 4008 handling

- `DEFAULT_MESSAGES_PER_WINDOW` in `apps/remote-relay/src/policy.ts` rises from
  200 to 600 per 10 s window. Frame size cap and everything else stay.
- Gateway `scheduleRelayReconnect(4008)` reconnects immediately with no backoff
  and logs a rate-limit warning.
- Phone: close 4008 joins the transient set. It reconnects on the existing
  path and does not clear the saved session.

### 4. Phone batch parsing (`apps/ios/DJL/Services/CodexService+Incoming.swift`)

`processIncomingText` and the off-actor pre-decoder accept a JSON array. Each
element is decoded as `RPCMessage` and dispatched in order on the main actor.
A malformed element is skipped and reported through `lastErrorMessage`; the rest
of the batch still applies. No other phone behavior changes.

### 5. Measurement

Debug builds log `now - djlEmittedAt` for each delta batch under an
`[djl-latency]` prefix. The acceptance check is a desktop-started and a
phone-started turn on the simulator against a desktop build, comparing first
token and steady-state delay before and after.

## Error handling

- Backend restart: the RPC client reconnects, the adapter resubscribes every
  known thread and re-hydrates from one snapshot, then resumes events.
- Dropped events: the server's `onDroppedEvents` ends the thread stream with an
  error; the adapter re-hydrates that thread from a snapshot and resubscribes.
- Batch decode failure on the phone: per-element fallback, never a silent drop.
- Relay 4008: immediate reconnect; the outbound replay buffer redelivers any
  frames the phone did not acknowledge.

## Testing

- Adapter tests: recorded event sequences assert emitted notifications and that
  `getSnapshot` is called exactly once during a streaming turn; phone `turn/start`
  sends `assistantDeliveryMode: "streaming"`; stale-sequence events are ignored.
- Coalescer tests: merge of same-item deltas, ordering across a response flush,
  single-notification plain-object shape, replay entry count.
- Relay policy test updated for 600.
- iOS test: `processIncomingText` with a batch array dispatches every element
  in order and tolerates one bad element.
- Manual end-to-end timing on the simulator.

## Out of scope

Presence and heartbeat, live diff and git push, terminal mirroring, and the iOS
profiling pass are separate sub-projects.
