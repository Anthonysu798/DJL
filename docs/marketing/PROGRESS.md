# Marketing Studio implementation ledger

Authority: user-approved production plan and attached full V1 brief (2026-10-22).
Worktree: marketing-studio; base: existing HEAD, unrelated primary-checkout edits excluded.

## Phases

1. Foundation and UI: in progress.
2. Image studio: pending.
3. Video studio: pending.
4. Generation: pending.
5. Publishing: pending.
6. Analytics and hardening: pending.

## Decisions

- All destinations receive the same assisted workflow before direct integration.
- Local campaign approval is explicit; user-confirmed publication never implies API verification.
- No originals upload automatically. Cloud scheduling must not be offered until finalized assets and durable cloud jobs exist.

## Verification

- Initial dependency installation requires sandbox escalation; retry underway.

## Implemented slice (2026-10-22)

- Local workspace, campaigns, brand profiles, imports, basic image edits/exports, basic video timeline/background exports, cloud copy-generation boundary, and assisted composer implemented.
- Full approved scope is NOT complete. See IMPLEMENTATION.md for the explicit missing-feature matrix; missing cloud implementation is not mislabeled as a credential blocker.
- Review found video approval invalidation, stale draft baselines, caption edits during saves, image navigation loss, and router navigation loss. Regression fixes added; draft and revision tests passed after failing before implementation.
- Browser smoke passed creation/media/copy/approval/reload with zero page errors. FFprobe validated a 1.5-second 720×1280 H.264/AAC export.
- Sharp aligned to existing 0.34.5, leaving only one lockfile dependency-entry change.
- Initial frontend suite: 2 failures (icon registry, sidebar localization), 2844 passing. Both defects fixed; targeted 25 tests passed.
- Initial server suite: 2648 passing, 11 skipped, 1 failure from the deliberately added RED video approval test while suite was running. That test now passes. Final full-suite reruns underway.

## Verified results

- Full frontend suite: 260 files, 2,849 tests passed.
- Full local-server suite: 272 files passed, 3 skipped; 2,649 tests passed, 11 skipped.
- Shared contracts: 24 files, 208 tests passed.
- Server and web TypeScript checks passed.
- `bun run build:desktop`: six successful build tasks. No release packaging, signing, notarization, upload, or production deploy performed.
- Scoped lint: zero errors; two minor warnings remain (index key on stateless timeline clip buttons; immutable record projection spread).
- Latest preview build passed after the section-scroll fix.
- Whole implementation remains incomplete against the original full V1 brief; no production-ready claim.
- Browser regression checks verified router discard blocking, concurrent-save rejection, and preservation of the unsaved draft with zero page errors.
- Screenshot review verified compact dark-theme layout and identified thumbnail overflow; campaign thumbnail containers now clip media to preserve title visibility.
- Preview screenshots use explicitly synthetic QA media and temporary campaign data.

## Chat-first correction (2026-10-22)

The user requested that marketing move into the normal chat, with novice-friendly clickable previews and agent-driven preparation. Implemented this on the same isolated branch; the standalone Marketing Studio navigation was removed.

- Conversation-scoped preparation/status tools, native Codex/Claude MCP wiring, DJL Cloud tool execution, context-preserving follow-ups, and inline review/edit/rewrite cards added.
- Real MCP integration test imports media, creates a scoped campaign, rejects unapproved exports, and verifies approved ZIP contents. No tool can approve or publish.
- Full server suite: 2,657 passed, 11 skipped. Full frontend suite: 2,849 passed. Contracts: 208 passed.
- Final focused marketing/cloud/routing suite: 52 passed after review fixes. Native driver/MCP focused suite: 21 passed.
- Browser card/transcript suite: 3 passed, including platform previews, inline edits, campaign-specific rewrite requests, transcript integration and review controls.
- Server/web type checks passed. Desktop build passed; final build log checked before commit.
- Preview screenshot is a browser-test fixture with synthetic content, not evidence of a live model invocation or social publication.
- Three review findings fixed: preserve earlier conversation facts, leave marketing mode for explicit unrelated routes, and identify the clicked campaign in rewrite requests.
- No paid model call, social publication, production deployment, or merge to the primary checkout occurred.
- Official API posting and the original unfinished advanced functionality remain unfinished; see CHAT-WORKFLOW.md.
