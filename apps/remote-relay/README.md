# DJL remote relay

This Cloudflare Worker connects one DJL desktop host to one paired iPhone through
hibernating Durable Object WebSockets. The relay forwards opaque end-to-end
encrypted frames and never queues transcript content.

## Security boundaries

- A session accepts one host and one phone; a newer connection replaces the old
  connection for that role.
- The host authenticates with high-entropy session and notification secrets. Only
  SHA-256 hashes of those secrets are stored by the session Durable Object.
- Trusted reconnect requests are signed by the paired phone and reject expired or
  replayed nonces.
- Frames are capped at 1 MiB and each socket has a bounded message rate.
- APNs notifications contain only a generic alert plus thread/turn routing IDs and
  completion status. Prompts, responses, previews, and transcript messages are
  excluded.
- Session revocation closes both sockets and makes the registry entry unavailable.

Cloudflare can observe connection metadata, device identifiers, public keys,
pairing expiry, encrypted frame sizes, and generic notification routing metadata.
It cannot decrypt application frames.

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
