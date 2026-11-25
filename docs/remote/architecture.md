# DJL Remote Architecture

## Product contract

DJL Remote gives the paired iPhone the same Codex-control surface provided by the imported Remodex application: task listing and history, prompts and queueing, approvals, images and voice, project and workspace browsing, terminal actions, diffs, checkpoints, Git operations, runtime settings, and generic completion notifications.

The intended setup is install, scan, approve, and work:

1. A production DJL desktop release starts the local remote gateway automatically.
2. **Settings → Remote** shows a five-minute QR code and a ten-character fallback code.
3. The iPhone scans the QR and approves access with the device-owner authentication policy.
4. Both devices remember each other's long-term public identity. Later sessions reconnect without another scan until the user revokes the pairing.

Only one phone identity is trusted by a computer at a time. Pairing another phone replaces the previous phone.

## Components

```mermaid
flowchart LR
    P["DJL iPhone app"]
    A["Apple Push Notification service"]
    R["Cloudflare Worker + Durable Objects"]
    G["DJL remote gateway child process"]
    C["Codex app-server"]
    F["Local repositories and Codex history"]
    D["DJL desktop UI"]

    P <-->|"opaque E2EE WebSocket frames"| R
    R -->|"generic completion push"| A
    A -->|"content-free notification"| P
    R <-->|"opaque E2EE WebSocket frames"| G
    G <-->|"JSON-RPC over stdio"| C
    C <--> F
    D -->|"sanitized status, QR, revoke, update"| G
```

- `apps/ios`: SwiftUI iPhone application, QR scanner, Keychain identity, encrypted transport, task UI, app lock, and APNs registration.
- `apps/desktop`: Electron lifecycle owner. It starts and supervises an isolated Node-mode gateway child and exposes only sanitized pairing/status data to the renderer.
- `apps/remote-gateway`: local Codex bridge. It owns the computer identity, launches `codex app-server`, enforces the trusted-phone policy, encrypts traffic, and exposes the imported remote capability surface.
- `apps/remote-relay`: Cloudflare Worker and two Durable Objects. It forwards opaque WebSocket frames, resolves signed trusted reconnects, and sends generic APNs notifications.
- `packages/remote-protocol`: versioned schemas, canonical signed transcripts, session-resolution messages, nonce construction, and protocol constants shared by TypeScript services.

Compatibility identifiers such as the `@djl/*` package scope remain internal. DJL is the only product name.

## Pairing and key agreement

The QR contains the relay URL, a random session identifier, the computer device identifier and Ed25519 public identity, the expiry, protocol version, display name, and a 32-byte pairing secret. It does not contain the computer private key, relay host secret, notification secret, or an application traffic key.

The pairing secret never reaches the relay. A typed pairing code is stretched with PBKDF2-HMAC-SHA256 into a lookup code, which the relay stores, and the same pairing secret, which it does not. During first pairing the computer sends an HMAC of the handshake transcript under that secret in ServerHello and the phone sends its own in ClientAuth; each side rejects the other without it. The relay sees every other handshake field, so this proof is what stops it from pairing a device of its own or substituting its own computer key. Trusted reconnects do not use the secret: they rely on the pinned identities.

```mermaid
sequenceDiagram
    participant M as DJL computer
    participant R as Blind relay
    participant P as DJL iPhone

    M->>R: Register session using host + notification secrets
    M-->>P: Display short-lived QR payload
    P->>P: Scan, validate expiry, authenticate device owner
    P->>R: Connect as phone using random session ID
    P->>M: ClientHello (phone identity, ephemeral X25519 key, nonce)
    M->>P: ServerHello (computer identity, ephemeral X25519 key, signature)
    P->>M: ClientAuth signature
    M->>P: Encrypted ready frame
    Note over M,P: HKDF-SHA256 derives directional AES-256-GCM keys
    M->>M: Persist one trusted phone identity
    P->>P: Persist trusted computer identity in Keychain
```

The handshake uses persistent Ed25519 identities and ephemeral X25519 keys. A canonical, length-prefixed, domain-separated transcript binds the protocol version, mode, session, key epoch, both device IDs, both identity keys, both ephemeral keys, nonces, and expiry. Direction-specific AES-256-GCM keys are derived with HKDF-SHA256. Nonces encode the sender direction and a monotonic counter; replayed or out-of-order counters are rejected.

The iPhone stores its private identity and trusted-computer registry with `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`. The computer stores gateway state in a user-only file and mirrors supported secret material in the operating-system credential store. Neither private identity is sent to the relay.

## Trusted reconnect

When the QR session expires or DJL restarts, the computer registers a fresh random relay session. The iPhone asks the registry to resolve that session using a signed request containing its identity, the trusted computer identity, a timestamp, and a random nonce. The relay verifies the Ed25519 signature, rejects timestamps outside the 90-second window, and rejects reused nonces. The two endpoints then perform a fresh ephemeral handshake in `trusted_reconnect` mode.

The registry response never grants trust by itself. The gateway still verifies the phone identity against its single local trust record and the phone verifies the computer identity against its Keychain record. An identity mismatch requires re-pairing.

