# DJL Cloud on a VPS

This stack hosts Better Auth, Postgres, Redis, S3-compatible files, the API,
background worker, web login/chat, and the admin app. It does not use Supabase
or SMS. Postgres authentication uses SCRAM with separate admin, migration, API,
and worker accounts. The API and worker cannot change the schema or rewrite
append-only accounting history.

## First deployment

Requirements: Linux, Docker Engine with Compose, DNS access, and a backup destination.
Use an existing VPS; this setup does not provision or purchase infrastructure.

From the repository root:

```sh
./cloud/infra/vps/djl.sh init
# Edit cloud/infra/vps/.env privately. Do not paste keys into chat or commit them.
./cloud/infra/vps/djl.sh check
./cloud/infra/vps/djl.sh up
./cloud/infra/vps/djl.sh status
./cloud/infra/vps/djl.sh verify
```

`init` generates independent random credentials and refuses to overwrite an existing
`.env`. The file and generated S3 credentials are private and excluded from Git and
Docker build contexts. Only the API/worker receive provider secrets; frontend builds
receive only the public API URL. Docker administrators can inspect container secrets,
so SSH/Docker access must remain restricted to trusted operators.

Set four DNS hostnames in `.env`: `API_HOST`, `WEB_HOST`, `ADMIN_HOST`, and
`STORAGE_HOST`. Add A records pointing to your VPS. Use DNS-only records initially
so TLS and streaming can be verified directly. Set `TLS_EMAIL`, `COOKIE_DOMAIN`,
and `PASSKEY_RP_ID` for your domain.

The stack binds API, web, admin, and storage only to loopback. Postgres and Redis
have no published ports. On a VPS with Caddy already installed, add the generated
`Caddyfile.host` site blocks to its configuration after checking for hostname
conflicts, validate the complete configuration, then reload Caddy. Keep existing
download sites intact. The fragment uses loopback ports 8787/3002/3001/8333;
update upstreams if you change the corresponding bind ports.

On a fresh VPS without another reverse proxy, start the optional container proxy:

```sh
docker compose --env-file cloud/infra/vps/.env -f cloud/infra/vps/compose.yml \
  --profile edge up -d --wait
```

Only ports 80/443 and SSH should be publicly reachable. Caddy keeps streaming
responses unbuffered and removes spoofable upstream IP headers.

## Providers and client login

Set the existing Stripe sandbox key, webhook signing secret, and top-up price.
The webhook URL is `https://API_HOST/v1/webhooks/stripe`; register the event types
handled by `billing/BillingService.ts`. Monthly subscription price IDs are mapped
with an audit record during migration; existing mappings change only when specified.
Stripe Tax and price configuration must be ready before testing checkout.

Set a Resend sending key and a verified `EMAIL_FROM` domain for email verification
and password reset. Google OAuth's web callback is
`https://API_HOST/v1/auth/callback/google`. Add `https://WEB_HOST` as an authorized
origin and allow the iOS client ID through `GOOGLE_ALLOWED_CLIENT_IDS`. Apple login
needs its own approved client configuration.

Configure at least one model provider key for real cloud replies. Without one,
the API can serve login/sync but inference is unavailable; it never returns mock
replies in staging/production.

The catalog hides providers without a configured key. A key does not fund its
provider account: enable paid models only after confirming the upstream model IDs,
prices, and available balance. The seed includes a zero-priced OpenRouter model
for bounded staging tests; free capacity is rate-limited by OpenRouter. Other seed
prices remain placeholders that must be confirmed before enabling them for users.

Desktop already exposes **Settings → Account → DJL Cloud → Sign in with browser**.
For a local desktop build set `DJL_CLOUD_API_URL=https://API_HOST` and
`DJL_CLOUD_WEB_URL=https://WEB_HOST`; set `VITE_DJL_CLOUD_WEB_URL=https://WEB_HOST`
so its billing button also opens the correct environment. For iOS set the
`DJL_CLOUD_API_URL` build setting through private overrides; also configure its
Google client ID. Web visitors reach the existing `/sign-in` and `/sign-up` UI.

The worker starts without Fly. Python and PDF/Office parsing are intentionally
disabled unless an isolated sandbox is configured; user code never runs inside the
API/worker or through the host Docker socket. Text attachments and direct page reads
remain available. Exa search and APNs push are optional and activate only with valid
credentials. Without APNs, completed tasks use email notifications.

## Operations

```sh
./cloud/infra/vps/djl.sh logs api
./cloud/infra/vps/djl.sh backup
./cloud/infra/vps/djl.sh down
./cloud/infra/vps/djl.sh up
```

`down` preserves Postgres, Redis, and file volumes. Never add `--volumes` when
stopping a deployed stack. `up` reapplies migrations, seed defaults, and runtime
permissions before the API starts; existing plan edits are preserved.

`backup` briefly stops API/worker/storage, captures Postgres and the file volume,
then restarts services. Copy backups and the private `.env` to separate encrypted
storage, and test recovery on a separate Compose project before relying on them.
Keep the same auth secret when restoring; changing it invalidates encrypted keys.
Changing database passwords in `.env` does not rotate passwords in an existing
Postgres volume: perform explicit database role rotation and update clients together.

Create the first admin from a trusted shell with the existing
`cloud/apps/api/src/admin/createAdmin.ts` command; enter its password interactively.
Paid/staging admin access requires MFA.

## Verification

Run `bun run cloud:ci`. Build all container images, boot a separate local Compose
project, and verify authenticated database access, invalid-password rejection,
append-only grants, real S3 upload/download signatures, login, and data preservation
after down/up. After deployment, verify API `/ready`, web `/sign-in`, actual OAuth,
email verification, a provider-backed reply, and a Stripe sandbox checkout/webhook.
Container startup alone is not an end-to-end payment or model test.

## GitHub deployments

The staging and production workflows use `deploy.sh` over SSH with strict host-key
verification. Configure `STAGING_VPS_HOST`, `STAGING_VPS_SSH_KEY`, and
`STAGING_VPS_KNOWN_HOSTS` in the staging environment; production uses the corresponding
`PROD_VPS_*` secrets. Use a dedicated deploy key, never the VPS account password.
Provision each host and private `.env` manually first. These secrets are not created
by the Compose stack. Staging requires successful Cloud CI for the exact commit;
production additionally requires a `cloud-v*` tag on main and environment approval.
Deployments back up data, apply migrations/grants, wait for health, and verify runtime
permissions. They preserve the existing VPS environment and proxy configuration.
