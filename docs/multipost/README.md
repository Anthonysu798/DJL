# DJL MultiPost

Current follow-up: [2026-11-12 TDD verification](acceptance-2026-11-12.md). Prior real-platform test: [2026-11-09 Instagram live acceptance](acceptance-2026-11-09.md). Earlier CI and native qualification: [2026-11-07 acceptance](acceptance-2026-11-07.md).

DJL embeds the Apache-2.0 public MultiPost Extension snapshot at `5522ca01100a58572de3a652aebd7851f5fa648a`. It does not include the proprietary upstream Agent or depend on the upstream hosted REST backend.

## Use

Open Social tools from an Agent chat. The workbench contains posts/articles/videos/podcasts, isolated account profiles, draft review, queue/calendar, workflow grants and existing brand/media tools. Local publishing does not require DJL Cloud sign-in. Each account gets its own persistent Chromium partition, separate from ordinary DJL browsing; each task gets a separate execution page.

In the composer select `/multipost-compose`, `/multipost-publish`, `/multipost-schedule`, `/multipost-status` or `/multipost-workflow` from the slash picker. The plugin library also shows the five canonical Skills and **DJL multipost mcp**. Native Codex, Claude, OpenCode and tool-capable DJL Cloud sessions receive a separate authenticated, session-scoped MCP endpoint. Runtime server keys use a per-chat suffix under `djl_multipost` to avoid shared OpenCode registry collisions.

Inspect real images/video frames before making visual claims. Use `djl_multipost_import_media` for authorized workspace files or this chat's `Attachments/` aliases and put the returned `Media/` references in drafts. Copy-only edits preserve media; intentional complete replacement is explicit. Root ownership is derived by DJL, never accepted from model arguments.

### Simple posting and Autopilot (2026-11-19)

The workbench opens on one card: pick accounts, write, add photos or a video, press **Post now** (or pick a time). That press is the approval. The server command `quick-post` chooses the format each platform accepts (a single video goes to a platform's video adapter when it has one), skips accounts that cannot take the content and says why. Articles, podcasts and per-platform overrides stay in the **Advanced editor**.

**Autopilot** is a per-account switch on the Accounts tab. While it is on, an agent may queue posts to that account without a per-post approval, up to a daily limit (default 5) and for 30 days. Only the user UI can switch it on (`set-autopilot` rejects the agent actor); the workbench switches it on when a new account's sign-in is first confirmed, and shows the switch on the account card. It turns off on sign-out or when a different identity signs in, and switching it off cancels unsent Autopilot jobs. Agents use one tool, `djl_multipost_post`: with Autopilot on for every target the post is queued, otherwise it is saved and the user presses **Post now** on the chat preview card. The older workflow and standing-grant forms were removed from the UI; existing grants still work and can be revoked on the Accounts tab.

These paths are covered by service, MCP and browser component tests with a mocked browser runtime. They have not been exercised against live Instagram or TikTok in this change.

Later the same day, ten changes for people who are not technical:

- A failed post is explained in plain words with one way forward (`problems.ts`); the raw reason sits under "Technical details".
- An Autopilot post nobody pressed a button for waits ten seconds; the chat shows "Posting to Instagram in 10… Don't post". A pressed Post button still goes out at once.
- A first sign-in names the account by its handle and clears unfinished sign-ins for that platform; `create-account` reuses an unfinished one; `remove-account` deletes an account for good. `check-accounts` renames accounts an older version numbered.
- After Instagram confirms a share the post is reported as live at once. The desktop then looks for its link the way a person would (`runtime.postLink`): it opens the person's own profile page, then the newest posts, and keeps the one published at that moment. It looks again for a day whenever Social opens; without a link "View it" opens the profile. Instagram's data endpoints are not used: they answered 404 in the signed-in window on 2026-11-20.
- A post that fails before anything was sent because the connection dropped is put back in line once, 30 seconds later, and the chat says "The connection dropped. Trying Instagram again in 30…". A second failure is reported as usual; a post that may already have been sent is never retried.
- When a sign-in check finds nobody, the desktop log says what the page showed (`[multipost-page] instagram not signed in: …`).
- The server tells the desktop when a post goes out, fails or needs the person (`runtime.notify`), and the desktop shows a system notification in the app's language.
- The composer shows how the post will look on each chosen platform and warns before a caption is too long or has too many hashtags (`postLook.ts`). Where a platform's own uploader would crop the picture (`MULTIPOST_CROP_RATIO` in the contracts; Instagram's web uploader defaults to a square), the preview lets the person drag the picture, or use the arrow keys, to choose what stays in view, and `quick-post` crops a copy of each photo around that point (`cropMedia` in `apps/server/src/multipost/media.ts`) and sends it through that target's `overrides.images`. Posts an agent or the Review dialog queues are cropped around the middle. The original file is kept; videos, animated GIFs, links and pictures the server cannot read go out uncropped. Other platforms are not cropped: the preview shows the shape their feed uses.
- `check-accounts` runs when the workspace opens (each account at most every six hours) and marks an account that was signed out, with a banner that leads to signing in again.
- The detailed tools on the One-click page are behind an "Advanced tools" switch that is off by default.
- The Activity calendar shows the week; a scheduled post moves by dragging it to another day or picking a new time (`reschedule-job`, user only).
- The One-click page asks for the business name and description once before the first post, and can add hashtags the person always uses.

