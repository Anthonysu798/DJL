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

`backup` remains a real operation (including when called by `deploy.sh`), not a dry
run. It records the initial API/worker/storage states, stops only services that were
running, and restores only that set even when stopping or dumping fails. Paused or
transitional service states are rejected. A failed service restart is an error too.
Partial backups remain in `backups/<UTC>.partial`; only a verified manifest permits
renaming to the completed directory. A `.partial` directory is never recovery input.

All other database and object writers must be quiesced for the complete backup
window. Deterministic, read-only database baselines before and after `pg_dump` must
match byte for byte; a mismatch refuses completion. These are separate transactions,
not an assertion of atomicity across the dump or proof that every external writer
was stopped. Keep direct database/object access quiesced too.

The private `manifest.json` records format/version, source image IDs, PostgreSQL 17,
the exact verifier SQL hash, and size/SHA-256 for `postgres.dump`, `files.tar.gz`, and
`recovery-baseline.jsonl`. The baseline contains sorted table/sequence counts and
hashes, plus zero-violation financial invariants, not row contents or credentials.
The archive verifier rejects unsafe paths, links, devices, extension records and
corruption; unsupported tar formats fail closed. SHA-256 checks integrity, not the
identity of an untrusted backup author. Restore only trusted backups.

Copy completed backups to separate encrypted off-host storage. Store private
configuration separately in encrypted custody; the backup excludes `.env`, Redis,
remote-relay state and local DJL/AI data. Preserve the original auth encryption secret
for an eventual full application recovery: changing it invalidates encrypted keys.
The database/files restore command does not load that secret or rewrite stored
ciphertext; application-key acceptance is a separate, explicit step.
Changing database passwords in `.env` does not rotate passwords in an existing
Postgres volume: perform explicit database role rotation and update clients together.

### Application rollback after the commerce staff migration

Migration `0019_commerce_staff` adds a dedicated `commerce` administrator category.
Preserve that category and the applied schema if a newer application fails; do not
turn commerce accounts into platform employees, remove the enum value, or rewrite
the migration journal. Pause new commerce writes and role grants before deciding
whether to roll back. Keep the normal backup/restore path separate.

Test the exact candidate API and Admin together against an isolated copy of the
migrated schema. A carried session and a fresh login for dedicated commerce staff
must not disclose platform data or authorize platform writes; also test that
legacy administrators and employees still have their expected access. Require
controlled denials and a usable interface, not just a responding health endpoint.
If the old stack does not meet those conditions, retain the role-aware stack and
fix forward. An error from a later deploy step does not prove the migration was
rolled back.

### Manual TEST statement comparison (read-only, not bank verification)

The admin commerce **TEST 流水比对** panel calls
`POST /admin/v1/commerce/reconciliation/compare` with `{csv:string}`. This tool
is available only in `local/test` with commerce `mode=test`, strict administrator
MFA policy enabled, verified MFA and `commerce.finance.read`. Disabling the MFA policy
disables this tool; it does not grant access without MFA. Cookie-only requests need
a trusted Origin and CSRF token; invalid Bearer authentication never falls back to
cookies.

The CSV must have exactly this six-column header, at most **1,000 data rows** and
**200,000 UTF-8 bytes**, positive safe-integer CAD cents, and valid UTC `Z` timestamps:

```text
type,businessId,externalId,amountCents,currency,occurredAt
```

`payment` compares an order UUID and exact `pi_*`; `refund` compares an order UUID
and exact `re_*`, counting the external refund parent once, not its allocation
children. `commission_payout` compares a withdrawal UUID and exact recorded
reference for a confirmed `paid_test` record. `supplier_payout` compares only a
supplier TEST document's `document.id` and exact reference, never operation or
supplier IDs. References are nonunique; sharing is an unverified review hint,
not proof of duplicate bank payments. `supplier_payable` accruals are **not payments**.

Each row reports `matched`, `manual_record_fields_match`, `not_found`,
`identifier_mismatch`, `amount_mismatch`, `duplicate`, `ambiguous`, `unresolved`,
`inconsistent` or `unsupported`. Only confirmed, ledger-consistent financial records
receive `matched`. Supplier document field agreement remains an unverified
exception, with `ledgerEntryIds=[]`, not a financial match. Unresolved financial
amounts/differences are `null`, never an invented zero. A failed read does not
produce a zero-exception report. The response fixes
`source=unverified_manual_test_statement`, `fileCompleteness=not_assessed`,
`bankBalance=not_assessed` and `supplierSettlement=unsupported`.

