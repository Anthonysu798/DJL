# Remote phone update and validation

## Current behavior

- Remote Settings exposes the short one-time pairing code, a Copy pairing code action, and QR. The long manual token UI has been removed. The illustration autoplays and loops while visible, with reduced-motion and background/offscreen handling.
- Desktop main renews an enabled, unpaired session 30 seconds before code expiry, including when Settings is closed. Connected phones are not rotated. Retry scheduling is bounded.
- The phone reads `server.getConfig` and `provider.listModels` through the encrypted gateway. Model history no longer supplies a fabricated fallback catalog.
- Each picker entry has a provider-qualified identity, a raw model ID, a friendly provider name, and the provider's actual reasoning/speed capabilities. Requests carry `djlProvider` and the raw model together.
- The gateway validates that pair against the desktop catalog before dispatch. It maps reasoning to each provider's native option key and preserves explicit fast/default choices. Legacy unqualified phone choices cannot silently switch an existing thread to another provider.
- iPhone navigation is Studio, Projects, and Workspaces. Attention remains in the menu. Studio/project classification uses explicit desktop metadata; new phone Studio threads create a Studio project scope.
- Workspaces lists existing desktop panes using a metadata-only terminal inventory. Opening a pane attaches to its existing PTY and history. Phone IDs include workspace and pane identities; reconnect retains the original desktop pane ID. Saved sessions are restored at desktop startup without requiring the Workspaces page to be opened first.

## Bugs found

1. The old model list was reconstructed from thread history, with a hard-coded `openai/gpt-5` fallback. It could send an OpenCode model to a Codex ChatGPT session. Provider-aware discovery and validation replace that path.
2. Phone turns were hard-coded to OpenCode. They now route to the selected provider.
3. All reasoning used `options.variant`. Codex now uses `reasoningEffort`, Claude `effort`, Pi/Gemini `thinkingLevel`, and OpenCode/Kilo `variant`.
4. The installed September 4 Simulator app lacked batch decoding. Its binary had no `decodeBatch` or `isBatchText` symbols. The current iOS build supports the gateway's coalesced frames.
5. Workspace pane IDs were absent from chat-based terminal discovery. A lightweight inventory and direct phone routes now expose them.
6. Workspace reconnect could use the composite phone ID as a new desktop terminal ID. The saved desktop ID is now passed explicitly.
7. Chat terminals without a worktree path failed to resolve their project directory. Full snapshots now populate that fallback directory.

## Earlier live checks (before the short-code follow-up)

Computer Use manually entered the desktop `RMX1` payload into iPhone 17 Pro Simulator (iOS 26.5); no camera/QR scan was used. The desktop showed a connected phone.

The desktop-originated `DESKTOP_SYNC_OK` prompt and reply appeared on iPhone. The phone-originated `PHONE_SYNC_FINAL_OK` prompt and response appeared on desktop. The phone's workspace picker exposed the test pane, attached to it, and displayed `WORKSPACE_DESKTOP_SYNC_OK` from the desktop shell.

The updated iPhone received a live catalog of 24 models. Final visual checks of the latest picker/scope refinements, and the remaining phone-to-workspace input check, are pending the app's passcode unlock. No passcode was entered or bypassed by the agent.

## Validation evidence

- Full gateway run: 730 tests passed; subsequent focused provider/adapter validation (including fast/default mapping): 43 passed.
- Earlier iOS scope/batch/terminal suite: 41 passed. The new provider and short-code test files were then explicitly registered in the Xcode test target; the registered pairing/provider/QR suite executed 14 tests, all passed.
- Terminal manager: 52 passed. Desktop renewal/runtime: 8 passed. Focused web tests: 20 passed. Looping/offscreen/reduced-motion browser tests: 3 passed.
- Desktop/web/server builds and typechecks completed successfully during the implementation. Existing Swift concurrency warnings and the desktop `original-fs` bundler warning remain.
- No release, production deployment, or GitHub CI run was performed. Tests used the local relay and local desktop worktree. Internet/mobile-network latency and all individual upstream providers were not benchmarked.


## Short-code pairing follow-up

The original fresh-install failure was missing relay bootstrap configuration: the short code lookup existed, but the iPhone had no registry address until it had previously received a full QR payload. The iPhone now reads the same `DJL_REMOTE_RELAY_URL` build setting as desktop through Info.plist; Debug Simulator launches can provide the same setting in their environment. The manual form accepts the short code only, with ASCII keyboard, capitalization, and whitespace/hyphen normalization. The desktop copies the short code rather than exposing the RMX1 payload.

This session configures the Simulator to the existing local relay at `ws://127.0.0.1:8799/relay`. A published iPhone build still needs the actual public relay address supplied at build time; no production endpoint was invented or deployed. Final live pairing remains subject to unlocking DJL's Simulator passcode screen.

The registered short-code/provider/QR run passed 14 tests with zero failures/skips. Desktop short-code copy and renewal browser coverage passed 4 tests; relay coverage passed 16 tests. The built Simulator Info.plist was inspected and contains the matching local relay URL.
