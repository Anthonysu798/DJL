# DJL Cloud Phase 0 — build status (2026-09-12)

Spec: `docs/specs/2026-09-12-phase-0-cloud-control-plane.md`. Everything below was built and
verified locally against Postgres 17 and Redis with external services mocked. Nothing has
been deployed: staging and production need the accounts listed under Prerequisites.

## Done and tested

| Area                                                                                                                                                                                                                 | Where                                                 | Proof                                                                         |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------- |
| Domain rules: microcredits, margin pricing, append-only ledger, plans, trial fraud rules, admission priority                                                                                                         | `packages/domain`                                     | 24 unit tests incl. a 200-step reserve/settle invariant                       |
| Schema + migration, append-only grants and RLS policies                                                                                                                                                              | `packages/db`, `infra/supabase/policies.sql`          | migration applies; app role cannot UPDATE the ledger or DELETE audit rows     |
| Accounts: email/password (argon2id), email OTP, phone OTP, Google/Apple, TOTP, passkeys, organizations, hidden personal org per user, 15-min JWT + 30-day session, device-authorization flow                         | `apps/api/src/auth`                                   | end-to-end suite signs up, verifies, switches orgs, completes the device flow |
| Credits: Postgres ledger with per-org row locking, reserve/settle/release/expiry, refold repair                                                                                                                      | `apps/api/src/credits`                                | 25-way race test never overspends                                             |
| Billing: Stripe Checkout (tiers, whole-dollar top-ups), Customer Portal, idempotent webhooks, plan grants per invoice                                                                                                | `apps/api/src/billing`                                | replayed webhooks are no-ops; kill switch refuses checkouts                   |
| Trials: mobile-line check, one per phone hash, device/IP velocity, first-request grant, daily budget queue, admin approval                                                                                           | `apps/api/src/trial`                                  | 4 tests                                                                       |
| Gateway: OpenAI-compatible chat (SSE, tools, vision, JSON), images, embeddings; capability routing with reason codes; per-plan limits; cut at zero; settles on disconnect; usage rows without content; refusal flags | `apps/api/src/gateway`, `packages/providers`          | 12 gateway tests + 6 adapter tests; end-to-end stream deducts credits         |
| Providers: OpenAI, OpenRouter, Anthropic adapters; primary/fallback keys; circuit breakers                                                                                                                           | `packages/providers`                                  | unit tests with fake upstreams                                                |
| Sync: org event log with cursors, thread index, content-addressed attachments, quotas, kill switch                                                                                                                   | `apps/api/src/sync`                                   | 5 tests incl. two-device merge and no cross-org reads                         |
| Admin API: separate accounts, TOTP, IP allowlist, 4 roles, audited operations, stats, catalog/plan/settings edits, kill switches, trial queue                                                                        | `apps/api/src/admin`                                  | 8-step HTTP test                                                              |
| Worker: stale reservations, trial expiry, refold, purge, daily stats                                                                                                                                                 | `apps/worker`                                         | 3 tests                                                                       |
| Dashboard (app.slcor.com): sign-in/up, OTP verify, device approval, account, billing                                                                                                                                 | `apps/web`                                            | `next build` passes                                                           |
| Admin app (admin.slcor.com)                                                                                                                                                                                          | `apps/admin`                                          | `next build` passes                                                           |
| Observability: OpenTelemetry traces/metrics, Sentry with bodies and auth headers stripped                                                                                                                            | `apps/api/src/observability.ts`                       | no-op until configured                                                        |
| CI, Docker images, staging deploy after green CI, production deploy on tag with approval                                                                                                                             | `.github/workflows`, `apps/*/Dockerfile`, `infra/fly` | CI green on main                                                              |

Open-source monorepo branch `feat/djl-cloud-client` (worktree `.claude/worktrees/djl-cloud-client`):
provider id `djlCloud`, native driver streaming from the gateway (text prompts), cloud session in
the secrets dir, device-flow sign-in card in Settings → Accounts, strings in seven locales, every
exhaustive provider map extended. A cross-repo run proved: device code → approval → session →
top-up → model list → streamed reply settled for 2,758 microcredits → sign-out.

## Not done

- Desktop sync client loop (push new events / pull others' events / attachment upload) in `apps/server`.
- Cloud runner: `apps/server` cloud edition per org on Fly Machines (needs a Postgres persistence layer) and the hosted web chat that depends on it.
- iOS sign-in, device binding, and chat.
- Tool use through DJL Cloud from the desktop (needs an in-process agent loop or the cloud runner).
- Staging and production provisioning, DNS, secrets, Stripe products and price ids, real provider prices in the catalog (seed values are placeholders), external pentest.

## Prerequisites the owner must provide

Fly.io account and token; Supabase projects in the DJL organization (connector currently sees only
another organization); DJL Stripe account with three monthly and three annual prices plus a top-up price
(set `STRIPE_TOPUP_PRICE_ID` and the plan price ids in admin → Plans); Twilio Verify service;
Resend domain verification for `slcor.com`; OpenAI, Anthropic, OpenRouter keys (primary and
fallback); Google OAuth client and Apple Sign-In service id; Cloudflare DNS records per
`infra/cloudflare/dns.md`; Grafana Cloud OTLP endpoint; Sentry DSN; incident.io status page;
Terms, Privacy, and refund policy text; the first admin created with `bun run --cwd apps/api admin:create`.

## Local development

```sh
bun install && cp .env.example .env
docker compose up -d            # or a local Postgres on 54329 and Redis on 63799
bun run db:migrate && bash infra/scripts/apply-policies.sh && bun run db:seed
bun run --cwd apps/api dev      # API on 8787, external services mocked
bun run --cwd apps/web dev      # dashboard on 3000
bun run --cwd apps/admin dev    # admin on 3001
bun run test                    # every workspace
```

## 2026-09-13: admin team management and form validation

- Admin roles are now `admin` and `employee` (migration 0000 regenerated; nothing was shipped).
  Admin runs the platform and the team; employee is the support desk with the credit cap.
- Team page (`/team`): invite by email (single-use, hashed, 24h token; recipient verifies the
  email by opening it and sets a password meeting the 14-char policy), edit name/role, resend
  invite, sign out everywhere, disable/enable, soft delete. Last active admin and self-changes
  are refused. Role changes and disables revoke sessions.
- Every admin sign-in attempt is recorded in `admin_login_events` with outcome, IP, country
  header, user agent, timezone, locale, platform, screen and a browser device id. Viewable per
  member and across the team; any IP can be banned from there.
- `admin.ip_blocklist` is checked before the allowlist on every request; banning an IP also
  revokes sessions opened from it.
- Admin UI forms use custom inline validation (no native browser validation); Settings has a
  typed editor per key. Tests: `apps/api/src/admin/admin.e2e.test.ts` covers the whole flow.
