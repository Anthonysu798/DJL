# DJL Download, Install, and Traffic Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend PR #15 with production D1 tracking for anonymous landing visits, GitHub/OSS download redirects, and unique desktop installs, plus a sanitized public download-summary endpoint.

**Architecture:** The deployed `djl-stats` Cloudflare Worker remains the only analytics backend. The landing site reports visits through a same-origin cookie-setting route and reports resolved download redirects server-side; packaged desktop builds report one persisted install UUID. The bearer-protected endpoint exposes full summaries, while `/v1/public-stats` exposes only aggregate download totals.

**Tech Stack:** TypeScript, Cloudflare Workers, D1/SQLite migrations, Wrangler 4, Next.js 16 App Router, React 19, Electron, Vitest, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-03-download-install-traffic-tracking-design.md`

## Global Constraints

- Preserve PR #15's explicit GitHub and China download buttons and immutable OSS URLs.
- Analytics failures must never block page rendering, download redirects, or Electron startup.
- Store no IP address, name, email, user agent, referrer, query string, hostname, project data, or application content.
- Use an HttpOnly first-party random UUID cookie for estimated unique browsers.
- Keep raw rows, country/path detail, visit metrics, and install metrics private.
- Expose only aggregate download totals by source, platform, and day through `/v1/public-stats`.
- Do not merge PR #15 or create a release tag in this task.
- Do not modify the already-applied `0001_init.sql`; add `0002_visits.sql`.

---

### Task 1: Restore and extend the Cloudflare stats Worker

**Files:**
- Create: `apps/stats-worker/package.json`
- Create: `apps/stats-worker/tsconfig.json`
- Create: `apps/stats-worker/wrangler.jsonc`
- Create: `apps/stats-worker/migrations/0001_init.sql`
- Create: `apps/stats-worker/migrations/0002_visits.sql`
- Create: `apps/stats-worker/src/ingest.ts`
- Create: `apps/stats-worker/src/ingest.test.ts`
- Create: `apps/stats-worker/src/summary.ts`
- Create: `apps/stats-worker/src/summary.test.ts`
- Create: `apps/stats-worker/src/index.ts`
- Create: `apps/stats-worker/src/index.test.ts`
- Create: `apps/stats-worker/README.md`
- Modify: `bun.lock`

**Interfaces:**
- Produces: `POST /v1/visits`, `POST /v1/downloads`, `POST /v1/installs`, `GET /v1/stats`, and `GET /v1/public-stats`.
- Produces: `parseVisitEvent(value): VisitEvent | null`, preserving existing download/install parsers.
- Produces: full `StatsSummary` and sanitized `PublicStatsSummary` response types.

- [ ] **Step 1: Restore the existing tested Worker foundation**

Cherry-pick the Worker commit and deployed D1 binding commit without committing conflicts:

```bash
git cherry-pick ccec773f0
git cherry-pick f13a403df
```

Confirm `wrangler.jsonc` binds database `9470b59e-c69e-4f9c-8a84-47b0c6ace02a` and no secret value is present.

- [ ] **Step 2: Write failing visit-ingest tests**

Add cases to `ingest.test.ts` asserting that this payload succeeds:

```ts
{
  visitorId: "f4d1b4dc-3ff4-4fcf-89b8-658884d0be87",
  path: "/guide",
  country: "ca",
}
```

and normalizes to uppercase country. Add separate rejection cases for invalid UUIDs, relative paths,
URLs, query strings, fragments, paths longer than 256 characters, and unexpected shapes.

- [ ] **Step 3: Run the ingest test and confirm RED**

```bash
bun run --cwd apps/stats-worker test -- src/ingest.test.ts
```

Expected failure: `parseVisitEvent` is not exported.

- [ ] **Step 4: Implement visit validation and migration**

Add:

```ts
export interface VisitEvent {
  readonly visitorId: string;
  readonly path: string;
  readonly country: string | null;
}

export function parseVisitEvent(value: unknown): VisitEvent | null;
```

UUIDs are normalized to lowercase. Paths must begin with `/`, contain neither `?` nor `#`, and be
at most 256 characters. Add `0002_visits.sql` exactly as specified in the design.

