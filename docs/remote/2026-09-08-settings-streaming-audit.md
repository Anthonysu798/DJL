# Remote settings and streaming audit — 2026-09-08

Remote access is restored in desktop Settings, with a phone shortcut beside the tutorial in both the main and Settings sidebar. Clicking it opens `/settings?section=remote`. Settings search and the Settings tour also expose the existing section.

The setup panel uses the existing DJL visual system and a three-step guide: keep the computer awake with DJL running, pair in DJL on iPhone, then open desktop threads and follow replies. The QR card shows the computer, one-time code, connection status, refresh action, and optional manual pairing payload. Loading, disabled, unavailable, expired, and QR-generation errors have separate presentations. New instructions are translated in all seven catalogs.

## Streaming findings and fixes

### 1. Recovery polling continued during a healthy phone-started turn

In `apps/remote-gateway/src/electron-app-server-adapter.js`, `dispatchTurn` armed `reconcileStartedTurn` after reading the post-dispatch snapshot. Only a later `turn/started` notification canceled that timer. The start notification could already have arrived, or the snapshot could have hydrated the active turn before the corresponding event was projected. Subsequent assistant deltas did not cancel polling.

The fallback requested the full orchestration snapshot every 250 ms, up to 61 attempts. This adds roughly four full-history reads per second while a turn is active, plus snapshot projection and text comparison. It is avoidable overhead that grows with conversation history; it does not make the provider generate tokens faster.

The adapter now records live activity for the current turn. Live events prevent the fallback from being armed, or cancel it if already armed. A canceled in-flight recovery cannot reschedule itself. A delayed checkpoint from an older turn does not cancel the current turn's recovery. When no live callbacks arrive, the existing recovery behavior remains.

Regression evidence: the healthy-stream test failed before the fix with four snapshot reads instead of three after 320 ms. It now stays at the three setup/dispatch reads, with zero additional polling reads. A separate test covers an event arriving inside dispatch before the timer can be armed. A third test preserves recovery when a previous-turn checkpoint arrives late.

### 2. Recovery compared against stale message text

The adapter maintained snapshot tracking separately from its live event projection, updating only the active turn ID after live events. A recovery snapshot could therefore compare against text from before those events and forward already-delivered tokens again.

Snapshot recovery now shares the live projection's message/activity maps and sequence watermark. It neither keeps a second growing live-text buffer nor accepts a snapshot older than the applied event sequence. The regression test delivers `Hello` live and then hydrates `Hello world`; the phone receives `Hello` followed by ` world`, not the whole message again.

### 3. Repeated status messages broadcast unchanged state to renderers

`reduceRemoteGatewayChildMessage` returned a fresh object for every status message, including identical statuses. The desktop main process uses object identity to decide whether to broadcast to its windows.

The reducer now preserves identity when status, fingerprint, device kind, and error text are unchanged. Identical status messages produce no renderer broadcast through this path; real transitions still propagate. A regression test failed before this change and passes afterward.

### 4. The QR panel rerendered on an idle interval

The panel updated its clock every 15 seconds even when remote access was off, unconfigured, or already connected. Expiry could also remain visually stale until the next tick.

It now schedules one timeout at the pairing expiry deadline and cancels it when unnecessary. This removes four timer-driven panel updates per minute while idle. QR generation loads lazily, skips disabled/connected states, and guards the image against payload changes. The initial state read cannot overwrite a newer native status event. Browser tests cover these behaviors, including expiry without a polling interval.

## Existing optimizations retained

The earlier event-driven streaming implementation is already present in this checkout: assistant deltas are forwarded from thread events, phone-originated turns request streaming delivery, and the encrypted transport coalesces notifications over a 40 ms window. iOS already batches rendering. These are not new changes from this audit. Their transport/projection regression coverage remains intact.

## Scoped cleanup

Removed the obsolete hidden-section set and visibility helper, and their filters in navigation, search, and tutorial enumeration. Removed the QR panel's perpetual interval and unnecessary status-label memo. Unsubscribing a thread now releases its cached workspace path and live-turn tracking. Unrelated legacy code was retained.

## Verification

- Full gateway suite after the final review correction: 719 tests passed, zero failures or skips.
- Adapter suite after the review correction: 32 tests passed, including three new streaming/recovery regressions.
- Desktop remote runtime: 5 tests passed.
- Settings search and pairing unit tests: 15 tests passed.
- Browser setup tests: 4 passed, covering enable, real QR rendering, refresh, manual payload hiding, connection/reset, unavailable configuration, expired codes, initial-read race, and expiry deadline.
- Web and desktop TypeScript checks passed. Targeted lint: zero warnings/errors. `git diff --check` passed.
- `bun run build:desktop`: 6 build tasks succeeded. The desktop bundle was rebuilt after the final gateway correction. The bundler reports its existing external `original-fs` warning.
- Real Electron QA used this worktree's renderer/backend with isolated test data and a local relay. The phone shortcut opened Remote from the main sidebar. The panel reached Ready to pair, displayed a generated QR, and refreshed to a different pairing session. The layout was visually inspected. Browser connection-state tests use a fixture; they do not prove a real phone pairing.

## Limits and follow-up

No production deployment, release, or CI run was performed. The desktop build still requires its configured relay endpoint; none was invented or added by this change. Local testing used the existing installed Electron executable because this worktree's dependency install lacked the executable.

A physical iPhone or Simulator was not paired for a measured end-to-end streaming run. Network round-trip time, relay load, provider latency, and iOS frame time were not benchmarked, so there is no justified millisecond latency or speedup-percentage claim. The improvements above are verified reductions in redundant work and fixes for duplicate delivery.

The repository-wide i18n audit remains red on existing catalog ordering and five unrelated visible-English findings in provider/account panels. Each of the seven baseline catalogs from HEAD also fails canonical ordering under the current runtime; broad reorder churn was intentionally avoided. All eight new remote setup keys are present and nonempty in every locale. New translations have not had independent native-speaker review.


## Visual follow-up: Remotion device hero

The later UI pass replaces the nested settings cards with a wider, themed setup panel and a dark hardware stage. A 9-second Remotion composition assembles 573 sampled dots into the existing DJL logo, then reveals an iPhone and Mac with a shared illustrative response. The composition plays once, holds its final frame, pauses offscreen/when the document is hidden, and exposes pause/replay controls. Reduced motion receives a static illustration. QR hover, step-state changes, the connected checkmark, refresh feedback, and manual-code expansion use brief local transitions.

The Player is a separate lazy production chunk (about 85.6 kB gzipped in the measured build); its frame state is isolated from pairing and thread state. Dot positions are precomputed. No continuous animation runs after completion and no backend streaming behavior changed in this visual pass.

Validation: all 7 browser tests passed (pairing plus motion lifecycle and narrow reduced-motion layout). The redesigned screen was inspected in the real Electron app; the assembled-logo frame was also rendered and inspected. Studio is available through `bun run --cwd apps/web remote:studio`. The animation does not show actual phone pairing or task execution.

The earlier minimalist dot-to-device animation was restored at the user’s request; the lightning, glow, and spark effects were removed.

The effects pass also reproduced and fixed a first-visit autoplay stall: the Player is now explicitly muted, avoiding browser AudioContext initialization for a silent composition. All 7 browser tests passed after this fix.
