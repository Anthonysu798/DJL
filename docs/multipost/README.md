# DJL MultiPost

Current follow-up: [2026-11-12 TDD verification](acceptance-2026-11-12.md). Prior real-platform test: [2026-11-09 Instagram live acceptance](acceptance-2026-11-09.md). Earlier CI and native qualification: [2026-11-07 acceptance](acceptance-2026-11-07.md).

DJL embeds the Apache-2.0 public MultiPost Extension snapshot at `5522ca01100a58572de3a652aebd7851f5fa648a`. It does not include the proprietary upstream Agent or depend on the upstream hosted REST backend.

## Use

Open Social tools from an Agent chat. The workbench contains posts/articles/videos/podcasts, isolated account profiles, draft review, queue/calendar, workflow grants and existing brand/media tools. Local publishing does not require DJL Cloud sign-in. Each account gets its own persistent Chromium partition, separate from ordinary DJL browsing; each task gets a separate execution page.

In the composer select `/multipost-compose`, `/multipost-publish`, `/multipost-schedule`, `/multipost-status` or `/multipost-workflow` from the slash picker. The plugin library also shows the five canonical Skills and **DJL multipost mcp**. Native Codex, Claude, OpenCode and tool-capable DJL Cloud sessions receive a separate authenticated, session-scoped MCP endpoint. Runtime server keys use a per-chat suffix under `djl_multipost` to avoid shared OpenCode registry collisions.

Inspect real images/video frames before making visual claims. Use `djl_multipost_import_media` for authorized workspace files or this chat's `Attachments/` aliases and put the returned `Media/` references in drafts. Copy-only edits preserve media; intentional complete replacement is explicit. Root ownership is derived by DJL, never accepted from model arguments.

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