An uploaded manual file has **unverified provenance**. A match does not establish
bank verification, file completeness, a balanced bank account or permission to pay.
The server uses a read-only database snapshot, makes no provider requests and writes
no business/ledger/comparison records. The UI keeps the CSV/results only in memory,
not in files or database storage, and rejects stale account/file responses. There
is no payout command. Real bank/channel feeds, fees and supplier settlement remain
unimplemented and require separately approved business details.

#### Supplier TEST document registration (not settlement)

New registration defaults off: only local/test commerce with explicit
`DJL_COMMERCE_SUPPLIER_PAYMENT_RECORDS_ENABLED=true`, verified admin MFA and
`commerce.finance.write` can register. Authorized history GET/list/by-operation needs
`commerce.finance.read`; cookie Origin/CSRF protections remain. Documents do not transfer funds,
confirm bank receipt or payment eligibility, or reduce supplier payables, cash,
customer wallets or AI credits. No supplier-payment policy is implied.

Use `/admin/v1/commerce/suppliers/:id/payment-records` for POST/list and
`.../by-operation/:operationId` for lookup. Keep the original operation ID and full
canonical payload (supplier, amount, currency, reference, evidence and reason).
After an unknown POST,
GET that supplier/operation and compare all fields; 404 is not bank-payment failure.
Never switch IDs to guess a retry. Refresh loses page-memory retry credentials;
another identity cannot reuse that intent. A confirmed POST followed by failed
readback permits queries only. With registration off, authorized history and exact
canonical replay remain available; valid new operations return 503, conflicting
canonical payloads 409.

Phase 5 is **not only waiting for credentials**. Production payment/refund adapters
and enablement, real tax/shipping and refund allocation, recipient verification/
manual payout registration with unknown-outcome checks, bank/channel discrepancy
handling and matching actual supplier payments still require implementation and
acceptance. Existing TEST records/comparisons do not provide that production loop.

### Optional, default-off commerce incident email

The independent worker job `commerce.alerts.email` has its own durable delivery
records; `commerce.alerts.scan` still only maintains incidents and audit history.
`DJL_COMMERCE_ALERT_EMAIL_ENABLED=false` is the default. Opt-in delivery requires a
single dedicated `DJL_COMMERCE_ALERT_EMAIL_TO`; the real adapter also needs dedicated
`DJL_COMMERCE_ALERT_EMAIL_FROM` and `DJL_COMMERCE_ALERT_EMAIL_RESEND_API_KEY`. It does
not reuse the AI notification recipients. Do not fill these with real details until
the operator approves them: the user currently reports the business/payment and
formal notification arrangements as **undetermined**, and real image materials as
**not prepared**.

In `local/test` with external mocks enabled, delivery uses an in-memory mock sender
and sends no real email. The six persisted states are `pending`, `submitting`,
`accepted`, `simulated`, `needs_review` and `skipped_resolved`. `accepted` means only
provider acceptance, **not receipt or delivery**; `simulated` is not a send. Unknown
outcomes require manual review and are never automatically resent. The API exposes
read-only configuration/history status, not recipient text or a resend operation.

When enabled and configured, an unconfirmed claim older than two minutes needs
manual inspection. Disabled or unavailable configuration performs no dispatch DB
work, so it does **not** reap or rewrite stale `submitting` records or resend them.
Do not interpret an old submitting label as an ongoing network request. Actual
Resend delivery, recipient confirmation and escalation have not been exercised.
The new nonempty synthetic rehearsal observed the original `*/5` pg-boss job
complete at **21:45:24 UTC**, with **one simulated receipt and two state audits**.
The restricted LOGIN passed 13 table-permission checks and 8 actual denials;
68 business/AI table fingerprints matched before, after and after stop. Only the
owned worker was stopped, with exit **143**, not a graceful-shutdown proof; the
original API was not migrated or restarted. See the
[bounded cron chain](../../../.tmp/commerce-email-worker-cron-20261026-455b5666/chain-verification-result.json)
and [independent read-only review](../../../.djl/commerce-validation/email-worker-cron-independent-review-455b5666.json).
This is real scheduling with a mock sender, not real mail or receipt acceptance.
The final observed fetch counter is not an after-exit lifetime total or all-socket
isolation proof. Heartbeat timestamp provenance and the separate metadata
supplement's limits remain in the reports; process observations are not continuous
API health proof.