- [ ] **Step 5: Run the ingest test and confirm GREEN**

```bash
bun run --cwd apps/stats-worker test -- src/ingest.test.ts
```

- [ ] **Step 6: Write failing summary tests**

Add fixtures and assertions for:

```ts
visits: {
  pageViews: 4,
  uniqueVisitors: 2,
  byCountry: { CA: 3, US: 1 },
  byPath: { "/": 2, "/guide": 2 },
  byDay: expect.any(Array),
}
```

Add a public-summary assertion proving it contains only `downloads.total`, `bySource`,
`byPlatform`, and `byDay` and omits countries, visits, and installs.

- [ ] **Step 7: Run summary tests and confirm RED**

```bash
bun run --cwd apps/stats-worker test -- src/summary.test.ts
```

Expected failure: visit rows and `buildPublicSummary` are not supported.

- [ ] **Step 8: Implement private and public summary shaping**

Extend `SummaryRows` and `StatsSummary` with visits. Add:

```ts
export interface PublicStatsSummary {
  readonly downloads: Pick<StatsSummary["downloads"], "total" | "bySource" | "byPlatform" | "byDay">;
}

export function buildPublicSummary(summary: StatsSummary): PublicStatsSummary;
```

- [ ] **Step 9: Run summary tests and confirm GREEN**

```bash
bun run --cwd apps/stats-worker test -- src/summary.test.ts
```

- [ ] **Step 10: Write failing Worker router tests**

Add tests proving `/v1/visits` inserts the normalized event, invalid visits return 400,
`/v1/public-stats` needs no bearer token, the public JSON omits private dimensions, the private
summary includes visits, and public responses use `cache-control: public, max-age=60` while private
responses stay `no-store`.

- [ ] **Step 11: Run router tests and confirm RED**

```bash
bun run --cwd apps/stats-worker test -- src/index.test.ts
```

- [ ] **Step 12: Implement Worker routing and queries**

Add `recordVisit`, batch queries for visit page views, distinct visitors, country, path, and day,
and the public endpoint. Keep the D1 binding in-process and await every D1 promise.

- [ ] **Step 13: Verify the complete Worker package**

```bash
bun run --cwd apps/stats-worker test
bun run --cwd apps/stats-worker typecheck
bun run --cwd apps/stats-worker build
```

- [ ] **Step 14: Commit the Worker deliverable**

```bash
git add apps/stats-worker bun.lock
git commit -m "feat(stats-worker): track visits and publish download aggregates"
```

---

### Task 2: Add landing download reporting without changing destinations

**Files:**
- Create: `apps/landing/app/lib/downloadStats.ts`
- Create: `apps/landing/app/lib/downloadStats.test.ts`
- Modify: `apps/landing/app/lib/downloadRegion.ts`
- Modify: `apps/landing/app/lib/downloadRegion.test.ts`
- Modify: `apps/landing/app/lib/resolveDesktopDownload.ts`
- Modify: `apps/landing/app/lib/resolveDesktopDownload.test.ts`
- Modify: `apps/landing/app/download/windows/route.ts`
- Modify: `apps/landing/app/download/windows/route.test.ts`
- Modify: `apps/landing/app/download/mac/[arch]/route.ts`
- Modify: `apps/landing/app/download/mac/[arch]/route.test.ts`

**Interfaces:**
- Produces: `DesktopDownloadDecision { destination, report }` from `resolveDesktopDownload`.
- Produces: `reportDownload(report, options): Promise<void>` and `scheduleAfterResponse(task): void`.

- [ ] **Step 1: Write failing helper and resolver tests**

Assert that the default stats URL is `https://djl-stats.slcor.workers.dev`, unsafe overrides fall
back to the default, Worker failures resolve without throwing, and GitHub/OSS decisions return the
same destinations as PR #15 plus the correct `{ source, platform, arch, country, version }` report.

- [ ] **Step 2: Run focused tests and confirm RED**

