# DJL iPhone Product Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete DJL's iPhone experience with unified navigation, recoverable authentication, durable notifications, voice, and provider-backed images.

**Architecture:** Reuse the existing cloud and paired-Mac services under the approved drawer shell. Add small authenticated notification/gallery APIs and a deterministic image task executor; preserve existing chat/run wire shapes. Use native speech APIs for voice, with account-scoped state and explicit lifecycle cleanup.

**Tech Stack:** SwiftUI, Observation, Speech, AVFoundation, XCTest, TypeScript, Bun, Effect HTTP, Drizzle/Postgres, Redis, pg-boss, Vitest, S3-compatible storage.

**Spec:** [Approved design](../specs/2026-10-11-djl-iphone-product-design.md)

## Global Constraints

- Keep the name DJL throughout the product.
- Use the existing SwiftUI app and Better Auth backend. Preserve current VPS changes on `codex/cloud-staging-readiness`; never stage unrelated changes.
- Use native Liquid Glass and existing adaptive helpers; preserve the app's iOS deployment targets and gate newer speech APIs by availability.
- Retain the approved drawer: 70% width, 30% conversation visible, rounded foreground panel, subtle outline and shadow, and smooth transitions.
- Floating header/footer controls must not paint solid safe-area bars.
- Keep Supabase and SMS out of the implementation. Provider secrets stay on the VPS; cloud history sync from the desktop remains opt-in.
- No production activation, release, real card payment, or provider-credit purchase is included. The existing OpenRouter key retains its US$1 total cap.
- No fake responses, generated-image placeholders, or claims of successful physical-device microphone/APNs testing based on Simulator results.
- Preserve the remote pairing protocol, provider routing, workspaces, terminals, and current cloud message/run contracts unless an additive change is required.
- Use six numeric OTP digits, a 60-second local resend cooldown, the existing 600-second OTP expiry, and the existing 10–256 character password bounds.
- Preserve 25 MiB/attachment and 10 attachments/message. Return at most 30 list items/page; use stable time/ID cursors.
- Stage and commit explicit task files only. Cloud changes already in this worktree are not an implicit part of each mobile commit.
- For already modified files, review and stage only the task's new hunks; preserve the existing cloud diff as an unstaged baseline.

## Review Focus

1. A sign-out or account switch while requests finish must not restore another account's data — Task 2 tests delayed results.
2. A server-accepted send with a lost response must retry the same client message ID — Task 3 tests a lost acknowledgement.
3. A task finishes while the app is away or its events replay; alert once and preserve read state — Tasks 4–5 test restart/replay.
4. Speech permission, assets, or audio routes fail during recording; clean up and never auto-send — Task 6 tests interruption/cancellation.
5. Image jobs retry after worker interruption; preserve ownership, result identity, and credit settlement — Tasks 7–8 test replay/failure/IDOR.

## Delivery A — Shell, authentication, and chat

### Task 1: Public mobile capabilities

**Files:** Create `packages/contracts/src/cloud/clientConfig.ts`, `cloud/apps/api/src/client-config/routes.ts`, `cloud/apps/api/src/client-config/routes.test.ts`; modify `packages/contracts/src/cloud.ts`, `cloud/apps/api/src/server.ts`, `cloud/infra/vps/compose.yml`, `cloud/infra/vps/.env.example`; add fixture `packages/contracts/fixtures/cloud/client-config.json`.

**Interfaces:** `GET /v1/client-config` returns `{auth:{google:boolean,apple:boolean},tools:{imageGeneration:boolean,imageEditing:boolean,fileParsing:boolean},pushConfigured:boolean,policyUrls:{terms:string|null,privacy:string|null}}`. `makeClientConfigRoutes(deps:ClientConfigDeps)` produces an HTTP router layer. `ClientConfigDeps` contains the auth booleans, `gateway:Pick<GatewayService,"listModels">`, `fileParsing:boolean`, `pushConfigured:boolean`, and `policyUrls:{terms:string|null,privacy:string|null}`. Derive booleans from configured providers/settings and validate HTTPS public policy URLs. No client secrets or keys are passed to the route or returned.

- [ ] Write tests `exposesOnlyConfiguredCapabilities`, `neverReturnsSecrets`, and `rejectsInvalidPolicyUrls`; assert Apple false with missing credentials and image editing false for generation-only models.

