# DJL Cloud Phase 0: private backend, accounts, credits, gateway, sync, cloud runner, admin

> **Superseded on 2026-09-25:** the backend no longer lives in a separate private
> `DJL-Backend` repository. It moved into `cloud/` of the public DJL monorepo, and production
> deploys from `cloud-v*` tags. Every other decision below still stands.

## Context

DJL today is local-first: every model call runs on the user's machine with their own provider
credentials. There are no accounts, no billing, no hosted inference, and no cross-device
history. The PRD "DJL 全球 AI 商业增长与分销平台 V3.4" describes a merchant AI Business OS
whose every later phase depends on a cloud control plane (Auth, Billing, Model Gateway,
Sync, Cloud Runner, Admin, Audit).

Phase 0 builds that control plane in a new private repository, `DJL-Backend`, and adds the
client half to the open-source monorepo. Business model: resale of cloud model usage in
credits (中转站), sold as subscription tiers with included credits plus top-ups, under the
name **DJL Cloud**. Chinese users must be able to sign up and use it from launch through a
non-Cloudflare hostname; mainland hosting with ICP filing follows once the Chinese entity
exists.

Everything ships together before anyone outside the team uses it. Team is the user plus
Claude. Budget is not a constraint.

## Decisions (final, do not re-open)

### Product

| Area             | Decision                                                                                                                                                                                                                                                                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Name             | DJL Cloud; unit is **credits**, 100 credits = 1 USD                                                                                                                                                                                                                                                                                                                |
| Onboarding       | Account optional; local providers work without sign-in; DJL Cloud, credits, sync need sign-in                                                                                                                                                                                                                                                                      |
| Orgs             | Full organizations. Every user gets a hidden personal org at signup that owns credits and billing. Team orgs optional, roles owner/admin/member/billing, email invites                                                                                                                                                                                             |
| Tiers            | Starter $20 / 2,000 cr, Business $60 / 6,500 cr, Autopilot $180 / 21,000 cr. Annual = 2 months free. Top-ups at 100 cr/USD, $5 minimum. Same model catalog for all paid tiers                                                                                                                                                                                      |
| Margin           | ~40% over provider cost, baked into per-model credit prices                                                                                                                                                                                                                                                                                                        |
| Priority         | Paid tiers get scheduling priority over trial; Business and Autopilot over Starter. Priority weights editable in admin                                                                                                                                                                                                                                             |
| Limits           | Concurrent streams: Trial 2, Starter 5, Business 15, Autopilot 40. 60 req/min per user, per-IP cap. All in the plans table, editable in admin                                                                                                                                                                                                                      |
| Trial            | 200 credits, expires 14 days, granted only after: mobile-line phone verification (VoIP blocked via Twilio Lookup), one trial per phone hash forever, device + IP velocity checks, and the first real cloud request from a client. Global cap $100/day, overflow queues for manual approval                                                                         |
| Out of credits   | Stream is cut immediately at zero; next request refused with a Buy credits link                                                                                                                                                                                                                                                                                    |
| Refunds          | Top-ups refundable within 14 days if no settlement references them; subscriptions cancel at period end, no proration                                                                                                                                                                                                                                               |
| Currency         | USD ledger; Stripe multi-currency display prices for CNY, EUR, JPY                                                                                                                                                                                                                                                                                                 |
| Models           | Raw provider model names shown. Direct OpenAI and Anthropic keys; OpenRouter for Google, xAI, DeepSeek, Kimi, GLM, and image models (gpt-image direct, Flux, Ideogram)                                                                                                                                                                                             |
| Gateway features | Streaming chat with tool calling, vision inputs, structured JSON output, embeddings, image generation                                                                                                                                                                                                                                                              |
| API keys         | Not in Phase 0                                                                                                                                                                                                                                                                                                                                                     |
| Sync             | Opt-in per device, off by default, clear data-destination notice. All threads including local-provider threads. Append-only event replication with per-device cursors; last-writer-wins per event, no data loss. Storage limits per tier set by me, editable in admin. Server-side encryption at rest, Owner-role admins may access for support and abuse, audited |
| Cloud engine     | Cloud edition of `apps/server` per org, gateway-only providers, no local files, terminals, or CLI providers. Powers full chat on web and iOS. This is the PRD's Cloud Runner                                                                                                                                                                                       |
| Clients          | Desktop (Electron), web app at `app.slcor.com` with full chat, iOS with full chat, landing signup link                                                                                                                                                                                                                                                             |
| Languages        | English and Simplified Chinese first for emails, SMS, dashboard; remaining desktop locales before launch if time allows; admin app English only                                                                                                                                                                                                                    |
| Notifications    | Low credit at 20% and 0 (email + in-app), security emails (new device, password, 2FA), monthly usage summary, iOS push via existing APNs relay for sync and billing events                                                                                                                                                                                         |
| Retention        | Conversation content is stored (sync). Account deletion: soft delete, 30-day grace, scheduled hard purge, ledger anonymized not deleted                                                                                                                                                                                                                            |
| Legal            | US company, 18+ self-declared, Stripe Tax on. Terms, Privacy, and refund policy text are provided by the user; I add checkbox and links                                                                                                                                                                                                                            |

