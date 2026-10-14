# DJL iPhone product verification — 2026-10-12

Implemented in the existing isolated `codex/cloud-staging-readiness` worktree. Changes are committed locally; no new PR, push, merge, or production release was requested.

## Verified

- Native cloud/auth/chat/contract/voice/image/notification suite: **76 passed, 0 failed**. Result: `test_sim_2026-10-12T06-56-52-019Z_pid8930_15350a2d.xcresult`.
- Full local iPhone UI flow: **1 passed, 0 failed**. Covers password sign-in, streamed chat, keyboard-visible navigation, draft persistence across Settings, voice preference, Images, Notifications, and sign-out. Result: `test_sim_2026-10-12T06-53-50-885Z_pid8930_f99abb24.xcresult`.
- The local echo provider proves integration, **not** genuine cloud inference or paid image generation. Only a disposable local account received test credits; no payment was made.
- `bun run cloud:ci` passed, including nine typechecks, all package tests, formatting/lint, and VPS infrastructure checks. Password recovery was also verified through the real local auth API with one-time code reuse rejected.
- Staging was backed up and updated. All seven services are healthy; API/worker native database authentication, append-only protections, Redis, private storage, and queue checks pass.
- Computer use verified real staging chat/task replies, inbox ownership/read behavior and routing, draft retention, Cloud/Remote navigation, theme changes, and read-aloud controls. Simulator dictation displays a truthful unavailable state.

## Bugs fixed

- Delayed JWT exchanges could survive invalidation and authenticate a new account with an old token.
- Failed-send identity was lost when its chat view was recreated. Original request contents and IDs now persist with the scoped draft; image retries follow the same rule.
- Image lease database errors acknowledged unfinished jobs instead of allowing safe recovery.
- Notification polling discarded previously loaded older pages.
- Audio route loss did not release capture or stop speech.
- Keyboard insets were applied twice in the drawer and pushed navigation offscreen.
- OpenRouter image generation used the wrong endpoint. It now uses the [dedicated Image API](https://openrouter.ai/docs/guides/overview/multimodal/image-generation), retains MIME type, validates raster bytes, and keeps unavailable models disabled.

## External acceptance still pending

- OpenRouter balance is **US$0**. The existing key retains its **US$1 total cap**. Paid image generation, genuine-output save/share, and live settlement remain unproven; image creation stays unavailable on staging.
- Physical iPhone speech recognition and peak-memory measurements were not performed. Simulator and injected-boundary tests are distinct from device acceptance.
- APNs and Apple OAuth credentials are absent; those features remain gated. In-app task alerts/inbox work independently.
- This desktop dev build has no public relay URL. Fresh-device manual remote pairing was not completed in this acceptance run. Existing pairing data was preserved.
- Production/App Store activation, policy publication, and production provider funding are outside this staging implementation.

## Rulings carried from execution

- Ruling: preserve existing shared worktree and unstaged cloud changes; defer mixed-file commits until hunks are separable — prevents committing unrelated baseline; cost if wrong: integration commit boundaries may be broader.
- Task 2: Ruling: new test files require explicit Xcode target membership; a zero-test run is not a pass — registered the new test before retrying. Cost if wrong: target membership changes could affect discovery; verify actual test counts.
- Ruling: record the already-authorized native VPS changes as a separate prerequisite snapshot, reconstructed from the private baseline patch, before committing the mobile capability endpoint — keeps prior work distinct; cost if wrong: baseline staging errors could require commit correction.
- Ruling: draft/cache scope uses user plus active org rather than personal org — prevents team-context leakage; cost if wrong: changing org changes the new-chat draft namespace.
- Ruling: keep form transitions in SwiftUI and share pure validation/cooldown rules — avoids a second state owner; cost if wrong: transition behavior requires UI acceptance checks.
- Ruling: add Images/Notifications destinations only when their functional views are ready — avoids exposing inert controls during intermediate builds; cost if wrong: destination enum grows in later deliveries.
- Ruling: signup OTP is server-generated and should not be sent again by the client — confirmed by server config and regression; cost if wrong: a server with different auth configuration would need capability/version alignment.
- Ruling: notification service coverage consolidated in real-HTTP tests rather than duplicate unit wrappers — exercises actual auth, CSRF, DB, and service paths; cost if wrong: isolates logic less than separate unit fixtures.
- Task 6: Ruling: clean up capture on background, not transient inactive state — system permission prompts make the app inactive and must not cancel first-use preparation; cost if wrong: an inactive foreground overlay may leave recording running until background/interruption or the 60-second limit.
- Task 7–8: Ruling: commit provider validation and deterministic storage/task wiring together — shared generated-image storage now consumes the added message reference column; cost if wrong: provider and image-task rollback must happen together.
- Task 8: Ruling: retry-safe job identity lives in pg-boss singleton keys; queued request retries may enqueue again — recovers a lost queue acknowledgement without duplicating a job; cost if wrong: extra producer calls on network retry.
- Final: Ruling: real image/save/share acceptance remains pending — provider balance is $0; cost if wrong: paid output delivery could reveal a provider/runtime defect not covered by deterministic HTTP/ledger tests.
- Final: Ruling: physical-device speech recognition and peak-memory measurements remain pending — Simulator has no supported on-device language model; cost if wrong: real-device audio or memory behavior could differ.
- Final: Ruling: APNs and Apple OAuth remain gated until configured — no credentials available in this authorized staging setup; cost if wrong: users cannot enable those optional transports/sign-in methods yet.
- Final: Ruling: ongoing UI QA/deployment is validated separately from immutable reviewed code — final test/report files were excluded from the review snapshot; cost if wrong: UI-test/report defects may escape independent review.
- Final: Ruling: this delivery is staging, not production/App Store activation — production release and credentials/policies were not authorized as part of this implementation; cost if wrong: additional release prerequisites remain.
- Task 10: Ruling: direct Xcode CLI used once as a diagnostic fallback after repeated tool-driven UI failures — confirmed the same underlying system-dialog blocker; cost if wrong: CLI verification has different tooling orchestration than XcodeBuildMCP.
- Task 10: Ruling: successful form dismissal does not cancel the accepted sign-in's refresh — cancellation still applies before authentication succeeds; cost if wrong: an accepted login's remaining refresh continues until completion or session invalidation.
- Task 10: Ruling: render the drawer menu only when revealed — prevents hidden glass nodes from remaining in the accessibility tree; cost if wrong: first-open rendering and search state reset on close.
- Task 10: Ruling: remote manual pairing acceptance pending for this dev build — its public relay URL is unconfigured; cost if wrong: a fresh phone cannot pair until a reachable relay is supplied. No saved pairing was reset.

## Deferred minor

- The pre-existing Remote first-visit “What's New 1.5” notice remains; it was dismissed during QA.