```ts
expect(body.auth).toEqual({ google: true, apple: false });
expect(body.tools.imageEditing).toBe(false);
expect(Object.keys(body).sort()).toEqual(["auth", "policyUrls", "pushConfigured", "tools"]);
```

- [ ] Run `bun x --no-install vitest run src/client-config/routes.test.ts` in `cloud/apps/api`; observe the missing-route failure.
- [ ] Implement the contract/route, export it, wire the server, and pass only public policy URL configuration through Compose.
- [ ] Run the route tests, contract fixture tests, and cloud typechecks; verify exact booleans/nullable URLs and no private environment values.
- [ ] Commit only this task's files after passing checks.

### Task 2: Recoverable authentication and account state

**Files:** Modify `apps/ios/DJL/Services/Cloud/CloudAuthAPI.swift`, `CloudAPIClient.swift`, `CloudService.swift`, `CloudModels.swift`, `apps/ios/DJL/Views/Cloud/Auth/CloudWelcomeView.swift`, `CloudEmailSignInView.swift`; create `CloudPasswordRecoveryView.swift`, `apps/ios/DJL/Services/Cloud/CloudAuthFormState.swift`, `apps/ios/DJLTests/CloudAuthRecoveryTests.swift`; extend `CloudAPIClientTests.swift` and contract fixture tests.

**Interfaces:** Add `CloudAPIClient.clientConfig() async throws -> CloudClientConfig`; `CloudAuthAPI.requestPasswordReset(email:) async throws`; `resetPassword(email:code:password:) async throws`. Use Better Auth `/email-otp/request-password-reset` and `/email-otp/reset-password`. `CloudAuthFormState` provides static `isValidCode(_:)`, `isValidPassword(_:)`, `canResend(sentAt:now:)` and owns reset/change-email transitions. `CloudService.accountScopeKey:String?` combines user ID and personal org ID; an incremented account-generation guard fences asynchronous results. Sign-out clears only cloud account state.

- [ ] Add tests for numeric six-digit codes, resend at 59/60 seconds, 10/256 password bounds, reset request bodies, expired/throttled errors, and changing the email after sending a code.

```swift
XCTAssertFalse(CloudAuthFormState.isValidCode("12a456"))
XCTAssertTrue(CloudAuthFormState.isValidCode("123456"))
let sentAt = Date(timeIntervalSince1970: 0)
XCTAssertFalse(CloudAuthFormState.canResend(sentAt: sentAt, now: sentAt.addingTimeInterval(59)))
XCTAssertTrue(CloudAuthFormState.canResend(sentAt: sentAt, now: sentAt.addingTimeInterval(60)))
```

- [ ] Add `testDelayedRefreshCannotRepopulateSignedOutAccount`; use `CloudURLProtocol` and `CloudMemorySessionStore`, not real Keychain credentials.
- [ ] Run the focused iOS tests with XcodeBuildMCP `test_sim({extraArgs:["-only-testing:DJLTests/CloudAuthRecoveryTests","-only-testing:DJLTests/CloudAPIClientTests"]})`; verify failure before implementation.
- [ ] Implement recovery/resend screens, cancellable submissions, capability-gated social buttons, and configured policy links. Map OTP errors separately from password errors.
- [ ] Run the focused tests and existing cloud contract fixtures. Confirm cancelled login callbacks cannot complete a later sign-in.
- [ ] Commit explicit task files.

### Task 3: Unified shell, conversation UX, and settings

**Files:** Create `apps/ios/DJL/Views/Cloud/Shell/CloudShellView.swift`, `CloudNavigationMenu.swift`, `CloudSettingsView.swift`, `CloudArchivedChatsView.swift`, `apps/ios/DJL/Services/Cloud/CloudDraftStore.swift`, `CloudNavigationState.swift`; modify `ContentView.swift`, `CloudHomeView.swift`, `CloudChatView.swift`, `CloudComposerView.swift`, `CloudChatAccessories.swift`, `CloudChatSession.swift`, `CloudService.swift`, `PhoneNavigationMenu.swift`; add `CloudNavigationTests.swift`, `CloudDraftStoreTests.swift`, `CloudChatSessionTests.swift` under `apps/ios/DJLTests`.

