# DJL remote relay

This Cloudflare Worker connects one DJL desktop host to one paired iPhone through
hibernating Durable Object WebSockets. The relay forwards opaque end-to-end
encrypted frames and never queues transcript content.

## Security boundaries

- A session accepts one host; a newer host connection replaces the old one.
- The host authenticates with high-entropy session and notification secrets. Only
  SHA-256 hashes of those secrets are stored by the session Durable Object.
- The host signs its registration (session ID, device ID, identity key) with its
  identity key. The registry pins the first signed key for a device ID and then
  refuses any registration for that ID that is unsigned or uses another key
  (`mac_identity_mismatch`). Hosts that have not updated register unsigned and stay
  unpinned. A pairing-code row is replaced or deleted only by the host that owns it.
- A phone signs each connect (session ID, device ID, identity key). A phone that
  proves it is the registration's trusted phone replaces every other phone socket.
  Any other phone socket (a phone that is pairing, an older app that sends no
  identity, or anyone holding the session ID) cannot disconnect the trusted phone
  and, while it is connected, receives only `serverHello`, `secureReady`,
  `secureError` and host presence; encrypted envelopes go to the trusted socket
  alone. When the host registers a newly paired phone, that phone's socket takes
  over and the previous trusted socket is closed.
- `relayMacRegistration` frames from the host are consumed by the relay and never
  forwarded to a phone.
- Trusted reconnect requests are signed by the paired phone and reject expired or
  replayed nonces.
- Frames are capped at 1 MiB and each socket has a bounded message rate. JSON
  request bodies are read as a stream and cut off at 16 KiB whatever length they
  declare.
- APNs notifications contain only a generic alert plus thread/turn routing IDs and
  completion status. Prompts, responses, previews, and transcript messages are
  excluded.
- Session revocation closes every socket and makes the registry entry unavailable.
  The administrator token is compared in constant time.

Cloudflare can observe connection metadata, device identifiers, public keys,
pairing expiry, encrypted frame sizes, and generic notification routing metadata.
It cannot decrypt application frames. It also cannot pair a device of its own: the
pairing code it stores is a lookup code derived from the code the user types, and
first pairing requires proof of a secret that only the QR and the typed code carry.

## Local development

From the repository root:

```sh
bun run --cwd apps/remote-relay dev
```

Focused verification:

```sh
bun run --cwd apps/remote-relay test
bun run --cwd apps/remote-relay build
```

## Deployment

Configure the non-secret APNs bundle identifier:

```sh
wrangler versions secret put APNS_BUNDLE_ID
```

Configure these secrets with `wrangler secret put` (or the equivalent
environment-specific deployment command):

- `APNS_TEAM_ID`
- `APNS_KEY_ID`
- `APNS_PRIVATE_KEY`
- `RELAY_ADMIN_TOKEN`

Then deploy with `bun run --cwd apps/remote-relay deploy`. Keep separate relay
names and secrets for staging and production. Never place the APNs private key or
relay administrator token in `wrangler.jsonc` or source control.
