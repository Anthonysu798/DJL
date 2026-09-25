# DJL-Backend

Private control plane for DJL Cloud: accounts, organizations, credits, billing, the model
gateway, cross-device sync, per-org cloud runners, and the admin tool. The open-source DJL
monorepo holds the clients; this repository holds everything paid and privileged.

Start with `docs/specs/2026-09-12-phase-0-cloud-control-plane.md`. Every product, auth,
admin, and infrastructure decision for Phase 0 is recorded there and is not re-opened in code.

## Layout

- `apps/api` HTTP + WebSocket service: auth, orgs, credits, billing, gateway, sync, admin API
- `apps/worker` background jobs (pg-boss): settlement, Stripe webhooks, email/SMS, purge, stats
- `packages/domain` pure business rules (ledger, pricing, plans, fraud, admission). No IO
- `packages/db` Drizzle schema and migrations
- `packages/providers` OpenAI, Anthropic, OpenRouter adapters
- `packages/notify` Resend, Twilio, Slack templates
- `infra/` Fly, Supabase, Cloudflare, scripts

## Local development

```sh
bun install
cp .env.example .env
docker compose up -d
bun run db:migrate
bun run dev
```

External services are mocked unless `DJL_MOCK_EXTERNALS=false`.

## Rules

- Never edit or delete a ledger entry. Corrections are new entries.
- Every table is scoped by `org_id`; missing scope fails closed.
- Provider keys live only in Fly secrets. Response bodies are never logged.
- Production deploys only from a `v*` tag after the `production` environment approval.