### Auth

| Area        | Decision                                                                                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Library     | Self-hosted Better Auth on our Postgres                                                                                                                            |
| Identifiers | Email or phone, both are login identifiers; phone-only accounts get a placeholder email                                                                            |
| Methods     | Email+password (argon2id, breach check), phone OTP, Google, Apple, TOTP, passkeys, SMS 2FA. WeChat login later as a provider row                                   |
| Linking     | Auto-link when the OAuth provider asserts a verified email                                                                                                         |
| 2FA policy  | Optional and encouraged; required for org owners on paid plans                                                                                                     |
| Sessions    | 15-minute access tokens, 30-day rotating refresh tokens with family reuse detection; revoke-all on password change or admin action; desktop and iOS stay signed in |
| Devices     | Every client registers a device row; iOS binds its existing Ed25519 identity                                                                                       |
| SMS         | Twilio Verify worldwide; China falls back to email OTP until Aliyun SMS exists                                                                                     |
| Email       | Resend, `no-reply@slcor.com` and `support@slcor.com`                                                                                                               |

### Admin

| Area          | Decision                                                                                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App           | Separate Next.js app at `admin.slcor.com`, separate `admins` table, TOTP or passkey mandatory, IP allowlist, every action audited                                               |
| Roles         | Owner (everything, invites, kill switches, prices), Support (view, reset limits, suspend, credit grants up to a cap with reason), Finance (ledger, refunds, revenue), Read-only |
| Impersonation | None                                                                                                                                                                            |
| Reset button  | Clears rate-limit counters, concurrency holds, login lockouts, fraud flags. Never moves credits                                                                                 |
| Kill switches | Three: gateway, billing, sync. Reads keep working. Each flip audited and alerts                                                                                                 |
| Moderation    | Provider refusals counted per user; repeated hits flag, warn, then auto-suspend for review                                                                                      |
| Team alerts   | Resend email digests and incident alerts, Slack/Discord webhook for fraud, kill switch, provider outages, deploys; SMS for P0 only                                              |

### Infrastructure

| Area       | Decision                                                                                                                                                                                                              |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Language   | TypeScript, Bun, Effect, Vitest, Turbo, same conventions as the open-source monorepo                                                                                                                                  |
| Repo       | `Anthonysu798/DJL-Backend`, private, created with `gh` (already authenticated with repo+workflow scopes)                                                                                                              |
| Compute    | Fly.io. US East primary, Singapore secondary. Cloud runner = one Fly Machine per org, started on demand, stopped when idle                                                                                            |
| Database   | Supabase Postgres in the user's paid **DJL** organization, separate prod and staging projects. Note: this session's Supabase connector only sees another organization; the user must reconnect with the DJL org login |
| Storage    | Supabase Storage for attachments, generated images, documents                                                                                                                                                         |
| Cache      | Upstash Redis for rate limits and stream reservations only                                                                                                                                                            |
| Queue      | pg-boss in Postgres for settlement, webhooks, email/SMS, purge, stats                                                                                                                                                 |
| Payments   | New DJL Stripe account (to be created and connected; test mode until then). Stripe Checkout, Customer Portal, Stripe Tax. Alipay and WeChat Pay toggled later                                                         |
| Hostnames  | `api.slcor.com` (Cloudflare proxied), `api-asia.slcor.com` (Cloudflare DNS-only to Fly Singapore, for mainland reachability), `admin.slcor.com`, `app.slcor.com`. DNS on Cloudflare                                   |
| Autoscale  | In-flight streams per API instance: out above ~200, in below ~50                                                                                                                                                      |
| Monitoring | OpenTelemetry to Grafana Cloud, Sentry for errors, incident.io status page, `trace_id` on every request                                                                                                               |
| Secrets    | Fly and Vercel secret stores. Provider keys: primary + fallback per provider, quarterly rotation script                                                                                                               |
| Dev env    | docker compose with Postgres and Redis; providers, Stripe, Twilio, Resend mocked by default                                                                                                                           |
| Deploy     | Every push to main deploys staging. A `v*` tag deploys production after the user approves the GitHub `production` environment. Fail-closed ship script like the desktop one                                           |
| Security   | Automated abuse suite in CI plus one external pentest before public launch                                                                                                                                            |
| Contract   | Public API types live in the open-source `packages/contracts`; cloud apps import it as `@synara/contracts/cloud` (`workspace:*`)                                                                                      |

