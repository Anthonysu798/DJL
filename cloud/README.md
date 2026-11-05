# DJL Cloud

The control plane for DJL Cloud: accounts, organizations, credits, billing, the model gateway,
cross-device sync, per-org cloud runners, and the admin tool. It lives in `cloud/` of the DJL
monorepo next to the desktop, web, and iOS clients, and shares the root Bun workspace.

Start with `docs/specs/2026-09-12-phase-0-cloud-control-plane.md`. Every product, auth,
admin, and infrastructure decision for Phase 0 is recorded there and is not re-opened in code.

## Layout

- `apps/api` HTTP + WebSocket service: auth, orgs, credits, billing, gateway, sync, admin API
- `apps/worker` background jobs (pg-boss): settlement, Stripe webhooks, email/SMS, purge, stats
- `packages/domain` pure business rules (ledger, pricing, plans, fraud, admission). No IO
- `packages/db` Drizzle schema and migrations
- `packages/providers` OpenAI, Anthropic, OpenRouter adapters
- `packages/notify` Resend, Twilio, Slack templates
- `infra/` VPS Compose stack, native Postgres policies, optional isolated sandboxes, scripts

The separate commerce test system adds buyer `/shop`, supplier `/shop/supplier`, and admin
`/commerce` pages. Setup, isolation, funding gates and the uncompleted production acceptance
criteria are documented in `../docs/commerce-development.md`. It does not reuse AI credit balances.

## Local development

From the repository root:

```sh
bun install
cp cloud/.env.example cloud/.env
docker compose -f cloud/docker-compose.yml up -d
bun run cloud:db:migrate
bun run cloud:db:seed
bun run cloud:dev
```

`bun run cloud:ci` runs format, lint, typecheck, and tests for everything under `cloud/`.
Container images build from the repo root, for example
`docker build -f cloud/apps/api/Dockerfile .`.

Existing AI/account external services are mocked unless `DJL_MOCK_EXTERNALS=false`.
Commerce's separate Stripe TEST adapter has its own explicit disabled-by-default opt-in;
it does not require enabling unrelated AI payment or email services.

## VPS deployment

Use [infra/vps/README.md](infra/vps/README.md) for authenticated Postgres, private Redis
and storage, HTTPS, client login configuration, backup, and safe up/down commands. SMS
is disabled. Supabase is not required.

## Rules

- Never edit or delete a ledger entry. Corrections are new entries.
- AI data is scoped by `org_id`; missing scope fails closed. Commerce accounts and orders are
  scoped by authenticated user ID, and supplier data by explicit supplier membership, never AI team roles.
- Provider keys live only in the private VPS environment. Response bodies are never logged.
- Production deploys only from a `cloud-v*` tag after the `production` environment approval.
  Plain `v*` tags release the desktop app.