**Interfaces:** `CloudNavigationState.Destination` has chat, images, notifications, and settings; Remote changes `CloudSectionPreference` through the existing route. `CloudDraftStore` provides `draft(accountID:conversationID:)`, `save(_:accountID:conversationID:)`, `clear(accountID:)`, using `"new"` for a new conversation. `CloudService.loadMoreConversations() async` respects the API cursor. `CloudChatSession.send(text:String,attachments:[CloudPendingAttachment]) async -> Bool` reports acceptance and preserves its client message ID for retry; `retryLastSend() async` reuses that attempt.

- [ ] Test drawer width `390 * 0.70 == 273`, selected conversation retention, account-scoped drafts, history page merging without duplicates, and a lost send acknowledgement retried with the same ID.

```swift
XCTAssertEqual(PhoneNavigationDrawerPolicy.width(for: 390), 273, accuracy: 0.001)
XCTAssertEqual(retriedInput.clientMessageId, acceptedInput.clientMessageId)
XCTAssertEqual(reopenedDraft, "Unsent question")
```

- [ ] Run the focused test classes plus `CloudChatLogicTests`; verify failures for missing state/storage behavior.
- [ ] Build the shell using existing `PhoneNavigationDrawer` and glass helpers; keep the active chat mounted when the menu opens. Center empty chat content and retain floating controls.
- [ ] Give the menu toggle, composer, and image destination stable accessibility identifiers `cloud.navigation.toggle`, `cloud.compose.input`, and `cloud.images.open` respectively.
- [ ] Add pinned/recent/search/archive/restore navigation, grouped provider models, draft-aware composer, retry, capability-gated attachments, and settings for account/usage/appearance/voice/notifications. Remove only completion checks in the touched cloud task UI.
- [ ] Refresh account/model/history state on foreground return. Add an explicit Cloud chat entry in the remote menu without changing pairing or remote thread routing.
- [ ] Run tests, build on Simulator, and use CUA for menu tap/swipe, keyboard, dark mode, long history, model disappearance, archive/restore, and Cloud↔Remote navigation. Confirm a 30% conversation sliver and retained draft.
- [ ] Commit explicit task files; Images/Notifications destinations will receive their functional content in the following deliveries before integrated acceptance.

## Delivery B — Durable notifications

### Task 4: Scoped task activity API

**Files:** Create `packages/contracts/src/cloud/notifications.ts`, `cloud/packages/db/src/schema/notifications.ts`, `cloud/apps/api/src/notifications/NotificationService.ts`, `routes.ts`, `NotificationService.test.ts`, `notifications.e2e.test.ts`; modify schema exports, contract exports, `server.ts`; generate a Drizzle migration/journal update and add notification fixtures.

**Interfaces:** `NotificationService.list(principal,cursor?)` returns `{notifications,nextCursor,unreadCount}`. Entries are `{id,conversationId,conversationTitle,status,finishedAt,readAt}`, with run ID as `id`. `markRead(principal,ids:readonly string[])` accepts at most 30 IDs, is idempotent, and returns the updated unread count. Routes: `GET /v1/notifications`, `POST /v1/notifications/read` with `{ids}`. Receipts are scoped by user/org/run and unique per user/run.

- [ ] Seed two owners and terminal task runs; assert own succeeded/failed entries only, exclusion of chat/cancelled/deleted conversations, stable paging, and total unread count across pages.
- [ ] Test foreign read/list attempts return no foreign data, batch read is atomic, and repeated reads create one receipt. Add a restart-style test proving results derive from durable runs rather than transient notification delivery.

```ts
await service.markRead(alice, [aliceRun.id]);
await service.markRead(alice, [aliceRun.id]);
expect((await service.list(alice)).unreadCount).toBe(0);
await expect(service.markRead(bob, [aliceRun.id])).rejects.toMatchObject({ code: "not_found" });
```

- [ ] Run focused API tests and observe failures, then implement the schema/service/routes and index for terminal task listing. Generate migrations with `bun run --cwd cloud/packages/db generate`; inspect SQL before applying it to the disposable database.
- [ ] Run the tests, API typecheck, contract fixtures, and runtime-grant verification against the disposable database. Keep ledger/audit grants unchanged.
- [ ] Commit explicit task files, migration, and matching fixtures.

### Task 5: Inbox, banners, and remote activity

