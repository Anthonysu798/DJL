# DJL Flutter: premium black and white redesign, group chat, speed, store readiness

## Context

The Flutter phone app (`apps/mobile`, about 63,000 lines) looks cheap because it has no design
system: colours, radii and spacing are hand-written across about 60 files, with stray blues and
purples, 14 coloured bubble swatches and three mixed icon sets. It is also built for developers
(inline reasoning, commands, Git screens), while the intended audience is non-technical.

The desktop gained Multi agents group chat today (PR #45). The phone cannot reach it: the
desktop's phone bridge hides group chats and exposes no group methods, and the desktop sends each
agent's reply only when finished, as one block.

Outcome wanted: a calm, premium, black and white app in the spirit of iOS 26 Liquid Glass that a
non-technical person can use; group chat on the phone with replies streaming word by word from
the desktop; noticeably lower latency and no jank; and both store builds ready to submit.

Decisions already made with the user:
- Replies stream word by word (desktop engine changes; shows on desktop and phone).
- Phone group scope: see groups, chat, @mention, stop, continue a paused round, create a group.
  Renaming, roles, models, folders, deleting stay on desktop.
- Agent reasoning, commands and file changes are hidden everywhere on the phone. Approval prompts
  and questions stay.
- Git, branches, worktrees, checkpoints and diffs are kept, restyled, behind one "More" entry.
- Work happens in this worktree, on branch `claude/djl-flutter-premium-group-chat-3cb4c4`.

## Design direction

Reading this as: a phone companion for non-technical people talking to AI agents, with a quiet
monochrome language, using native Liquid Glass only for floating chrome over flat content.

- **Colour:** black, white and zero-chroma grays only, light and dark following the system. The
  agent brand avatars are the only colour on screen (as in the reference). One semantic red for
  destructive and failed states. User bubble is ink on surface inverted (black bubble in light,
  white bubble in dark); agent replies are plain text on the page, no bubble.
- **Glass:** only on things that float over scrolling content: top bar, composer, tab switch,
  menus, sheets. Keep `DjlGlassSurface` (`lib/core/presentation/djl_glass.dart`, native
  `UIGlassEffect` on iOS 26, blur fallback elsewhere) as the single owner. Solid fallback when
  Reduce Transparency is on.
- **Type:** one family. System font on iOS (SF), Geist (already bundled) on Android. Scale ratio
  about 1.2. Remove the bubble colour setting; keep the font setting.
- **Shape and space:** one radius scale (10 / 16 / 24 / pill) and one spacing scale (4-based).
- **Motion:** 150 to 250 ms, ease-out, state changes only. Honour Reduce Motion.
- **Icons:** one family via `phosphor_flutter` (confirm Flutter 3.38 compatibility with `pub`
  first; fall back to `hugeicons`). Replace all 120 `Icons.` and 150 `CupertinoIcons.` uses and
  the generic custom SVGs. Agent avatars are new SVG assets ported from
  `apps/web/src/components/Icons.tsx`.

## Phase 0: written design (first commit)

- `docs/superpowers/specs/2026-11-19-flutter-premium-group-chat-design.md`: this plan as the
  design record (repo convention).
- `apps/mobile/PRODUCT.md`: register `product`, users, purpose, anti-references (rainbow accents,
  developer consoles, decorative glass), principles, accessibility target (WCAG AA).
- Update `apps/mobile/DESIGN.md` to the token system below.

## Phase 1: design system and sweep (`apps/mobile`)

New, small, single-purpose files under `lib/core/design/`:
- `djl_tokens.dart`: `DjlColors` (`ThemeExtension`: ink, inkMuted, inkFaint, surface,
  surfaceRaised, surfaceSunken, hairline, danger), `DjlSpace`, `DjlRadius`, `DjlMotion`.
- `djl_icons.dart`: semantic icon names (send, stop, attach, mic, back, more, group, ...) so the
  family is swapped in one place.
- `djl_components.dart`: the few shared pieces every screen repeats: primary / quiet button, list
  row, section header, empty state, status line, sheet scaffold, skeleton.

Then:
- Rebuild `lib/app/djl_theme.dart` on the tokens. Delete `cloudActionColor` blue and the other
  one-off colours in `lib/core/presentation/cloud_chrome.dart`.
- Sweep every file that uses `Color(0x…)` (44), `Colors.*` (155), `CupertinoColors.*` (84),
  inline `BorderRadius.circular`, `Icons.` and `CupertinoIcons.` onto tokens and `DjlIcons`.
  Mechanical, file by file, tests kept green as it goes.
- Hand-redesign the screens people actually live in: welcome and sign-in, My Macs home and
  pairing, the drawer, both chat screens and composers, settings, account.
- Remove `UserBubbleColor` swatches from `lib/features/settings/domain/appearance.dart`; stored
  values fall back to the default.
- Diff colours (added / removed) in `repository_diff_sheet.dart` become weight and a +/- gutter
  with gray tints, so the dev screens stay monochrome.

## Phase 2: simplify for non-technical users (`apps/mobile`)

- Paired-Mac chat (`lib/features/desktop/presentation/desktop_chat_page.dart` and the
  `projectDesktopTimeline` projection): drop reasoning, command, file-change, subagent and generic
  tool rows from the projected timeline. While a turn runs, show one status line ("Working").
  Keep approval requests, structured questions and plan questions, since the agent cannot
  continue without them.
- Cloud chat (`lib/features/chat/presentation/message_view.dart`, `chat_page.dart`): drop
  `tool_call` / `tool_result` tiles and the "Step N of M" row; same status line.
- Delete the widgets this leaves unused (`ThinkingTimelineRow`, `ActivityCard`,
  `CommandTimelineRow`, `SubagentActionCard`) and their tests. This is the largest deletion in
  the change.
- Move Git, branch, worktree, checkpoint, file and diff entry points out of the chat header and
  menus into a single "More" sheet.

## Phase 3: word-by-word replies (desktop: contracts, server, web)

Chosen approach: stream a live draft on the existing `groups.event` channel and leave the stored
transcript exactly as it is (final answer only). This avoids the ingestion hazards the group
driver documents (interleaved members, buffered delivery mode) and keeps the persisted history
unchanged.

- `packages/contracts/src/groups.ts`: add `GroupEvent` variant
  `{ type: "reply.draft", groupId, memberId, delta, restart }` (`restart` true when the agent
  begins a new message, so the draft is replaced). Add optional
  `live: { memberStates, drafts }` to the `snapshot` event and `GroupListResult`, so a client
  that joins or reconnects mid-round sees who is writing and what they have written so far.
- `apps/server/src/harnesses/native/group/childSession.ts`: `ask` takes an optional
  `onDraft(delta, restart)`; call it from the existing `assistant_text` branch of the sink.
- `groupRound.ts`: pass `onDraft` through to a new `runtime.publishDraft`.
- `apps/server/src/groups/Services/GroupDriverBridge.ts` and `Layers/GroupService.ts`: publish
  draft events on the existing PubSub; keep a small live map (state and draft per member),
  cleared when a member settles; include it in snapshot and list.
- `apps/web/src/multiAgents/groupStore.ts` and `GroupChatView.tsx`: the existing typing row shows
  the live draft text instead of "working…" once text exists (frame-batched store update).
- Tests: extend `childSession.test.ts`, `groupRound.test.ts`, `GroupService.test.ts`,
  `packages/contracts/src/groups.test.ts`, `groupStore.test.ts`.

## Phase 4: group methods on the phone bridge (`apps/remote-gateway`)

New module `src/electron-groups.js`, wired into `electron-app-server-adapter.js`:
- Subscribe to `groups.subscribe` through the existing `rpc.subscribe`
  (`electron-backend-rpc.js`). Forward events to the phone as `djl/groups/event`; forward drafts
  as `djl/groups/draft` so they can be merged.
- `outbound-coalescer.js`: extend `canMergeDeltas` to merge adjacent `djl/groups/draft` for the
  same group and member (not across a `restart`).
- New request methods in `dispatchAppServerRequest`: `djl/groups/list`, `djl/groups/create`,
  `djl/groups/send` (dispatches `thread.turn.start` with the group model selection, `steer` when
  a round is running, else `queue`), `djl/groups/stop` (`thread.turn.interrupt`),
  `djl/groups/stopMember`, `djl/groups/resolvePause`, `djl/groups/setSkipAllWarning`,
  `djl/groups/agents` (ready agent accounts for the create picker). Add the mutating ones to
  `MUTATION_METHODS`.
- `initialize` capabilities gain `djlGroups: true`, so the phone shows a clear "Update DJL on
  your Mac" state against older desktops.
- Transcript reuses what exists: `thread/read` on the group's thread (already unfiltered) and the
  existing per-thread event projection, whose item ids carry `gm.<memberId>.<replyId>`.
- The `thread/list` filter stays, so group threads do not appear as ordinary chats in this app or
  the native iOS app.
- Tests in `apps/remote-gateway/test/` for each method, the event forwarding and the merge rule.

## Phase 5: group chat in Flutter (`apps/mobile/lib/features/groups/`)

- `domain/group_models.dart`: Group, member, reply record, member state; `parseGroupMessageId`
  and mention parsing ported from `packages/shared/src/groupChat.ts`, with the same test cases.
- `data/group_repository.dart`: thin calls over the existing transport.
- `DesktopController` gets one narrow seam: a public `request` and a `groupEvents` stream that
  receives `djl/groups/*` and group-thread events before the generic handler, so the 7,600-line
  controller is otherwise untouched and group traffic never triggers its page-wide rebuild.
- `presentation/`:
  - `groups_page.dart`: list of groups with stacked agent avatars, last line, live "replying"
    hint. Empty state explains what a group is and offers "New group".
  - `group_chat_page.dart`: glass header (avatars, name, member count, "Stop" while running),
    message list, live draft bubbles per agent, Continue / Stop card when a round is paused.
  - `group_message_view.dart`: agent avatar and name above plain reply text; failed replies show
    a plain explanation; images open in the existing preview page.
  - `group_composer.dart`: glass composer; typing `@` opens a member sheet with "Everyone" first;
    small avatars show who will answer; confirm before @everyone in groups of four or more.
  - `group_create_sheet.dart`: name plus pick from the agents that are ready on the Mac.
  - `agent_avatar.dart` and `assets/agents/*.svg`.
- Streaming: each live draft is its own `ValueNotifier`; updates are applied once per frame, and
  only that bubble rebuilds. Draft text renders as plain text; markdown is parsed once when the
  final message lands.
- Entry point: a glass "Chats | Groups" switch at the top of the My Macs home.
- Not in this version: sending attachments to a group from the phone (the bridge sends none for
  ordinary chats either), role / model / folder editing, localisation.

## Phase 6: speed (`apps/mobile`)

- `lib/features/desktop/data/remote_transport.dart`: stop awaiting a Keychain write after every
  frame; save the resume cursor on a short trailing timer and on suspend / close.
- `desktop_controller.dart`: return early for notifications no handler matches (the 5-second
  presence heartbeat currently triggers a full rebuild, a timeline copy and a cache save).
- Coalesce streaming notifies to one per frame on both chat surfaces.
- `desktop_conversation_view.dart`: remove the second markdown parse and the per-build
  `TextPainter`; cache parsed markdown for settled messages; plain text while streaming.
- `desktop_chat_page.dart` and `chat_page.dart`: give the timeline its own listenable scope,
  memoise the timeline projection by a revision counter, and put `RepaintBoundary` around the
  composer and header.
- `cloud_models.dart`: replace the O(n²) `visibleBranch` and per-item sibling scans with a map.
- Measure before and after with a scripted stream in profile mode (frame build times, and
  emit-to-paint latency using the `djlEmittedAt` stamp the bridge already sends). Report the
  numbers; do not claim a gain that was not measured.

## Phase 7: store readiness

iOS (`apps/mobile/ios`):
- Add `PrivacyInfo.xcprivacy` to Runner and the widgets target (required-reason APIs and data
  types actually used).
- Add `ITSAppUsesNonExemptEncryption`, mirroring the value the native app declares in
  `apps/ios/BuildSupport/DJL-Info.plist`.
- Wire `Runner/RemotePush.entitlements` through `CODE_SIGN_ENTITLEMENTS` with a defined
  `DJL_APNS_ENVIRONMENT`, and set `DEVELOPMENT_TEAM` on the widgets target.
- Replace the placeholder launch image with a proper light / dark launch screen.

Android (`apps/mobile/android`):
- Release signing from a git-ignored `key.properties`; the release build fails clearly when it is
  missing instead of silently using the debug key. Remove the template TODOs.
- Adaptive icon (with a monochrome layer) and an Android 12 splash in black / white.

Both:
- "Report this answer" in the message menu for AI-generated content (Google Play requires in-app
  reporting). I will first check `cloud/` for an existing feedback endpoint and read
  `cloud/CLAUDE.md` before touching anything there; if a new endpoint is needed I will stop and
  confirm, since that is a backend change with its own deploy.
- `docs/mobile-store-submission.md`: review notes (reviewers cannot pair a Mac, so a demo account
  and a short pairing video are needed), privacy label and Data safety answers, screenshot list.

Needs you: the Android upload keystore, the version number to ship (currently `0.1.0+1`), and the
actual submission. I cannot guarantee approval.

## Verification

Static and unit:
- `apps/mobile`: `dart format --set-exit-if-changed .`, `flutter analyze`, `flutter test`.
- Repo: the existing typecheck, lint and test scripts for `packages/contracts`, `apps/server`,
  `apps/web`, `apps/remote-gateway`.

Deterministic end to end (no model accounts): extend the existing fixture
`integration_test/support/desktop_gateway.ts` with scripted group events, add
`integration_test/groups_test.dart`, and run it with `flutter drive` on the Android emulator
(`Pixel_9_Pro`, with `adb reverse`) and on an iOS simulator.

Live end to end, with the real desktop:
1. Local relay (`bun run --cwd apps/remote-relay dev`) and the desktop in dev mode with
   `DJL_REMOTE_RELAY_URL` pointed at it and an isolated home (`./.djl/electron-dev`), so your own
   paired phone and real chats are not disturbed.
2. On the desktop, create a group with Claude and Codex (both CLIs are installed here; Gemini is
   not). Drive the desktop window with computer use.
3. Android emulator first, then iOS simulator (the relay allows one phone at a time): pair by
   pasted code, open the group, send "@Everyone reply only: received" as in the reference, and
   confirm each reply streams word by word, Stop works, a new group can be created from the
   phone, and a reconnect mid-reply restores the live draft.
4. Screenshots of every redesigned screen in light and dark on both platforms, checked against
   the design direction, contrast (AA) and large text.

The live run uses a small amount of your Claude and Codex usage.

Reporting: results are stated from what was observed. Anything not run (for example a real
device, TestFlight, Play internal testing) is listed as not verified.