### Current extension evidence and historical recovery boundary

The journal now has **15 migrations**, including new
`0013_commerce_alert_email.sql` and `0014_commerce_alert_email_reason.sql`; old
migrations were not rewritten. Fresh real-PostgreSQL migration tests passed
[12 checks in 3 files](../../../.tmp/commerce-validation/extension-db-all-tests.log),
including four historical-upgrade categories. New bounded evidence includes
[45 reconciliation checks](../../../.tmp/commerce-reconciliation-20261026/verification-result.json),
[27 mail service checks](../../../.tmp/commerce-validation/alert-email-source-verification.json)
(17 PostgreSQL, 10 unit), and
[77 admin tests in 5 files](../../../.tmp/commerce-validation/extension-admin-all-tests.log).
Integration checks comprise
[18 real-PostgreSQL checks](../../../.tmp/commerce-validation/email-root-postgres-integration.log)
(3 recovery SQL and 15 existing Alerts),
[15 offline checks](../../../.tmp/commerce-validation/email-root-integration-unit.log),
and [5 recovery static guards](../../../.tmp/commerce-validation/email-infra-recovery-green.log).
These scopes overlap and must not be added together. The updated recovery SQL tests
are not a new full backup/restore or cutover rehearsal.

All earlier auth/storage/CLI recovery reports below remain historical evidence
from **before migrations 0013/0014**. They were not rewritten or rerun against this
latest source. The existing loopback synthetic API (PID 13780, port 18787) has not
been migrated or restarted for these extensions; it serves the old checkpoint, not
proof of the new reconciliation route or email status projection. Cloud web/admin
Next previews remain off; no GUI or real provider was started for those checks.
The new [9-task Cloud typecheck](../../../.tmp/commerce-validation/extension-cloud-typecheck.log)
passed with zero cache hits, as did the
[final API typecheck](../../../.tmp/commerce-validation/extension-final-api-typecheck.log).
The pre-connection-fix AI [desktop](../../../.tmp/commerce-validation/extension-final-ai-desktop-typecheck.log)
and [web](../../../.tmp/commerce-validation/extension-final-ai-web-typecheck.log)
consumers' `tsc --noEmit` also exited 0, not GUI or real-model acceptance.
Both new Next production builds exited 0:
[web](../../../.tmp/commerce-validation/extension-web-build.log) and
[admin](../../../.tmp/commerce-validation/extension-admin-build.log); generated
`next-env.d.ts` path changes were restored. Builds are not GUI acceptance.

The first extension [full Cloud run](../../../.tmp/commerce-validation/extension-full-cloud-test.log)
retains **1,036 passed / 2 failed**: an old HTTP expectation for the new alert DTO,
and the unchanged AI Usage mixed-clock assertion (about 180 ms backwards). Only
the HTTP expectation was aligned with the full mail summary and
`emailDelivery:null`, then its [13 targeted tests](../../../.tmp/commerce-validation/extension-commerce-http-contract-green.log)
passed. The subsequent correct-test-version
[final full run](../../../.tmp/commerce-validation/extension-final-cloud-test.log)
exited 0: **8 test packages, 108 files, 1,038 passed, 0 failed, 0 skipped**.
All 9 tasks succeeded; the sole cache hit was contracts build, while all 8 test
tasks were force-executed. AI behavior, clocks and the Usage assertion were not
changed. This single closing run does not prove that the mixed-clock issue was
fixed or erase either the prior 931/1 or this first extension 1,036/2 result.

The latest formal [Cloud CI](../../../.tmp/commerce-validation/extension-formal-cloud-ci.log)
still exits 1 at formatting: **384 problems among 491 files**. Full
[Cloud lint](../../../.tmp/commerce-validation/extension-full-cloud-lint.log)
checked **449 files, 4 warnings, 0 errors** (3 existing warnings and one new bounded
DTO-copy allocation warning). The earlier 385-file format RED is retained as
history. Passing tests/builds do not make all CI or release gates green.

A later user-started native observation is separate from those Cloud checks.
The user manually launched Electron PID 29920 and its backend PID 38584. The first
startup shell failed with `SocketOpenError: timeout waiting for "open"`; Ctrl+R in
that same window then rendered the AI thread/sidebar/composer behind first-user
prompts. The user's report that prompts were closed was not independently checked:
physical Esc stopped that Computer Use observation. That historical run did not
establish shop-entry, separate native window or draft-preservation acceptance;
the later renewed-authorization check is recorded separately below. See the
[bounded native observation](../../../.djl/commerce-validation/native-user-launch-startup-20261026.json).

