# DJL VPS remote relay

Run the existing encrypted WebSocket relay on your own VPS with the official,
pinned `workerd` runtime. The same worker and Durable Objects are used locally
and on Cloudflare; this package does not introduce a second transport protocol.
Accounts stay in the cloud API's PostgreSQL database. Relay routing, host-secret
hashes and revocations persist in the private `remote-relay-state` Docker volume.
The relay forwards opaque messages and does not store chat contents.

From the VPS checkout:

```sh
./cloud/infra/vps/djl.sh remote-up
./cloud/infra/vps/djl.sh remote-down
```

Load the generated `Caddyfile.host` into the existing host proxy (or use the
Compose edge proxy). It routes `/relay/*`, pairing-code lookup and trusted
reconnect to port 8789, and keeps account endpoints on the cloud API.
Keep port 8789 bound to loopback; only Caddy exposes HTTPS/WSS publicly.
Do not delete the Docker volume when stopping the service.

The desktop derives `wss://API_HOST/relay` from `DJL_CLOUD_API_URL`, or uses
the packaged `djlRemoteRelayUrl` override. It starts its bundled gateway on
launch; customers do not install a bridge or run terminal commands. Set the
iPhone release's `DJL_DEFAULT_RELAY_URL` to the same URL so manual pairing-code
lookup reaches the matching deployment. This is a release configuration step,
not a customer setup step.

Optional `RELAY_ADMIN_TOKEN` enables administrator revocation; when unset, that
endpoint refuses all requests. Keep it and any optional APNs keys in the private
VPS `.env`, never in the desktop package or Git. In-app notifications need no APNs.

Local acceptance:

```sh
bun run --cwd apps/remote-relay test:vps
docker build -f apps/remote-relay/vps/Dockerfile -t djl-remote-relay .
```

The real runtime tests cover pairing-code lookup, opaque frame delivery,
host-secret enforcement, persisted authentication and persisted revocation.
The runtime's local Durable Object storage is experimental upstream; keep this
version pinned, back up the volume and test upgrades before deploying them.