## Relay connection authentication

The relay also checks who is on each socket, separately from the end-to-end handshake. Both signatures below are Ed25519 over a length-prefixed, domain-separated transcript of the relay session ID, the device ID, and the identity key. They carry no timestamp because the session ID is random for each launch.

- The computer signs its registration on every connect. The registry pins the first signed identity key for a computer device ID and afterwards refuses a registration for that ID that is unsigned or uses another key, so another session cannot overwrite the entry. Only the computer that owns a pairing-code row can replace or delete it. Computers that have not updated register unsigned and stay unpinned until they do.
- The phone signs every connect. A phone that proves it is the registration's trusted phone replaces every other phone socket. Any other phone socket (a phone that is pairing, an older app that sends no identity, or anyone holding the session ID) cannot disconnect the trusted phone and, while it is connected, receives only `serverHello`, `secureReady`, `secureError`, and host presence. Encrypted envelopes go to the trusted socket alone. When the computer registers a newly paired phone, that phone's socket takes over and the previous trusted socket is closed.
- The computer's `relayMacRegistration` updates are consumed by the relay and never forwarded. They may only restate the identity registered at connect time.
- The gateway keeps its live encrypted session while a new handshake is still unauthenticated. Only a handshake that passes `ClientAuth` replaces it.

## Relay privacy boundary

The relay can observe:

- relay session and device identifiers, public identity keys, computer display name, and pairing expiry;
- online/offline timestamps, IP/network metadata available to Cloudflare, encrypted frame sizes, timing, and rate-limit events;
- APNs device token, push environment, thread/turn routing identifiers, and completion/failure state.

The relay cannot decrypt prompts, responses, transcript history, approvals, file contents, image or voice data, terminal data, Git data, or application traffic keys. It does not queue transcript frames. APNs payloads contain only “DJL task finished,” an instruction to open DJL, routing IDs, and result state.

## Staying reachable

The phone can only reach a computer that is awake, so the desktop app (not the gateway) decides
when to hold off idle sleep. The decision is `shouldStayAwake` in
`apps/desktop/src/remoteReachability.ts`; the block itself is Electron's `powerSaveBlocker`
(`prevent-app-suspension`), which works on macOS and Windows. The gateway's own macOS-only
`caffeinate` assertion stays switched off in the desktop app (`DJL_KEEP_MAC_AWAKE=0`).

- **Settings → Remote → Stay reachable** offers three choices: never, while plugged in (default),
  always. They are saved in `remote-reachability.json` in the app's user-data folder.
- The computer is kept awake while Remote is on and a phone is **paired**, not only while one is
  connected: a phone that connects later needs the computer awake first. The gateway reports
  `phonePaired` with each status message for this.
- A phone that is connected right now keeps the computer awake on battery too, unless the choice
  is never.
- **Start DJL when I sign in** registers a login item (installed app on macOS and Windows only).
  A launch made by the system at login keeps the window hidden until the user opens DJL.
- After the computer wakes, the gateway reconnects to the relay within a few seconds
  (`relay-reconnect-policy.js`), and the desktop takes its idle-sleep block again.
- The phone shows since when the computer has been asleep or offline. Drafts written meanwhile
  stay in the phone's queue and are sent when the computer returns. The relay still stores nothing.

Limits no app can remove: a laptop sleeps when its lid is closed (on macOS, unless it is on power
with an external display), and a sleeping computer cannot be woken from the phone.

## Lifecycle, failure, and revocation

- Electron starts the gateway after app readiness, restarts an unexpected exit with bounded backoff, and terminates it during desktop shutdown.
- A newer computer socket replaces the older one. A newer phone socket replaces older phone sockets, except that only the trusted phone can replace the trusted phone (see Relay connection authentication).
- Frames are capped at 1 MiB and each connection has a bounded message rate. Oversized, malformed, stale, or replayed input is rejected.
- The iPhone shows a reconnecting state during transient network loss. Identity mismatch, revocation, or unsupported protocol versions become explicit re-pair/update states.
- **Reset trusted phone** removes the computer's local trust and rotates the pairing session. The relay administrator endpoint can revoke a session, immediately closing both sockets.
- Disabling Remote in desktop settings stops the child process and removes the active access path without deleting local task data.

## Current ownership boundary

The remote gateway launches its own Codex app-server and shares the user's Codex history on disk; it does not reuse DJL desktop's in-memory provider session. This matches the Remodex capability model and lets the phone list, resume, and control the same persisted Codex tasks. Until a future single-owner broker unifies both runtimes, avoid actively driving the same task from desktop and iPhone at the same instant. A reconnect reconciles through persisted Codex history, but simultaneous input can still produce conflicting turns.

## Release invariants

- Production desktop artifacts must embed a credential-free `wss://` relay URL ending in `/relay`.
- Staging and production use different Worker names, Durable Object storage, APNs credentials, and administrator tokens.
- QR payloads expire after five minutes and are never logged as full JSON.
- Notification text stays generic; adding prompt or response previews requires a new security review.
- Changing transcript fields, nonce rules, or cryptographic algorithms requires a protocol-version bump and cross-platform vectors.