The subsequent minimal `wsTransport.ts` change retains AI business/interfaces and
only fixes connection preparation: session open waits for the read-only snapshot
handshake paired to the current runtime/generation, not merely socket open.
Its 23 targeted tests and 50 related tests in 5 files passed (overlapping scopes).
The initial AI web typecheck exited 2 on `TS2322` in the new test's generic
`runPromise` mock; that RED remains preserved. Only the mock was corrected, then
the 23 targeted tests passed again and both the
[final typecheck](../../../.tmp/commerce-validation/native-startup-handshake-final-typecheck.log)
and [build](../../../.tmp/commerce-validation/native-startup-handshake-final-build.log)
exited 0. Vite transformed 8,743 modules and built in 1m32s, with existing chunk-size
and plugin-performance warnings, not zero warnings. Complete repaired native
cold-start acceptance is still outstanding; the existing-window checks below are
not a cold restart. These results neither replace the
historical 1,038 Cloud tests nor make the 384-problem formal CI gate green.

After the user explicitly renewed Computer Use authorization, the existing
user-started Electron passed bounded native window checks: AI window 4458558 kept
its thread route and synthetic unsent draft while independent shop 7999444 showed
product images/details. Repeating the entry reused that same shop and detail view;
closing it left AI editable, and reopening created shop 7604316 alongside AI with
the draft preserved. See the
[native window/draft acceptance](../../../.djl/commerce-validation/native-shop-window-draft-acceptance-20261026.json).
Both windows were left for the user, with only the unsent synthetic draft; no AI
message/model call, cart mutation, payment or withdrawal occurred. No app was
launched/restarted and AI was not closed in that earlier observation; only-shop
recovery and menu routing were not tested at that point.
This does not complete all of Phase 1, Phase 2 or the six-phase product plan.

The later Windows continuation verified native menu isolation and restoring AI
while only Shop remained. It also reproduced and repaired an initial menu command
lost before React subscribed: the actual preload now buffers only the three global
shell actions until their respective first owner mounts. One Help menu selection
then restored AI and opened its shortcuts dialog; subsequent shop reuse, close,
AI draft editing and shop reopen preserved the draft. See the
[menu lifecycle acceptance](../../../.djl/commerce-validation/native-shop-menu-lifecycle-acceptance-20261027.json).
The 11 preload regressions and 28 related tests passed, as did desktop/web types
and builds (existing build warnings remain). No new app process, login, update,
model request or real funds were invoked. Windows menu recovery does not prove
taskbar/macOS activation, full cold start, physical devices or production readiness.

The two endpoints now have a bounded
[real-auth chain](../../../.tmp/commerce-endpoint-auth-e2e-20261026-862173c0/chain-verification-result.json)
and [independent review](../../../.djl/commerce-validation/commerce-endpoint-auth-independent-review-862173c0.json):
26 real HTTP requests, 64 checks and 28 later read-only conditions. Original
`startApi` password/encrypted TOTP, unenrolled-session refusal, Cookie/Bearer/CSRF
and the MFAfalse pre-auth 503 were exercised; that last branch is not an
authenticated-request claim. Complete 66 non-Auth/70 source table fingerprints and
14 POST snapshots match, allowing normal auth appends only. Three auxiliary RED
layers remain: JSON double-encoding/CIM timeout, v1 empty-object observation and
v2 wrong check count. Both new APIs are stopped; unpersisted close outcomes do not
prove graceful shutdown. Redis records one remaining key without a type claim or
flush. Original PID13780 was not migrated and still serves the old checkpoint.
This is not bank, real mail, GUI or production acceptance.

The latest 15-migration schema now has a bounded synthetic TEST
[original CLI restore/no-resend chain](../../../.tmp/commerce-email-recovery-service-continuation-20261026-5127b125/chain-verification-result.json).
Original backup, same-bundle dry run and execute all exited 0; the dry run created
zero target resources. All 74 table/sequence baseline entries matched. Source and
target each passed 13 ACL checks and 4 actual denials. Two restored enabled-mock
replays made zero sender calls and retained `needs_review`; real `P0001` terminal
reversion and `23505` duplicate guards rejected the probes, with explicit rollback
and an unchanged full baseline. Source PG/S3 are running again; the target has no
host ports.