## Architecture

```
Desktop (apps/server local)  ──┐
Web app (app.slcor.com)       ──┼──► api.slcor.com / api-asia.slcor.com (apps/api, Fly)
iOS                            ──┘         │            │            │
                                         Auth        Credits      Gateway ──► OpenAI / Anthropic / OpenRouter
                                           │            │            │
                                     Supabase Postgres (events, ledger, users, orgs)  ◄── worker (pg-boss)
                                           │
                        Cloud runner per org (apps/server cloud edition on Fly Machines)
                                           │
                               Supabase Storage (attachments)      admin.slcor.com (apps/admin)
```

### How sync and the cloud runner share one design

The local server already stores everything as an event log (`orchestration_events` with a
global `sequence` and per-stream `stream_version`, see
`apps/server/src/persistence/Migrations/001_OrchestrationEvents.ts`) and exposes cursor
replay (`OrchestrationEventStore.readFromSequence`, `orchestration.replayEvents`,
`orchestration.subscribeDomainEvents` with `fromSequenceExclusive` in
`packages/contracts/src/orchestration.ts`).

- The cloud holds one org-scoped event store in Postgres with the same event shape plus
  `org_id`, `origin_device_id`, and a cloud `sequence`.
- **Sync** = the desktop pushes its new events (from its own sequence cursor) and pulls
  everyone else's (from a per-device cloud cursor). Attachments upload by `contentHash`
  from `projection_thread_messages.attachments_json` into Supabase Storage.
- **Cloud runner** = the `apps/server` code running in a Fly Machine with a new Postgres
  persistence layer implementing the existing `persistence/Services/*` interfaces against
  the org's event store, providers restricted to the `DjlCloudAdapter`, and file, terminal,
  and Git features disabled by policy. Web and iOS connect to it over the existing WebSocket
  contract, so the web renderer runs unchanged.
- Conflicts: events are append-only; two devices continuing one thread produce interleaved
  events by `occurred_at`; the projector keeps both, matching the PRD's ETag guidance.
- Kill switch `sync` stops pushes and machine starts; reads continue.

## Repository layout: `DJL-Backend`

```
apps/
  api/        Effect HTTP + WS service: auth, orgs, credits, billing, gateway, sync, admin API
  worker/     pg-boss consumers: settlement, Stripe webhooks, email/SMS, purge, stats, trial cap
  runner/     Cloud edition entry for apps/server (consumes the open-source server package by git tag)
  web/        Next.js app.slcor.com: account, billing, usage, team, sync viewer, hosts the chat renderer
  admin/      Next.js admin.slcor.com
packages/
  db/         Drizzle schema + migrations
  domain/     Pure logic: ledger, pricing, routing, priority, policy, fraud rules. No IO, fully unit tested
  providers/  OpenAI, Anthropic, OpenRouter adapters + circuit breakers
  notify/     Resend, Twilio, Slack templates, en + zh-Hans catalogs
infra/
  fly/        fly.toml per app and region, autoscale, machine templates for runners
  supabase/   project config, RLS, storage buckets, seed
  cloudflare/ DNS records as code (api-asia DNS-only)
  scripts/    deploy, migrate, rotate-provider-keys, ship
.github/workflows/ ci.yml, deploy-staging.yml, deploy-prod.yml (production environment approval)
docs/         specs, runbooks, threat model
```

## Open-source monorepo changes (worktree branch `feat/djl-cloud-client`)