```bash
bunx vitest run --root apps/landing app/lib/downloadStats.test.ts app/lib/resolveDesktopDownload.test.ts
```

- [ ] **Step 3: Implement the reporting helper and decision result**

Restore the known-good helper from commit `04648b10b`, adapt the resolver to PR #15's explicit
`?mirror=cn` behavior, and add `readVisitorCountry(request)` using `x-vercel-ip-country`.

- [ ] **Step 4: Run focused tests and confirm GREEN**

```bash
bunx vitest run --root apps/landing app/lib/downloadStats.test.ts app/lib/resolveDesktopDownload.test.ts
```

- [ ] **Step 5: Write failing route tests**

Assert that Windows and architecture-specific macOS routes schedule the exact report and preserve
their 307 destination. Assert that invalid macOS architecture still redirects to checksums without
reporting an installer download.

- [ ] **Step 6: Run route tests and confirm RED**

```bash
bunx vitest run --root apps/landing app/download/windows/route.test.ts 'app/download/mac/[arch]/route.test.ts'
```

- [ ] **Step 7: Implement route scheduling**

Call `scheduleAfterResponse(() => reportDownload(decision.report))` immediately before returning
the existing redirect from each counted route.

- [ ] **Step 8: Verify and commit landing download tracking**

```bash
bunx vitest run --root apps/landing
bunx tsc --noEmit -p apps/landing/tsconfig.json
git add apps/landing/app
git commit -m "feat(landing): track GitHub and OSS download redirects"
```

---

### Task 3: Add anonymous landing visit tracking

**Files:**
- Create: `apps/landing/app/lib/visitTracking.ts`
- Create: `apps/landing/app/lib/visitTracking.test.ts`
- Create: `apps/landing/app/api/visits/route.ts`
- Create: `apps/landing/app/api/visits/route.test.ts`
- Create: `apps/landing/app/VisitReporter.tsx`
- Modify: `apps/landing/app/layout.tsx`

**Interfaces:**
- Produces: `normalizeVisitorId`, `normalizeVisitPath`, `resolveVisitorIdentity`, and
  `reportVisitToWorker` pure helpers.
- Produces: same-origin `POST /api/visits` and a route-aware `VisitReporter` client component.

- [ ] **Step 1: Write failing pure-helper tests**

Cover valid UUID reuse, invalid/missing UUID replacement through injected `randomUUID`, path
normalization, country normalization, default Worker URL, a five-second-or-shorter timeout, and
swallowed Worker failures.

- [ ] **Step 2: Run helper tests and confirm RED**

```bash
bunx vitest run --root apps/landing app/lib/visitTracking.test.ts
```

- [ ] **Step 3: Implement pure visit helpers**

Use `crypto.randomUUID()` only through a defaulted dependency. Do not read IP, user agent,
referrer, query, or hash data.

- [ ] **Step 4: Run helper tests and confirm GREEN**

```bash
bunx vitest run --root apps/landing app/lib/visitTracking.test.ts
```

- [ ] **Step 5: Write failing API route tests**

Test a missing cookie (new UUID and secure cookie), a valid cookie (reused without `Set-Cookie`),
invalid path (400), and Worker failure (still 204). Inject request-facing dependencies through a
small exported handler so tests do not mock Next internals.

- [ ] **Step 6: Run route tests and confirm RED**

```bash
bunx vitest run --root apps/landing app/api/visits/route.test.ts
```

- [ ] **Step 7: Implement the API route and client reporter**

Mount `<VisitReporter />` once in `layout.tsx`. On each `usePathname()` change, call same-origin
`fetch('/api/visits', { method: 'POST', headers: { 'content-type': 'application/json' }, body:
JSON.stringify({ path: pathname }), keepalive: true })` and discard failures.

- [ ] **Step 8: Verify and commit visit tracking**

```bash
bunx vitest run --root apps/landing
bunx tsc --noEmit -p apps/landing/tsconfig.json
git add apps/landing/app
git commit -m "feat(landing): count anonymous visits"
```

---

### Task 4: Restore one-time desktop install tracking

