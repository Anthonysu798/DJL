# DJL VPS operations

The Servers page uses Linux/Docker counters collected by a private host controller. No model provider, monitoring SaaS or additional customer credentials are required.

## Components

- controller.py: host metrics, seven-day SQLite history, resource/service alerts, redacted logs, receipts and a serialized allowlisted executor.
- djl-operations.service: constrained systemd service. It controls only DJL containers, the fixed rootless Codex broker, private backups, verified local images and explicitly confirmed VPS reboots.
- operations.compose.yml: separate authenticated control gateway. Existing MFA-verified admin sessions remain usable during main API restarts. A new sign-in still needs the main API.
- Servers page: ten-second refresh, charts, alerts, logs, private backup metadata, curated releases and operation progress.

Controls require the administrator role and an explicit ID in SERVER_CONTROL_ADMINS. Disruptive operations require fresh TOTP, typed confirmation and a reason. The API commits an audit intent before dispatch, consumes the TOTP step once, and expires undispatched authorizations after five minutes. A background reconciler records outcomes even after the browser closes.

Controller requests use HMAC-SHA256 over method/path/body, a 30-second timestamp window and a single-use nonce. The credential stays private and is not transmitted to the controller or browser. No arbitrary command, filesystem path, remote image, volume deletion or restore endpoint exists.

## Installation

Run full Cloud CI and the Python suite before preparing images. Keep the running API/admin image IDs and private environment backed up. Install the public controller source at /opt/djl-operations/controller.py and the unit under /etc/systemd/system.

Create private /etc/djl-operations/config.json with these keys:

    {
      "bindHost": "172.16.1.1",
      "port": 9085,
      "label": "DJL staging VPS",
      "stateDir": "/var/lib/djl-operations",
      "secretFile": "/etc/djl-operations/controller.key",
      "releaseFile": "/etc/djl-operations/releases.json",
      "stackPath": "/srv/djl-cloud-staging",
      "composeFiles": [
        "cloud/infra/vps/compose.yml",
        "cloud/infra/codex/worker-pilot.compose.yml",
        "cloud/infra/vps/operations.compose.yml"
      ]
    }

Confirm the private bridge address. Generate a 256-bit random credential on the host; keep configuration directories private and the key at mode 0600. Put the same credential into the private VPS environment as SERVER_CONTROL_TOKEN; set SERVER_CONTROL_URL and explicit operator IDs. Never copy credentials into source or deployment archives.

Register only immutable local image IDs with recorded green checks in releases.json. Entries contain id, service, label, imageId, status "passed" and the positive integer checks. Dashboard actions do not pull/build images or run migrations.

Build API/admin images, enable the controller, and start the Compose overlay. Route only /admin/v1/servers, /admin/v1/servers/\*, /admin/v1/me and /admin/v1/auth/logout on the existing API host to loopback port 8788. Preserve other API/relay routes and strip spoofable IP headers. Validate Caddy before reloading.

## Operations and limits

- Backup briefly stops API, worker and storage writes, captures Postgres and files, and resumes services that were running. Archives stay private at mode 0600. Copy them off-site separately.
- Restart and deployment wait for readiness. Failed deployments restore the prior image. Interrupted jobs are marked with an unknown outcome instead of being executed twice.
- The control gateway uses Postgres/Redis for authentication. During their restart, requests fail closed temporarily; permanently unavailable databases require trusted SSH recovery.
- API history stores counters and response-header latency only. No content, paths, headers or client addresses are retained. Host history is retained for seven days.
- Do not reboot the shared VPS or deploy an older schema during acceptance. Verify disruptive command/confirmation boundaries with fixtures, and exercise safe real operations separately.

Run Python unittest discovery in this directory, focused operations/UI tests, and bun run cloud:ci.