**Files:** Create `apps/ios/DJL/Services/Cloud/CloudNotificationStore.swift`, `apps/ios/DJL/Views/Cloud/Notifications/CloudNotificationsView.swift`, `CloudNotificationBanner.swift`, `apps/ios/DJL/Services/Notifications/MobileRemoteActivityStore.swift`; modify `CloudModels.swift`, `CloudAPIClient.swift`, `CloudService.swift`, `CloudShellView.swift`, `ContentView.swift`, `DJLApp.swift`, `CloudSettingsView.swift`; add `CloudNotificationTests.swift` and `MobileRemoteActivityTests.swift`.

**Interfaces:** Add `CloudAPIClient.notifications(cursor:)` and `markNotificationsRead(ids:)`. `CloudNotificationStore.refresh() async`, `open(_:) async`, and `setActiveConversation(_:)` manage `notifications:[CloudNotification]`, `unreadCount:Int`, and `banner:CloudNotification?`. Remote activity consumes `CodexService.threadCompletionBanner`, `pendingApprovals`, and current trusted-Mac identity; routing uses existing remote thread-open paths.

- [ ] Test no banners on initial history load, one banner per new completed run, no banner for the displayed conversation, preserved unread receipts, and tapping the exact conversation ID.

```swift
XCTAssertNil(store.banner) // Initial history is not a new alert.
XCTAssertEqual(store.unreadCount, 1)
XCTAssertEqual(openedConversationID, notification.conversationId)
```

- [ ] Test polling cancellation on background/sign-out, old-account response rejection, and remote deduplication by Mac identity; assert remote titles never reach cloud HTTP requests.
- [ ] Run the focused iOS tests, then implement an inbox, unread badge, banners, and independent in-app/system-notification preferences. Poll every 15 seconds only while active/signed in; refresh immediately on foreground return and task completion.
- [ ] Wire cloud and remote notification observers at app/root lifetime so changing the visible section does not disconnect routing. Keep APNs registration conditional on user action and backend configuration.
- [ ] Run tests and use CUA to start a task, leave its chat, receive/open its inbox entry, mark it read, restart the app, and verify no duplicate banner. Inspect denied/unconfigured push states without claiming real APNs delivery.
- [ ] Commit explicit task files.

## Delivery C — Voice

### Task 6: On-device dictation and spoken replies

**Files:** Create `apps/ios/DJL/Services/Cloud/Voice/CloudVoiceInput.swift`, `CloudSpeechPlayback.swift`, `CloudVoicePolicy.swift`, `apps/ios/DJL/Views/Cloud/Voice/CloudVoiceControls.swift`; modify `CloudComposerView.swift`, `CloudChatView.swift`, `CloudMessageRow.swift`, `CloudSettingsView.swift`, `apps/ios/BuildSupport/DJL-Info.plist`; add `CloudVoiceTests.swift`.

**Interfaces:** `CloudVoiceInput.start(locale:) async`, `stop() async -> String?`, `cancel()` expose idle/preparing/recording/stopping/failed states. Prefer iOS 26 SpeechAnalyzer; use on-device-only recognition when falling back, otherwise present unavailable. `CloudSpeechPlayback.speak(_:messageID:)`, `stop()` own synthesis. `CloudVoicePolicy.appendingTranscript(_:to:)` inserts the result once into the draft without sending.

- [ ] Test permission-denied/unavailable/asset failure, cancellation before preparation finishes, transcript insertion once, and cleanup on interruption/background/navigation/sign-out with injected speech/audio boundaries.

```swift
XCTAssertEqual(CloudVoicePolicy.appendingTranscript("hello", to: "Draft"), "Draft hello")
XCTAssertEqual(captureStopCount, 1)
XCTAssertEqual(messageSendCount, 0) // Dictation reviews text; it never sends.
```

- [ ] Test starting the mic stops synthesis, starting new playback stops the previous utterance, and optional spoken replies are not replayed when history loads.
- [ ] Run the focused test class and observe failures. Implement Apple speech/audio APIs with availability checks, explicit asset/locale states, cancellable capture, no audio uploads, and transient buffers. Add usage descriptions only for permissions used.
- [ ] Add accessible microphone/waveform/stop controls and Read aloud/Stop reply actions; wire voice preferences and lifecycle cleanup.
- [ ] Run tests/build; use CUA for microphone UI, permission/error states, transcript review, and speech playback. Request the user's spoken test input on a supported device for actual recognition; record that result separately from Simulator tests.
- [ ] Commit explicit task files.

## Delivery D — Images

### Task 7: Correct image provider contract and catalog

