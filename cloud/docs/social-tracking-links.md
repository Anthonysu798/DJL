# Campaign tracking links

The owner creates a tracking redirect explicitly in Agent Chat after the destination's UTM
parameters have been prepared. Creating one requires disclosure that DJL records aggregate
link-open counts. The link captures the campaign, chat and content revision; its HTTPS target is
immutable. Editing a caption or creating another link does not change an existing destination.

## Owner API

- `POST /v1/social/tracking-links` accepts `{ url, campaignId, threadId, contentRevision,
expiresInDays: 7 | 30 | 90, disclosureAccepted: true }` and returns `{ link, publicPath }`.
- `GET /v1/social/tracking-links?campaignId=…&threadId=…` lists only the caller's links.
- `GET /v1/social/tracking-links/:id` returns owned metadata and UTC-day aggregates.
- `DELETE /v1/social/tracking-links/:id` revokes further redirects.

All owner reads, creation and revocation use both the authenticated organization and user.
Matching campaign IDs do not grant access across owners. Creation is limited to 20 attempts per
hour per organization/user by the existing limiter. The local bridge validates the saved campaign
and session, then resolves `/l/:slug` against the configured cloud web origin for copying.
The random slug identifies a public redirect, never an account session.

## Public redirect and counting

`GET /l/:slug` proxies one manual, uncached API request to
`GET /v1/social/tracking-links/:slug/open`, which returns a 302 redirect to the saved target.
The proxy never fetches the target or forwards cookies, account authorization, user agent, or
visitor identity. Destination query parameters supplied on the public URL cannot override the
saved URL. HEAD and explicit prefetch/prerender/preview hints preserve the redirect without
incrementing the counter. Expired or revoked links return 404.

Only UTC-day counts are persisted. There are no visitor event rows, IPs, user agents,
fingerprints, attribution identities, or conversion records. Counts are labelled **link opens**
and may include unlabelled previews and bots. They do not establish human website visits, leads,
purchases, or revenue. A normal counted GET adds exactly one open; separate GET requests can add
additional opens even when they come from the same person.

Anonymous abuse uses the existing ephemeral limiter at 120 requests per minute per slug and
hashed API-visible IP. The web proxy's backend IP can be shared by many visitors, so busy links
can hit that cap and be undercounted or temporarily return 429. The API does not persist the
rate-limit identity alongside link counters. This implementation intentionally does not claim
unique visitors or precise attribution.

Both redirect responses disable caching, indexing and referrer transmission. Targets must use a
public HTTPS hostname with the standard port. Credentials, IP literals, local hostnames, control
characters, common secret query keys and recognizable credential formats are refused. This is a
URL validation policy, not a promise to detect every secret or harmful destination; no destination
is fetched or DNS-resolved by DJL during creation or redirection.

Migration: `0013_social_tracking_links.sql`. Verification uses synthetic links and an isolated
local database; production publication and real customer links are unnecessary.