**Files:**
- Create: `apps/desktop/src/installPing.ts`
- Create: `apps/desktop/src/installPing.test.ts`
- Create: `scripts/lib/desktop-stats-url.ts`
- Create: `scripts/lib/desktop-stats-url.test.ts`
- Modify: `apps/desktop/src/main.ts`
- Modify: `scripts/build-desktop-artifact.ts`
- Modify: `.github/workflows/desktop-release.yml`
- Modify: `README.md`
- Modify: `package.json`

**Interfaces:**
- Produces: `reportInstallOnce(deps): Promise<'reported' | 'already-reported' | 'deferred'>`.
- Produces: validated `extraMetadata.djlStatsUrl` in packaged artifacts.

- [ ] **Step 1: Cherry-pick the previously tested desktop commit**

```bash
git cherry-pick 2feb1839e
```

Resolve conflicts only where current release/update code has moved; preserve all newer PR/base
behavior and the exact `DJL_STATS_URL` build metadata flow.

- [ ] **Step 2: Run focused desktop and build-script tests**

```bash
bunx vitest run apps/desktop/src/installPing.test.ts scripts/lib/desktop-stats-url.test.ts
```

- [ ] **Step 3: Run desktop typecheck and release dry-run build validation**

```bash
bun run --cwd apps/desktop typecheck
bunx vitest run scripts/build-desktop-artifact-mac-config.test.ts scripts/public-desktop-release.test.ts
```

- [ ] **Step 4: Commit conflict resolutions if cherry-pick did not create the final commit**

```bash
git add .github/workflows/desktop-release.yml README.md apps/desktop package.json scripts
git commit -m "feat(desktop): report each fresh install once"
```

---

### Task 5: Deploy safely, verify production, and update PR #15

**Files:**
- Modify: `apps/stats-worker/README.md`
- Modify: `docs/superpowers/specs/2026-09-03-download-install-traffic-tracking-design.md`
- Create: `docs/superpowers/plans/2026-09-03-download-install-traffic-tracking.md`

**Interfaces:**
- Consumes: all tests and artifacts from Tasks 1-4.
- Produces: deployed backward-compatible Worker/D1 schema and an updated PR #15 branch/body.

- [ ] **Step 1: Run the repository verification gate**

```bash
bun run --cwd apps/stats-worker test
bun run --cwd apps/stats-worker typecheck
bun run --cwd apps/stats-worker build
bunx vitest run --root apps/landing
bunx tsc --noEmit -p apps/landing/tsconfig.json
bun run --cwd apps/landing lint
bun run --cwd apps/landing build
bunx vitest run apps/desktop/src/installPing.test.ts scripts/lib/desktop-stats-url.test.ts
bun run --cwd apps/desktop typecheck
bun run check:public-source
git diff --check origin/main...HEAD
```

- [ ] **Step 2: Apply the D1 migration and deploy the Worker**

```bash
bunx --cwd apps/stats-worker wrangler d1 migrations apply djl-stats --remote
bun run --cwd apps/stats-worker deploy
```

Read the migration result and deployment version; do not infer success from command start.

- [ ] **Step 3: Verify live endpoints and synthetic data**

Use UUIDs and a path prefixed with `/__verification__/pr-15-` for exact cleanup. Post one visit,
one GitHub download, one OSS download, and one install. Query those exact values from D1, verify the
private and public response shapes, then delete only rows matching the synthetic UUID/path/version
markers and confirm zero matching rows remain.

- [ ] **Step 4: Push the PR branch**

```bash
git push origin codex/landing-oss-downloads
```

- [ ] **Step 5: Update PR #15 metadata**

Change the title/body to cover OSS routing plus private visit/install analytics and public download
aggregates. Include exact test counts, build results, deployed Worker version, D1 migration status,
and the distinction between clicks, unique browser cookies, and unique install IDs.

- [ ] **Step 6: Verify the pushed PR**

Read PR #15 back from GitHub, confirm the head SHA equals local `HEAD`, and inspect required checks.
Report red or pending checks as pending; do not merge, tag, or release.

