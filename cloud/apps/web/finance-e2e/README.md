# Opt-in finance browser regression

This local regression exercises the compiled Admin UI, real Bun API, PostgreSQL and Redis.
It uses synthetic accounts, mandatory TOTP and **simulated** money. It is not part of default
Cloud CI and must not point at production, a forwarded server or an existing developer database.

1. Prepare disposable, authenticated PostgreSQL and Redis instances on loopback. They must have
   no other clients or test data. Set `DATABASE_URL` to the PostgreSQL `/postgres` maintenance database
   and `REDIS_URL` to Redis database `/0`; include the ports. Set `DJL_FINANCE_E2E_PG_DATA` and
   `DJL_FINANCE_E2E_REDIS_DIR` to the instances' absolute, dedicated data directories. The fixture
   checks both server-reported directories and creates/drops only its own named PostgreSQL database.
2. In a separate build checkout, build the Admin app with `NEXT_PUBLIC_API_URL=http://localhost:48787`
   **at build time**. Assemble its Next standalone output with `.next/static` (and `public`, if
   present) beside the generated app's `server.js` in the standard standalone layout. Run that
   server locally with `HOSTNAME=127.0.0.1`, `PORT=48731` and `NEXT_TELEMETRY_DISABLED=1`. Verify that
   this is the newly built instance; don't reuse a process already listening on either test port.
3. With the repository-pinned Node and Bun available on `PATH`, and the repository's existing
   Playwright Chromium installed, run from the repo root with `DJL_FINANCE_E2E=1`:

   ```sh
   node cloud/apps/web/finance-e2e/run.mjs
   ```

   On an offline machine, `DJL_FINANCE_E2E_CHROMIUM` may point to an existing compatible Chromium
   executable. The runner does not install browsers or dependencies.

The runner owns the API, browser scenario and temporary credentials, not the compiled Admin,
PostgreSQL or Redis processes. Stop your dedicated instances after the runner exits. A passing
exit requires the browser scenario **and** the database accounting check and cleanup. This is not
bank reconciliation, an actual payment, buyer-website acceptance or production rollout approval.