Both earlier helper RED layers remain. `clean` was used only to prepare a new empty
owned source, not in the original target restore; no target filtering or temporary
grants were added. The new-source maintenance owner's already-applied migration
no-op is not production migration-role acceptance or an owner runtime fallback.
The current service was read-only-mounted into a dependency image, not a rebuilt
full API image; only the pinned optional `supports-color@7.2.0` and `has-flag@4.0.0`
peers were approved exceptions, not full-install-tree identity. This source has
zero file refs, not the older two-object fixture. No application key was activated,
API/worker/frontend started or real mail sent. The
[independent read-only review](../../../.djl/commerce-validation/email-recovery-independent-review-5127b125.json)
accepted this bounded synthetic evidence, not production recovery. Real image materials, business/payment/
notification arrangements, bank/channel verification, real anomaly load/manual
escalation/recipient confirmation, production cutover and final unified GUI
acceptance remain outstanding. These are not reasons to stop other safe local QA.

### Isolated recovery tooling (not yet a verified production recovery)

Use Linux with a local Docker Unix-socket context and preloaded images. The offline
tests do not exercise recovery against a real Docker daemon. Separate local component
checks on 2026-10-26 used real PostgreSQL 17.11, `pg_dump`/`pg_restore` into a new
database, the fixed SQL fingerprints and inherited role permissions, and signed
HEAD/GET plus SHA-256 checks of two synthetic S3 objects. A subsequent component
check copied those objects to a new container and volume on an internal network,
read them using a separate read-only identity, rejected a missing reference and a
wrong expected hash, and observed an actual 403 for a read-only PUT. The target
was reached only on container loopback; it did not publish a usable host port.
These are application-level object copies, not raw-volume archive restoration,
execution of this Linux recovery script, a physical disaster-recovery drill, or
production cutover. Successful planning, a database fingerprint match, or tar
extraction alone is **not** Phase 6 disaster-recovery acceptance. See
`docs/commerce-development.md` for the current evidence boundaries.

The unchanged infrastructure unit suite was also exercised in an isolated Linux
container with Node 24.13.1 and Vitest 4.1.0: all 21 assertions passed, including
the POSIX file-mode assertions that fail on Windows. Its shell orchestration tests
use their checked-in synthetic Docker executable, not a real backup or restore.
The container had no network, host bind mounts, private configuration or Docker
socket; this does not satisfy the real-host prerequisites below or make the full
Cloud CI formatting gate green.

A later synthetic storage-only component rehearsal cold-stopped only its owned
source S3, archived the raw `/data` volume, and restored that source's initial
running state. The checked archive was extracted into a new `nocopy` volume; a
new isolated S3 then returned both restored database references with matching
lengths and SHA-256 through a separate read-only IAM identity. Missing objects,
wrong hashes and read-only PUT were rejected. An earlier image-populated target
failed its empty-volume guard and was retained; the successful retry reused the
same archive and never stopped the source again. This is not execution of the
complete Linux recovery script, cross-system atomic backup, separate-cluster
failover, encryption-key recovery or production cutover.

A separate subsequent logical-database rehearsal restored the original synthetic
dump into a new PostgreSQL 17.11 container, volume and internal network. Different
`system_identifier` values confirmed distinct clusters. All 82 baseline records
(11,992 bytes) and both file references matched byte-for-byte; the original ACLs
passed 12 protected-table checks per NOLOGIN business role without grant repairs,
and all 58 prohibited mutation probes returned `42501`. The target's actual TCP
SCRAM checks accepted its private password and rejected an incorrect one. No host
port, migrations, seed, application, worker or external provider was enabled.
This is independent-cluster **logical** restore evidence, not application LOGIN
acceptance, physical/WAL recovery, the complete Linux script, key recovery or
production cutover. The local report is
`.tmp/commerce-integration/recovery-independent-pg-20261026/verification-result.json`.

The original `recovery.sh restore` path was subsequently exercised on the existing
Ubuntu WSL2 distribution, as UID 1000 in an ext4 workspace with the real local
Docker Unix-socket context. No host guard, Docker context or privilege was changed.
A fresh synthetic dump/archive/baseline bundle was captured in one maintenance
window with no other database clients; only the owned synthetic S3 was briefly
stopped and restored by cleanup before target execution. The original default
dry run exited 0 and created no target containers, volumes or networks. The
unchanged script's `--execute` then exited 0 after creating a new isolated target,
restoring PostgreSQL and the raw file volume, and comparing the fixed baseline.
No stage was manually substituted and no grants were repaired.

