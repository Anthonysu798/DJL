# DJL iPhone product completion

Status: written design approved on 2026-10-11.

## Purpose and success criteria

Make DJL a useful standalone iPhone assistant, with the familiar interaction
quality of a chat app and the existing ability to work through a paired Mac.
The user approved including authentication, cloud chat, remote access,
conversation management, notifications, voice, and image generation.

Success means these flows run against the real DJL staging backend, survive
navigation and app suspension, and expose clear failure and recovery states.
Simulator screenshots, automated checks, and actual provider results must be
reported separately from production readiness or App Store publication.

## Constraints

- Keep the name DJL throughout the product.
- Use the existing SwiftUI app and Better Auth backend. Preserve current VPS
  changes on `codex/cloud-staging-readiness`; never stage unrelated changes.
- Use native Liquid Glass and existing adaptive helpers; preserve the app's
  iOS deployment targets and gate newer speech APIs by availability.
- Retain the approved drawer: 70% width, 30% conversation visible, rounded
  foreground panel, subtle outline and shadow, and smooth transitions.
- Floating header/footer controls must not paint solid safe-area bars.
- Keep Supabase and SMS out of the implementation. Provider secrets stay on
  the VPS; cloud history sync from the desktop remains opt-in.
- No production activation, release, real card payment, or provider-credit
  purchase is included. The existing OpenRouter key retains its US$1 total cap.
- No fake responses, generated-image placeholders, or claims of successful
  physical-device microphone/APNs testing based on Simulator results.
- Preserve the remote pairing protocol, provider routing, workspaces, terminals,
  and current cloud message/run contracts unless an additive change is required.

## Architecture and delivery boundaries

The chosen approach is a unified mobile shell around the existing cloud and
remote services. A cosmetic refresh of separate homes would leave two navigation
systems; rebuilding the app would discard working pairing and chat code.

Implement and verify these independent deliverables in order:

1. Mobile shell, cloud conversation UX, and account recovery.
2. Durable in-app activity and notification routing.
3. Voice input and spoken replies.
4. Provider-backed image generation and saved image results.
5. Integrated simulator QA and staging verification.

Each deliverable needs its own implementation-plan section and test cycle. Shared
API/contract changes land before the mobile screens that consume them.

## 1. Navigation and visual design

Signed-in users open a new cloud conversation. The left menu contains Chat,
Images, Remote, Notifications with an unread count, Pinned, Recent chats, and
Settings. Search filters or searches the current account's conversations.
Cloud entries and Mac entries have distinct context so titles alone cannot make
a remote thread look like a cloud conversation.

Reuse `PhoneNavigationDrawer` for the cloud shell. Retain the active conversation
and composer while opening the drawer. Selecting Remote opens the existing
Studio/Projects/Workspaces experience and offers an obvious return to cloud chat.
Remote pairing remains available without a cloud account.

The main canvas uses generous spacing and a centered empty state. Glass belongs
on navigation, action controls, and the composer; messages remain readable on a
quiet surface. Support dark mode, Dynamic Type, VoiceOver, Reduce Motion, keyboard
presentation, and scrolling without obscuring the last message or menu row.

## 2. Authentication and account

Keep existing Google, password, and email-code authentication and secure Keychain
sessions. Complete the missing recovery states rather than replace Better Auth.

- Make email-code sign-in easy to find; permit changing the email and resending
  a code with a 60-second local cooldown. Respect server throttling and the
  existing 10-minute OTP expiry.
- Validate six numeric OTP digits. Display wrong, expired, throttled, network,
  and server failures in the appropriate screen without clearing useful input.
- Add password recovery using the existing Better Auth email-OTP reset flow.
  Enforce the backend's password policy and revoke prior sessions as configured.
- Disable competing submissions while one request is in flight. Cancellation
  and back navigation must not create a surprise sign-in later.
- Fetch public client capabilities from the backend so Apple/Google buttons and
  optional tools reflect actual configuration. Never return credentials.
- Retain sign-out and account deletion confirmations. A revoked session returns
  to sign-in and clears account-scoped caches, drafts, images, and unread state.