**Files:** Modify `cloud/packages/providers/src/openaiCompatible.ts`, `types.ts`, `adapters.test.ts`, `cloud/apps/api/src/agent/imageTools.ts`, `cloud/packages/db/src/seedModels.ts`; create `cloud/packages/db/src/configureImageModel.ts`, `configureImageModel.test.ts`; update VPS provider documentation/config only where needed.

**Interfaces:** OpenRouter `generateImage` posts JSON to `/images` with model/prompt/requested `n` and supported aspect ratio; the mobile image action requests `n:1`. Direct OpenAI keeps its existing endpoint. Add optional `mediaType:string` to normalized `ImageResult.images` entries; map upstream `media_type` and validate raster bytes through the shared generated-image storage path. `configureImageModel(databaseUrl:string,modelId:string,fetchImpl:typeof fetch = fetch):Promise<void>` validates selected endpoint parameters/per-image pricing before an audited catalog update. The CLI takes model ID from `OPENROUTER_IMAGE_MODEL_ID`, and credentials only from its private environment.

- [ ] Test the exact OpenRouter path/body, base64 PNG/JPEG/WebP handling, unsupported format/empty response, upstream error classification, and unchanged direct OpenAI behavior.

```ts
expect(requestUrl).toBe("https://openrouter.ai/api/v1/images");
expect(requestBody.n).toBe(1);
expect(result.images[0]?.mediaType).toBe("image/png");
```

- [ ] Test invalid model metadata/unsupported edit capability and no catalog enable on failed validation. Recheck live Recraft endpoint pricing and funding before configuration; preserve the US$1 key cap.
- [ ] Run provider/config tests and observe failures. Implement the minimal adapter translation and MIME preservation. Keep unavailable FLUX disabled; expose editing only for verified reference-capable models.
- [ ] Run provider/API tests and typechecks; verify reserve/release behavior on rejected image results with the existing gateway tests.
- [ ] Commit explicit task files. Do not purchase credits or enable an unfunded model merely to make the UI appear working.

### Task 8: Deterministic image task and owned gallery

**Files:** Create `cloud/apps/api/src/images/ImageService.ts`, `ImageRunExecutor.ts`, `routes.ts`, `ImageService.test.ts`, `ImageRunExecutor.test.ts`, `images.e2e.test.ts`, `packages/contracts/src/cloud/images.ts`; modify `runs/RunExecutor.ts`, `agent/runtime.ts`, `agent/imageTools.ts`, `chat/ChatService.ts`, `server.ts`, `cloud/apps/worker/src/index.ts`, contract exports; add image task/gallery fixtures and required migration indexes.

**Interfaces:** `POST /v1/conversations/:id/images` accepts `{clientMessageId,prompt,aspectRatio}` and returns existing `CloudSendMessageResponse`, with a task-mode run. `ImageService.create(principal,conversationId,input)` checks ownership and reuses existing message-ID idempotency. `ImageRunExecutor.execute(runId,signal)` writes existing run events and image refs, using gateway credits and private storage. Extend `TaskQueue.enqueue(runId,kind?:"agent"|"image")`; image jobs use `image.run`, preserving existing callers. `GET /v1/images?cursor=` returns owned generated-file metadata with conversation/message IDs and `nextCursor`.

- [ ] Test repeated create returns the same message/run/job, foreign conversations are 404, unsupported model is rejected before charging, and cancelled runs never start generation.

```ts
expect(retried.run.id).toBe(created.run.id);
expect(retried.reply.id).toBe(created.reply.id);
expect(enqueue).toHaveBeenCalledTimes(1);
```

- [ ] Test one image/ref/settlement across duplicate worker execution, upstream failure releases reservation, worker interruption does not publish a second result, and events replay in sequence. Do not add a retry loop that repeats a provider-billed call after an ambiguous failure; fail visibly when safe recovery cannot prove the original result.
- [ ] Test gallery ownership, deletion filtering, stable pages, and file metadata without embedded bytes or permanent public URLs.
- [ ] Run focused tests and observe failures. Implement the service/executor and share the existing generated-image storage function rather than duplicate it. Use the existing lease/status mechanism and deterministic usage/storage identities.
- [ ] Wire API producer and worker queue with private Postgres grants intact. Run tests, fixtures, typechecks, and migration/runtime verification.
- [ ] Commit explicit task files.

### Task 9: Mobile image creation, gallery, and preview