Postchecks passed the two NOLOGIN roles' 24 protected-table checks, 58 actual
`42501` denials, both restored references' HEAD lengths and GET content hashes,
missing-object 404 and read-only PUT 403. The original
services were running afterward; the new target had no host ports. All four
recovery source hashes and eight public log hashes were independently checked.
See `.tmp/commerce-integration/linux-original-restore-20261026/verification-result.json`.
This accepts that **synthetic original restore path on WSL Ubuntu**, not execution
of the original backup command, application LOGIN/key recovery, physical/WAL
backup, production RPO/RTO or production cutover. No GUI or frontend was started
through WSL.

An independent review also withdrew an unsupported wrong-hash claim in the
initial postcheck report: that run only compared the known expected value with
zeros, rather than injecting an incorrect expectation. Original evidence was
hash-archived and `evidence-correction.json` marks that original check as not
exercised. A separately named read-only supplement performed two real GETs through
the original validator: the normal expected hash passed and an explicit all-zero
expectation was rejected. Its separate
`wrong-expected-hash-supplement-591572e8.json` does not retroactively change the
original run or imply another restore execution.

A later rehearsal used the original deployment Compose file in a new synthetic
project, running only PostgreSQL and S3. Both original `djl.sh backup` and the
original restore subcommand really exited 0 on the same completed backup bundle;
the dry run created no target resources and execution restored a new isolated
target with identical baseline and role checks. Only that new source's S3 was
cold-stopped and restored. Existing services were not stopped. This does not
exercise quiescence or restart of a running application/worker.

Two initial harness failures remain recorded, not relabeled green: a post-backup
check wrongly expected the intentionally removed temporary `baseline-before.jsonl`,
and an early post-restore HEAD succeeded while the first GET returned 500 before
volume registration. A separately authorized mature read-only probe on the same
unchanged running target then passed both objects' actual GET hashes, an explicit
wrong-hash rejection, missing 404 and read-only PUT 403 with no created object.
**A successful HEAD is not content readiness; verify real GETs before cutover.**
See `.tmp/commerce-integration/linux-original-backup-restore-continuation-20261026/chain-verification-result.json`
for the original command results, preserved failures and separate supplement.
No production RPO/RTO, application LOGIN/key recovery or production cutover is
claimed.

A subsequent authentication-specific rehearsal used three existing synthetic
password accounts, one TOTP-enabled test administrator and the original live JWK.
Its source had **zero file/attachment references**; the earlier independent
two-object storage fixture was not substituted. Before backup, the new source
clone received the unchanged `policies.sql` then `runtime-grants.sql` through normal
bootstrap. The original auth database/API were not stopped or changed; its MVCC
dump plus identical pre/post fingerprints is not an all-writers-quiescence claim.
The original `djl.sh backup` and same-bundle restore dry run/`--execute` exited 0.
The dry run created zero target resources. The restored API used only a new LOGIN
inheriting `djl_api`, without target grant repairs or an owner-API fallback.

With the original test app key supplied from separate private escrow, the unchanged
Dockerfile's `USER bun`/`NODE_ENV=production` image passed **53 real HTTP requests
and 270 checks**: original password sessions, independent buyer cookies, original
admin TOTP, same-kid JWK signature verification and source-derived business reads.
A separate wrong-key instance passed **5 HTTP requests and 26 negative checks**,
using its own newly issued cookie for the private-key signing failures; the
original admin could not establish a successful MFA session. This is not a claim
that public JWKS or all valid Bearer requests must fail with a wrong app key.
All 73-table comparisons retained historical rows, password/JWKS/TOTP ciphertext
and business/financial state, allowing only documented normal authentication writes.

Three initial RED layers remain: an ignored harness's invalid target name, an old
image's public-copy permissions unreadable by `USER bun`, and an unpublished host
port. Separate continuations retained the original guards/source/key/privileges;
the successful HTTP clients shared the exact API containers' internal network
namespaces, not Windows host or browser access. Only the two exact owned
correct/wrong-key API containers were stopped after verification; data volumes and
evidence remain, and no recovered API is advertised as running. See the local
[final chain report](../../../.tmp/auth-recovery-internal-client-20261026/chain-verification-result-stopped.json)
and [independent read-only review](../../../.djl/commerce-validation/auth-restored-app-chain-readonly-review.json).

