# Remote presence design

Sub-project 2 of 5 for DJL Remote. Goal: the iPhone shows truthfully, within
seconds, whether the paired laptop is reachable, and recovers on its own when it
comes back. No push notifications; the badge is the signal.

## Problem

Today the phone only learns the laptop is gone when it sends a frame and the
relay closes the socket with 4004, or when its own socket fails. Its keepalive
is a WebSocket ping to Cloudflare, which answers whether or not the laptop is
present. A sleeping laptop therefore shows "Connected" until the user acts.
Separately, the relay's trusted-session resolve returns 404 `mac_offline` when
the host is away, but the phone only recognises `session_unavailable`, so it
reports "unsupported relay" and moves on.

## Design

### 1. Relay presence frames (`apps/remote-relay/src/index.ts`)

- A pure helper `buildHostPresenceFrame(online, at)` returns
  `{ kind: "hostPresence", online, at }`.
- When a `mac` socket is accepted, the session Durable Object sends the frame
  with `online: true` to every `iphone` socket.
- When a `mac` socket closes, it sends `online: false` to every `iphone`
  socket, then marks the registry offline as today.
- A phone connecting while no `mac` socket exists is accepted (the 409
  `host_offline` refusal is removed) and immediately receives
  `online: false`. Application frames from a phone with no host still close the
  phone with 4004; the phone does not send while the host is offline.
- Presence frames are plaintext control frames. The relay already observes
  connection timestamps, so nothing new is exposed.

### 2. Gateway heartbeat (`apps/remote-gateway/src/bridge.js`, `secure-transport.js`)

- While the secure session is resumed, the bridge queues
  `{ "method": "djl/presence/heartbeat", "params": { "at": <ms> } }` every
  5 seconds through `sendApplicationResponse`, so it uses the coalescer and the
  replay buffer like any notification.
- The timer starts on `onSecureSessionReady` and stops in
  `prepareBridgeShutdown`. It is `unref`ed so it never keeps the process alive.
- A pure helper `createPresenceHeartbeat({ intervalMs, setIntervalFn, clearIntervalFn, send })`
  owns the timer so it can be unit tested.

### 3. Phone presence state (`apps/ios/DJL/Services/CodexService+Presence.swift`, new)

```swift
enum CodexHostPresence: Equatable, Sendable {
    case unknown
    case online
    case offline(since: Date)
}
```

`CodexService` gains `hostPresence: CodexHostPresence` and
`lastHostActivityAt: Date?`. Inputs:

| Input | Effect |
| --- | --- |
| Relay `hostPresence` frame, `online: true` | `hostPresence = .online`; if it was `.offline`, run the existing trusted reconnect |
| Relay `hostPresence` frame, `online: false` | `hostPresence = .offline(since: now)` |
| Any decrypted application frame | `lastHostActivityAt = now`; `hostPresence = .online` |
| `djl/presence/heartbeat` notification | same as above; the notification is consumed, never routed to handlers |
| Silence timer: 15 s since `lastHostActivityAt` while connected | `hostPresence = .offline(since: lastHostActivityAt)` |
| Disconnect or teardown | timer stops; `hostPresence = .unknown` |

The silence timer runs only while `isConnected` and `secureSession != nil`.
`WireMessagePreDecoder` treats `"hostPresence"` as a control kind so the frame
reaches `processIncomingWireText` on the main actor.

`mac_offline` from the resolve endpoint maps to
`CodexTrustedSessionResolveError.macOffline`, the same as `session_unavailable`.

### 4. Phone badge and copy

`CodexConnectionPhase` gains `.hostOffline`. `connectionPhase` returns it when
`isConnected` and `hostPresence` is `.offline`. Copy:

| Surface | Text |
| --- | --- |
| Sidebar badge | "Device offline", grey dot |
| Home empty state | "Device offline" title, "Your paired device is asleep or has no internet. DJL reconnects when it returns." |
| Settings connection card | "Device offline · since 2:41 PM" using the phone's short time style |

"Offline" without the "Device" prefix keeps meaning the phone has no relay
connection.

### 5. Restart fallback

Sleep and wake keep the relay session, so the waiting socket sees the laptop
return. A gateway restart creates a new session the waiting socket cannot see.
While the app is foregrounded and `hostPresence` is `.offline`, the phone runs
the trusted-session resolve every 30 seconds; success triggers the normal
reconnect path. The loop stops when presence returns or the app backgrounds.

## Error handling

- Malformed presence frame: ignored.
- Silence timeout followed by a frame: state returns to `.online` with no
  reconnect.
- Presence `online: true` while the phone is mid-reconnect: ignored, the
  reconnect in flight covers it.
- Relay budget: heartbeat adds at most 0.2 frames per second per direction.

## Testing

- Relay (Vitest): `buildHostPresenceFrame` shape; a Durable Object test that a
  phone connecting without a host is accepted and receives `online: false`,
  and that a host close sends `online: false` to the phone.
- Gateway: `createPresenceHeartbeat` sends on each tick and stops on stop.
- Phone (XCTest): presence frame sets online and offline; silence timeout flips
  to offline and a frame flips back; heartbeat notification is not routed;
  `mac_offline` maps to `.macOffline`; `connectionPhase` reports `.hostOffline`.
- Manual: sleep the laptop with the simulator connected, badge flips within
  15 s; wake, badge recovers without a tap.

## Out of scope

Push notifications on return, live diff and git push, terminal mirroring, iOS
profiling.