- `packages/contracts/src/cloud.ts`: schemas for auth, orgs, credits, usage, billing, models, gateway, sync, devices. Same Effect Schema style as `packages/contracts/src/auth.ts`.
- `apps/server/src/provider/Layers/DjlCloudAdapter.ts` and `Services/DjlCloudAdapter.ts`, registered in `ProviderAdapterRegistry.ts`. OpenAI-compatible streaming with tools, vision, JSON mode. Model list from `GET /v1/models`.
- `apps/server/src/persistence/Layers/Postgres.ts`: Postgres implementation of the existing persistence services, used only by the cloud runner. Feature flags to disable filesystem, terminal, Git, and CLI providers in cloud mode.
- `apps/server/src/sync/`: event push/pull with cursors, attachment upload, per-device opt-in switch persisted in server settings.
- `apps/web`: Sign in / Sign up, credit balance and plan badge in Accounts, low-credit banner, sync switch with data-destination notice, Buy credits link to `app.slcor.com`.
- `apps/desktop`: OAuth through the system browser returning on the already registered `djl://` protocol in `main.ts`; refresh token in Keychain.
- `apps/ios`: sign in, bind Ed25519 device identity via `POST /v1/devices`, full chat against the org's cloud runner, push via the existing relay.
- `apps/landing`: Sign up and Pricing links to `app.slcor.com`.
- Locale catalogs: new strings in `en` and `zh-Hans` first.

## Data model (Postgres, Drizzle)

- Identity: `users`, `anonymous_identities`, `identity_providers`, `sessions`, `refresh_tokens` (family, reuse detection), `mfa_factors`, `phone_verifications` (phone hash, line type), `devices`.
- Orgs: `organizations` (kind personal|team), `memberships`, `invitations`.
- Billing: `customers`, `subscriptions`, `plans` (price, included credits, concurrency, req/min, priority weight, sync quota), `credit_ledger` (append-only: plan_grant, topup, trial_grant, reservation, settlement, release, refund, admin_grant, expiry, anonymize; idempotency key), `credit_balances`, `stripe_events`, `invoices`.
- Usage: `model_catalog` (provider, credit prices per 1K in/out or per image, status, quality, region), `usage_requests` (org, user, device, model, route_reason, tokens, images, reserved, settled, latency, refusal flag, trace_id), `rate_limit_policies`, `abuse_flags`, `trial_budget_days`.
- Sync and runner: `thread_events` (org-scoped event log), `thread_index`, `attachments` (content hash, bucket key, size), `device_cursors`, `runner_machines`.
- Admin: `admins`, `admin_sessions`, `audit_events` (insert-only, no delete grant), `kill_switches`, `daily_stats`.
- Every business table carries `org_id`; service layer enforces scope and Postgres RLS mirrors it so a missing filter fails closed.

## Public API (`/v1`)

- Auth: signup, login, logout, refresh, password forgot/reset, phone send/verify, oauth google/apple start and callback, mfa totp and passkey enroll/verify/disable, sessions list/revoke/revoke-all.
- Identity: `POST /identity/merge`.
- Me and devices: `GET/PATCH/DELETE /me`, `POST/DELETE /devices`.
- Orgs: CRUD, members, invitations.
- Credits and usage: balances, ledger, usage with per-model breakdown and CSV export.
- Billing: checkout (tier or top-up), portal, subscription, `POST /webhooks/stripe`.
- Models: `GET /models`.
- Gateway, OpenAI-compatible: `POST /chat/completions` (SSE, tools, vision, json mode), `POST /images/generations`, `POST /embeddings`.
- Sync: `POST /sync/events` (push), `GET /sync/events?cursor=` (pull), `PUT /sync/attachments/{hash}`, `GET /sync/attachments/{hash}` (signed URL), `GET/PUT /sync/devices/{id}/enabled`.
- Runner: `POST /runner/connect` returns a short-lived WebSocket URL for the org's machine.
- Health: `GET /health`, `GET /ready`.

Admin API on `admin.slcor.com` only: users and orgs search, edit, suspend, soft delete; credit grant with reason and per-role cap; reset limits; sessions revoke; ledger, usage, refunds; stats by day/week/month/year and country; model catalog and prices; plan limits and priority weights; trial cap and queue approvals; kill switches; audit search; runner machine list and stop.

## Credits mechanics (`packages/domain`)

1. Resolve org, plan, limits, priority, kill switch, suspension.
2. Reserve: estimate from model price and `max_tokens`; reject if plan+topup balance is below the estimate. Reservations count against concurrency.
3. Stream; count tokens from the provider's usage block. If the balance reaches zero mid-stream, abort the upstream request and end the SSE with an `insufficient_credits` event.
4. Settle replaces the reservation with actual cost; failures release it. Plan credits before top-up credits.
5. Worker releases reservations older than 10 minutes with no settlement.
6. Plan credits expire on cycle rollover; top-ups never expire; trial credits expire at 14 days.
7. Every entry idempotent; Stripe webhooks idempotent on event id. Invariant test: sum of entries equals balance, always.