This accepts bounded **synthetic internal-network auth/key recovery**, not
production recovery, off-host key retrieval, RPO/RTO, GUI acceptance or cutover.
Historical Redis revocations were not restored: fresh Redis and a changed target
issuer do not prove same-issuer revoked-token safety. That pre-extension checkpoint
ended with **931 passed / 1 failed** in the unchanged AI usage clock test and a
formal Cloud CI **385-file formatting RED**. The new full test run passed as scoped
above, while current formal CI still stops on 384 formatting problems; this
historical drill does not alter either old result or prove the AI clock fixed.

```sh
# Parent directory must already exist. Both target and project must be NEW.
./cloud/infra/vps/djl.sh restore /secure/backup/20261026T120000Z \
  --target /srv/rehearsals/djl-restore-20261026-a --project djl-restore-20261026-a

# Only after reviewing the plan and obtaining a backup maintenance/rehearsal window:
./cloud/infra/vps/djl.sh restore /secure/backup/20261026T120000Z \
  --target /srv/rehearsals/djl-restore-20261026-a --project djl-restore-20261026-a \
  --execute
```

The default is a dry run: it uses a stateless, read-only, `--network none` Bun helper
container to verify the manifest/archive and print a plan. It is **not zero Docker**,
but creates no target, database, volume or network. Images must already be cached;
there are no implicit pulls. It does not load `.env` or invoke the production Compose
file, setup, seed, migration, API, worker, relay, model, notification or payment flows.

`--execute` refuses existing targets/projects/volumes/networks, copies the verified
backup into a private new target, creates run-labelled new volumes and an internal
network, and verifies ownership before restoring. No ports are published. The separate
`recovery.compose.yml` starts only PostgreSQL and a one-off, network-disabled tar
extractor. Fresh isolated database credentials are generated. Application database
roles are created `NOLOGIN`; `pg_restore --no-owner` restores object ACLs without
importing global role passwords. ACL restoration errors fail the rehearsal.

Source `imageId` values are **local Docker content IDs**, not pullable registry
digests. Both the exact PostgreSQL and SeaweedFS images and
`oven/bun:1.3.13-slim` must be available. On another machine, obtain the matching images
through a trusted registry or protected `docker save`/`docker load` archive first.
Missing IDs fail under `--pull never`; never substitute the latest mutable tag.
Use the matching recovery source/SQL bundle: SQL-hash mismatch fails closed.

The script imports the custom-format database, extracts the raw file volume, reruns
the read-only verifier and compares the exact baseline. Its invariants check internal
ledger/credit/withdrawal/refund consistency; it does not contact payment providers,
settle funds, release holds, declare real bank receipt, or consume restored jobs.
Unknown payments/refunds and pending withdrawals remain exactly as recorded.

Required **separate real rehearsal steps**, before calling recovery accepted:

1. Prove successful real `pg_dump`/`pg_restore`, stop/failure/restart behavior, target
   collision rejection and repeatability using another new target. Record RPO/RTO
   from actual observations, not estimates. Failures retain the target and partial
   evidence; no source or failed target is automatically cleaned or reused.
2. Verify restored effective runtime grants and append-only protections using the
   reviewed permission checker/SQL, with applications still off. `NOLOGIN` rehearsal
   roles and owner differences are intentional; matching data hashes do not prove ACLs.
3. In that isolated network only, start the exact SeaweedFS version against the new
   labelled file volume with a **new local-only storage identity**, no host ports and
   no source `.env`. Use an internal read-only S3 client to HEAD/GET completed,
   non-deleted database file keys and compare stored size/SHA-256 where present.
   Keep the private inventory/report in the rehearsal directory, not logs or chat.
   Tar integrity/extraction is not a substitute for this object readback. No API,
   worker, public endpoint or real provider credentials are needed for this step.
4. Separately reconcile any post-backup external payments/refunds before an eventual
   authorized production cutover. Offline accounting consistency cannot confirm what
   happened at a provider after the backup. Do not reopen checkout or jobs merely
   because a rehearsal starts.

Review `recovery-owner.json` and Docker `djl.recovery.run-id` labels when inspecting
the retained resources. Cleanup requires explicit operator review of those exact new
resources; never run a generic volume prune or production `down --volumes`.

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