In the chat a post reports itself in one line per account ("Your post is live on Instagram. View it"), for the newest post only; earlier ones are in Activity. "View it" opens the platform's own post link when one was returned, otherwise the signed-in profile. A saved preview card whose caption has already gone out is hidden, and its "Review post" window posts through the accounts signed in on this computer (`import-campaign` with `post: true`, UI only). No DJL Cloud sign-in is involved; Cloud history appears there only for previews that already have Cloud tasks.

User review approves the exact draft revision, targets and time. Optional standing grants are created only in the workbench and bind a workflow revision, accounts, content kinds, expiry, timezone and per-target daily limit. Edits invalidate review; workflow revisions invalidate their grants. The agent cannot approve itself or create grants. Identity changes or missing identity stop unattended posting. Platforms without an available identity resolver retain automatic preparation with manual final steps.

Close the main window to continue in the tray; explicit Quit stops the app. Local schedules are normalized to UTC with an IANA display timezone. Missed/offline/sleep tasks require review; they do not catch up in a burst. Native platform schedules use Unix milliseconds and remain distinct from local scheduling. Native acceptance does not prove publication; cancellation remains unconfirmed until the platform verifies it.

A returned script or opened page is not publication evidence. Jobs may be prepared, queued, missed, uncertain, platform-scheduled, delivered or published. A webhook acknowledgement without a public post URL is **delivered**. Uncertain irreversible submissions are never blindly retried. New browser adapters do not fabricate analytics.

## Compatibility

New drafts/tasks use MultiPost. Already-confirmed Cloud tasks keep their original executor and owner and remain inspectable/cancellable. Unconfirmed Cloud drafts must be imported and reviewed in MultiPost. Campaign import checks ownership and preserves original media selection and saved image corrections without copying OAuth credentials or prior consent. Existing Cloud review links, reports and tracking history retain their original behavior; these add-ons are not recreated for new local drafts.

## Code map

- `packages/multipost`: immutable upstream sources/provenance, reproducible gated browser scripts, canonical Skills and content normalization.
- `packages/contracts/src/multipost.ts`: public DTOs; `apps/server/src/multipost`: shared state/consent/queue, HTTP/MCP and media ownership.
- `apps/desktop/src/multipost`: isolated browser execution, private host and tray lifecycle.
- `apps/web/src/components/multipost`: focused composer, accounts, authorizations, review, calendar and chat cards.

## Verification boundaries

See [upstream parity](upstream-parity.md) and the acceptance record. Browser fixtures validate embedded code against controlled editor/UI responses, not current live platform certification. Some upstream modules are explicitly experimental. The November 6 acceptance was local-only. The November 7 follow-up adds Instagram and TikTok real-account qualification; see the current acceptance record for sign-in, exact-batch approval and observed publication status. Native Windows verification requires a Windows runner and is separate from macOS development checks. No deployment or release is part of this change.