## Security baseline

- Better Auth with lockouts, breach checks, device-bound refresh tokens; admin routes behind separate auth, 2FA, IP allowlist.
- Rate limits per user, org, IP, and device in Redis; priority scheduler favors paid tiers when the stream cap is near.
- Fraud rules for trials as decided; refusal counting for moderation.
- Upstream keys only in Fly secrets; response bodies never logged; log redaction for tokens, emails, phones.
- SSRF allowlist for outbound, webhook signature checks, CORS restricted to `app.slcor.com`, the landing origin, and the desktop origin from `apps/server/src/trustedOrigins.ts`.
- CI abuse suite: auth bypass, IDOR across users/orgs/devices, replayed webhooks, negative balance, concurrent spend races, mid-stream cutoff, refresh reuse, rate-limit evasion, trial farming, sync cursor tampering, cross-org sync reads, log leak scan, SSRF.
- Supabase PITR on prod; restore drill in the runbook.

## China readiness

- `api-asia.slcor.com` is DNS-only on Cloudflare pointing at Fly Singapore; clients probe both hostnames and choose the faster.
- Provider rows for WeChat login and Aliyun SMS; Stripe Alipay/WeChat Pay toggles.
- Sync is opt-in per device, satisfying PRD 75 on cross-border data.
- Mainland deployment after the entity and ICP filing, using the Alibaba Cloud account that already hosts `djl-china-releases`.

## Milestones and verification (all complete before external users)

**M1 backend core on staging:** repo, CI, Supabase staging, Fly staging, schema, Better Auth flows, orgs, ledger, Stripe test checkout and webhooks, Resend, Twilio Verify with Lookup, audit, OTel, health, abuse suite.
Verify: CI green; scripted flow signup → phone verify → first request → trial grant → checkout → webhook → balance; ledger invariant test; abuse suite; traces in Grafana; incident.io monitor green.

**M2 gateway and desktop:** provider adapters, routing, priority, reserve/settle with mid-stream cutoff, catalog, tagged contract package, `DjlCloudAdapter`, Accounts UI, desktop OAuth deep link.
Verify: fresh desktop profile signs in, streams a tool-using reply through DJL Cloud, balance drops by the settled amount; image generation deducts per image; cutting the stream releases the reservation; 50 parallel streams never go negative; zero balance cuts the stream.

**M3 sync, cloud runner, web:** Postgres persistence layer, sync push/pull, attachment upload, runner machines on Fly, `app.slcor.com` with dashboard and hosted chat renderer.
Verify: desktop enables sync, thread appears in the web app within seconds; continuing it on the web appears on desktop; offline edits on both merge without loss; runner machine stops when idle and restarts on connect; sync kill switch halts uploads.

**M4 iOS, admin, production, pentest:** iOS sign-in, device binding, chat via runner, push; admin app with roles, stats, kill switches, reset, trial queue; production Supabase, Fly, Stripe live; `deploy-prod.yml` with approval; external pentest and fixes.
Verify: admin finds, suspends, grants credits to, and resets a user and every action is in the audit log; each kill switch takes effect within 5 seconds; a tagged release deploys only after approval; pentest report has no open high findings.

## Prerequisites from the user (none block the first commits)

- Reconnect the Supabase connector with the account that owns the DJL organization.
- Create the DJL Stripe account and connect it.
- Accounts and keys: Fly.io, Upstash, Twilio, OpenAI, Anthropic, OpenRouter, Grafana Cloud, Sentry, incident.io, Slack or Discord webhook, Google OAuth client, Apple Sign-In service id.
- Cloudflare DNS access for `slcor.com` records and Resend domain verification.
- Terms of Service, Privacy Policy, refund policy text.
- Install `flyctl` and `supabase` CLIs on this machine.

## Execution start after approval

1. `gh repo create Anthonysu798/DJL-Backend --private`, push the scaffold with CI and this plan as `docs/specs/2026-09-12-phase-0-cloud-control-plane.md`.
2. Create the monorepo worktree `feat/djl-cloud-client` and add the client spec to `docs/superpowers/specs/`.
3. Start M1.