**Files:** Create `apps/ios/DJL/Views/Cloud/Images/CloudImagesView.swift`, `CloudImageCreationSheet.swift`, `apps/ios/DJL/Services/Cloud/CloudImageGallery.swift`; modify `CloudAPIClient.swift`, `CloudModels.swift`, `CloudService.swift`, `CloudChatSession.swift`, `CloudComposerView.swift`, `CloudChatView.swift`, `CloudShellView.swift`; add `CloudImageGenerationTests.swift` and gallery fixtures/tests.

**Interfaces:** `CloudAPIClient.createImage(conversationID:input:)` returns `CloudSendMessageResponse`; `images(cursor:)` returns `CloudImageGalleryPage` with `images:[CloudGeneratedImage]` and `nextCursor:String?`. Generated metadata includes file ID, MIME type, size, creation time, conversation ID, and message ID. `CloudChatSession.generateImage(prompt:aspectRatio:) async -> Bool` preserves a retry ID and uses the normal event stream. `CloudImageGallery.loadNextPage() async` deduplicates `images:[CloudGeneratedImage]` by file ID. Image cache uses decoded-cost limits of 20 MiB and at most two simultaneous image downloads; cancel offscreen requests.

- [ ] Test unavailable image action, generation acceptance/retry/cancel, image refs after event replay, gallery page merging, and account-switch cache clearing.

```swift
XCTAssertEqual(Set(gallery.images.map(\.id)).count, gallery.images.count)
XCTAssertTrue(gallery.images.isEmpty) // After signing out or switching account.
XCTAssertEqual(retriedImageInput.clientMessageId, acceptedImageInput.clientMessageId)
```

- [ ] Test native save/share handles selected image only and that Edit image is absent without backend/model support.
- [ ] Run focused tests and observe failures; implement creation sheet, progress, paginated grid, image preview, native share/save, and bounded downsampled image caching. Update the existing preview instead of creating a competing full-screen renderer.
- [ ] Run tests/build and use CUA for empty/loading/error/gallery/preview states. After user funding, generate one real image within the key cap; inspect stored MIME/ownership, persisted conversation, and one settled charge.
- [ ] Commit explicit task files.

## Delivery E — Integrated acceptance

### Task 10: Real staging and simulator verification

**Files:** Update `apps/ios/DJLUITests/CloudLocalE2ETests.swift` to cover the new shell without treating mock echo/images as real provider evidence; add focused mobile-product UI coverage. Save a dated QA report under `docs/qa/` with no keys, OTPs, passwords, or private chat bodies.

- [ ] Run `bun run cloud:ci` against the disposable local Postgres/Redis services and focused iOS tests with XcodeBuildMCP. Preserve/report unrelated baseline failures; do not remove tests to obtain green output.
- [ ] Build the current DJL scheme on the existing QA Simulator. Use CUA for real staging email-code sign-in, resend/error states, chat management, streamed replies, stop/reconnect, and app restart.

```swift
XCTAssertTrue(app.buttons["cloud.navigation.toggle"].waitForExistence(timeout: 10))
XCTAssertTrue(app.descendants(matching: .any)["cloud.compose.input"].exists)
```

- [ ] Exercise password recovery using a disposable account. Hand new-password entry to the user when testing through computer use; never change the user's existing credentials silently.
- [ ] Verify Remote manual short-code pairing and Studio/Projects/Workspaces; return to cloud chat and confirm retained drafts. Do not upload remote history or reset saved pairings.
- [ ] Verify inbox routing/read state and background task completion; test dark mode, Dynamic Type, VoiceOver labels, Reduce Motion, keyboard/safe areas, long replies, and large lists.
- [ ] Verify voice controls/read aloud and record separately whether actual microphone recognition and APNs background delivery were tested.
- [ ] After funding, verify real image generation, ownership, save/share/gallery, cross-client persistence, and settlement within the unchanged cap. If unfunded, leave live-image acceptance explicitly pending rather than mark it passed.
- [ ] Rebuild/redeploy only authorized staging services after passing cloud checks; back up first, apply migrations, verify native runtime roles/storage/queue and health. Keep production unchanged.
- [ ] Perform a final review of changed files against the spec, rerun checks for any fixes, and report verified outcomes and remaining external prerequisites. Use a fresh reviewer only if the selected execution method calls for one.
- [ ] Commit explicit final test/report files; push/PR/release only when requested separately.