- Settings expose account identity, credits/usage, appearance, notification
  preferences/status, voice preferences, archived chats, and remote access.
- Show approved Terms/Privacy links only when real URLs are configured. The user
  supplies legal text; do not invent agreements or show non-working policy links.

Apple sign-in needs configured Apple credentials before it can be enabled and
claimed working. Completing those credentials and public legal documents remains
a release prerequisite, not an excuse to render a broken sign-in option.

## 3. Chat and conversation management

Keep the current message-tree and run-event mechanisms, including stable
`clientMessageId` values, event sequence cursors, and server-backed run state.

- Stream incremental responses, show working/stop controls, and preserve the
  completed response after navigation or reconnect.
- Persist drafts locally per account and conversation; clear a submitted draft
  only after the server accepts it. Transport failures retain the draft and offer
  retry without duplicating an accepted message or run.
- Stop, retry, edit, regenerate, copy, and branch switching remain available.
- Pin, rename, archive, restore, delete, and search use server-backed cloud data.
  Paginate history instead of silently showing only the first page.
- Refresh conversation/model/activity state on foreground return. Cancel hidden
  view work; reconnect a running task from its last event cursor without repeating
  already rendered text.
- Keep attachment limits: 25 MiB per attachment and at most 10 per message.
  Gate vision/file actions by actual model and backend capability; provide a
  useful explanation when a selected model cannot read an attachment.
- Group models by provider and use the real catalog. Keep unsupported providers
  hidden, preserve valid selections, and recover when a selected model disappears.
- Show active progress with a spinner. Do not add green completion checks to
  sidebar rows or task cards.

## 4. In-app notifications

Provide an account-scoped inbox with unread state and foreground banners. A tap
opens the exact conversation or remote thread. Do not show a banner for the
conversation the user is already reading, or replay old completions as new alerts.

Cloud task notifications derive from durable terminal task runs (`succeeded` or
`failed`), joined to non-deleted conversations. Store read receipts separately so
read state survives reinstalls and is shared between the user's clients. Cancelled
tasks do not generate a completion alert. Existing run records avoid a second
completion queue or a fragile notification write after a worker crash.

Add authenticated, paginated notification list/read endpoints. Every read and
mutation checks both user and org, and read requests are idempotent. Backend
results include generic status copy, conversation ID/title, completion time,
read time, pagination cursor, and total unread count. No prompt bodies or secrets
enter logs or push payloads.

Remote completion/approval notifications use the existing paired-Mac state and
remain local to that pairing. Do not upload remote chat titles or content to the
cloud inbox without the existing explicit history-sync opt-in.

Refresh while the app is active and on foreground return; stop polling when
backgrounded or signed out. APNs remains the transport for alerts while the app
is suspended. In-app notifications must work without APNs credentials. Preferences
distinguish in-app alerts from operating-system permission and backend push
availability; disabling one must not silently disable the other.

## 5. Voice

The approved first version uses tap-to-talk, transcript review, and spoken replies.
It is turn-based voice interaction, not a continuous full-duplex calling service.

- Add a microphone action to cloud chat with preparing, recording, stopping,
  cancelled, unavailable, and permission-denied states.
- Prefer Apple's on-device SpeechAnalyzer/SpeechTranscriber where available;
  handle locale/asset availability explicitly. A fallback must not silently upload
  audio to another speech provider.
- Review the transcript in the composer before sending. Transcription never
  automatically sends a message or creates a duplicate request.
- Provide Read aloud/Stop for assistant replies using native speech synthesis.
  Offer optional spoken replies and respect interruptions, backgrounding, and
  route changes. Stop audio when the user navigates away or signs out.
- Microphone access begins only after the user's voice action. Keep raw recordings
  transient, release the audio engine/taps after every stop, and keep audio/content
  out of logs.

Unit tests cover transcript insertion, cancellation, and lifecycle rules. A real
microphone test requires a supported device and the user's spoken input. Simulator
permission/error tests do not prove speech recognition accuracy.

