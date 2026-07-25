# DJL remote gateway

The gateway runs on the user's computer. It owns the local Codex app-server,
turns its JSON-RPC stream into the DJL mobile protocol, and encrypts application
frames before they reach the Cloudflare relay.

The desktop app is the normal lifecycle owner. A standalone diagnostic run is
also available:

```sh
DJL_RELAY=wss://relay.example/relay bun run --cwd apps/remote-gateway start
```

The first run creates a stable Mac identity and relay authentication secret,
then prints a short-lived QR code. A paired phone is remembered for signed
trusted reconnects. Use `djl-remote reset-pairing` to revoke local phone trust
without rotating the Mac identity.

## Local state

State defaults to `~/.djl/remote` and its canonical file is mode `0600`. On
macOS it is also mirrored in Keychain under
`app.djl.remote-gateway.device-state`. Tests and isolated runs can set
`DJL_DEVICE_STATE_DIR`.

## Verification

```sh
bun run --cwd packages/remote-protocol build
bun run --cwd apps/remote-gateway test
```

See `UPSTREAM.md` and `UPSTREAM_LICENSE` for source provenance.
