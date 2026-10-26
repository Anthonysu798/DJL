# Social publishing operator setup and verification

The social integration is disabled until `SOCIAL_PUBLISHING_ENABLED=true`. A disabled or unconfigured provider is shown as unavailable in chat; it never pretends to connect or publish. End users authorize accounts in their browser and review drafts in Agent Chat. They do not supply application keys.

## Server configuration

Configure both API and worker with the same database, private storage, provider credentials and encryption key:

- `SOCIAL_TOKEN_ENCRYPTION_KEY`: 32 random bytes encoded as 64 hexadecimal characters. Store as an operator-managed secret; keep stable across restarts. Losing it requires reconnecting accounts. Do not reuse the DJL session signing key.
- `SOCIAL_INSTAGRAM_CLIENT_ID`: Instagram app ID, not the parent Meta app ID.
- `SOCIAL_INSTAGRAM_CLIENT_SECRET`: Instagram app secret, stored only on servers.
- `SOCIAL_INSTAGRAM_GRAPH_VERSION`: explicit tested Graph version, such as the version selected in the developer application. No inferred version default.
- `SOCIAL_TIKTOK_CLIENT_KEY` and `SOCIAL_TIKTOK_CLIENT_SECRET`: the selected TikTok application/environment credentials.
- `API_PUBLIC_URL`: the externally reachable HTTPS API origin.
- `WEB_PUBLIC_URL`: the HTTPS cloud web origin that serves `/social/connect` and DJL sign-in. The API redirects OAuth callbacks here; use the matching staging or production web app.
- `SOCIAL_PUBLISHING_ENABLED=true` only after credentials, migrations, storage, and both processes are configured.

Apply the repository's cloud migrations before enabling. Keep the API and worker running; the pg-boss `social.sweep` schedule and persistent target rows make scheduled execution independent of desktop uptime. Use `bun run cloud:ci` before deployment. Staging normally deploys after successful **Cloud CI** on `main`, with an exact-commit CI check and staging SSH secrets configured; manual workflow dispatch still enforces the exact-commit check. Production uses a `cloud-v*` tag whose commit is on `main` and has successful Cloud CI, followed by the GitHub `production` environment approval. Plain `v*` tags release the desktop app and must not be used for the backend.

## Official application setup

Meta app observed on 2026-10-25: **DJL**, parent ID `2402271110578506`, Instagram application ID `2303735800381314`. The following permissions were added and the dashboard displayed **Ready for testing**, which is not App Review approval:

- `instagram_business_basic`
- `instagram_business_content_publish`
- `instagram_business_manage_insights`

The staging callback **`https://api-staging.slcor.com/v1/social/oauth/instagram/callback`** has now been saved in the Meta configuration. Operator credentials have been prepared with root-only access on the server, but the integration has not been enabled and live OAuth remains untested. This does not establish a working callback deployment or a connected Instagram account. Add the chosen professional Instagram account as an eligible test account. Production requires its own exact deployed callback under the production `API_PUBLIC_URL`.

The callback first validates the expiring state and stages the provider code in an encrypted server-side envelope. It redirects to `WEB_PUBLIC_URL/social/connect` with an opaque continuation handle; provider codes and tokens are not forwarded to the browser page. If the browser is signed out, the cloud web page asks for DJL sign-in and preserves the continuation destination. Once signed in, the page automatically calls the authenticated continuation endpoint. The signed-in user must be the original initiating DJL user and must still belong to the original organization. The browser's currently active organization does not need to match: the server resolves the original organization from the persisted attempt. A different user or removed membership cannot complete the connection. Repeated continuation requests return the recorded state without exchanging the code again. Authorization saves no publish consent.

TikTok application observed on 2026-10-25: **DJL**, ID `7700634695348324372`, organization `7700696639010341908`. Login Kit, Content Posting API Direct Post, and `video.list` were selected in the form, but **Save failed validation** because required review materials were missing. These selections must not be reported as saved or approved. Required items include icon, category, Terms and Privacy URLs, platform configuration, use explanation, and a genuine end-to-end demonstration video. Media pull URLs also need the platform's domain verification. Callback: `API_PUBLIC_URL/v1/social/oauth/tiktok/callback`.

TikTok sandbox **DJL integration test**, ID `7700761055420483636`, has now been created. Its current **unsaved form** contains Login Kit, Content Posting API Direct Post, `video.list`, and the cloud callback configuration. The app icon upload succeeded. **Apply changes** is currently blocked by the required Terms of Service and Privacy Policy URLs; the form selections are not saved configuration. The live `https://slcor.com/privacy` URL was checked and returned **404**, so it must not be presented as a published policy. A local terms draft is also not approved. No sandbox credential has been captured, and no real TikTok OAuth flow has completed.

The TikTok portal kept its organization dialog open after successful creation; a retry created a second unused DJL organization `7700697910459089940`. It was not deleted. Use the first organization above for this app.

RED's official sharing portal displayed **暂停接入** (onboarding paused). Keep it unavailable for direct publishing and retain the clearly labelled manual package fallback. Do not substitute unofficial login/session interception.

## Existing VPS overrides

`deploy.sh` accepts only `/srv/djl-cloud-staging` or `/srv/djl-cloud-production`, uploads tracked source files, then runs `djl.sh check`, `backup`, `up`, and `verify` before checking the deployed version. Use the clean, CI-verified commit: a local dirty checkout would archive modified tracked files and omit untracked new source.

Before deployment, inventory any host-only Compose overrides and preserve the private `.env`, `.secrets`, backups, and volumes. Archive extraction leaves untracked host files present, but `djl.sh` currently invokes Compose with explicit `--env-file .env -f compose.yml`; it does **not** automatically apply an existing override file. `COMPOSE_FILE` alone does not fix this explicit-file invocation. If the running stack depends on an override, ensure the reviewed deployment path includes it consistently for configuration checks, builds, backup stop/start, migrations, rollout, and verification before using `deploy.sh`. Do not silently replace the running stack with base-only configuration.

## Verification boundaries

Automated tests use disposable local data and fixture provider responses. They cover credential encryption, OAuth owner/replay/expiry checks, draft revisions, confirmation races, independent targets, interrupted/uncertain writes, media ownership, browser controls, and local chat continuation. They are not evidence of live OAuth, platform approval, successful external publication, or official analytics access.

Initial implementation supports one media file per publishing draft and at most one TikTok target per draft. MP4 validation checks bounded container metadata; it is not full video decoding. Existing cloud upload size limits remain in force. TikTok privacy/interactions and commercial/music disclosures require explicit human choices. Scheduled snapshots are separate from current local campaign edits; use **Edit content or time**, then confirm the revised snapshot.

Local Agent Chat continuation persists its waiting context and uses stable orchestration receipts after OAuth. Cloud-native Agent tools can read status and prepare unconfirmed Instagram drafts, but the cloud-native conversation UI and automatic resume path are not completed by the local chat reactor. Do not enable these tools for cloud-native customers until that review flow is connected.

Before release, exercise the real browser-to-callback flow, production secret injection, worker restart with the client closed, signed-media retrieval by both providers, and real platform results/metrics. A real public posting test requires explicit approval of the account and content. Never invent a successful post or replace unavailable metrics with zero.