## 6. Images

Expose Create image in chat and an Images destination containing the current
account's generated results. Generation creates a durable background task with
progress/cancel/retry and attaches the stored result to its conversation. Use a
deterministic generation action rather than rely on a chat model merely agreeing
to draw an image. Reuse run events, private blob storage, and image-ref messages.

Fix OpenRouter's image adapter to use the documented `POST /api/v1/images` API.
Discover/verify the selected model and endpoint parameters. The old FLUX seed must
not be enabled as a working image model without provider verification.

For the bounded staging test, the observed Recraft V4.1 Flash endpoint supports
generation at US$0.007 per output image, with `aspect_ratio` and `n`; it does not
advertise image-reference editing. Recheck metadata and prices before enabling the
model or making a paid call. Generate one image per request. Only render an Edit
image action for a separately configured model that actually supports references.

Keep credits reservation, settlement, failure release, and ownership checks. Return
safe raster MIME metadata, validate bytes, and store results privately. Do not
route OpenRouter requests through an OpenAI key or put keys in the app bundle.

Support image preview, share, and saving through the native user-initiated flow.
Page the gallery server-side by generated files owned by the current user/org;
do not download all image bytes or every conversation to build the grid. Cache
bounded thumbnails and release offscreen full-size images.

OpenRouter presently has US$0 available. Implementation and deterministic contract
tests can proceed; a successful real generation claim requires the user to fund
the account. Do not purchase credits or increase the existing US$1 key cap.

## 7. Backend contracts and verification

Additive contracts belong in `packages/contracts` and have matching Swift models
and fixtures. Public client configuration carries only capability flags and approved
public policy URLs. Notification and image-gallery APIs enforce user/org ownership,
bounded pages, and deterministic cursors. Schema migrations preserve existing data.

Required automated checks:

- Auth resend/recovery, stale callbacks, session revocation, and account isolation.
- Drawer geometry, navigation state, draft retention, paging, and stream replay.
- Notification ownership, read idempotency, unread count, cancellation exclusion,
  deletion filtering, and no duplicate foreground banners.
- Voice permission/cancellation, one transcript insertion, audio cleanup, and
  read-aloud interruption handling.
- OpenRouter request/response shape, MIME validation, unsupported parameters,
  upstream failure/credit release, generation idempotency, and gallery IDOR.
- Existing cloud fixtures, cloud CI, focused iOS tests, and simulator builds.

Computer-use acceptance flows against staging:

1. Sign in with email code; exercise resend/error recovery; retain the session
   across app restart. Test password recovery using a disposable test account.
2. Open/close/swipe the drawer, manage chats, send a real streamed reply, stop a
   run, reopen it, and observe the same content on web and iPhone.
3. Enter Remote, verify the existing short-code pairing path and synchronized
   Studio/Projects/Workspaces, then return to cloud chat without lost drafts.
4. Start a task, leave its screen, observe an inbox entry/banner, mark it read,
   and tap it to open the correct conversation. Verify errors and reconnect.
5. Test voice controls and read aloud; separately record whether physical-device
   speech and actual background APNs were tested.
6. After funding, generate one real image within the key cap, preview/share/save,
   verify gallery persistence and conversation sync, and check credits exactly once.

No flow is complete based solely on a button tap, mocked response, or successful
build. Preserve failure evidence and describe external configuration gaps explicitly.

## Reference evidence

- OpenRouter Image API: https://openrouter.ai/docs/guides/overview/multimodal/image-generation
- Image endpoint metadata: https://openrouter.ai/api/v1/images/models/recraft/recraft-v4.1-flash/endpoints
- Apple speech sample: https://developer.apple.com/documentation/speech/bringing-advanced-speech-to-text-capabilities-to-your-app
- Current implementation: `apps/ios/DJL/Views/Cloud`,
  `apps/ios/DJL/Services/Cloud`, `PhoneNavigationDrawer.swift`,
  `cloud/apps/api/src/runs`, and `cloud/apps/api/src/agent/imageTools.ts`.
