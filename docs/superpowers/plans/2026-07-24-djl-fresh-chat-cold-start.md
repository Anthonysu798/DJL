# DJL Fresh Chat Cold-Start Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every DJL launch opens a blank, immediately usable chat; the first prompt creates a valid new OpenCode session and is accepted within five seconds.

**Architecture:** Keep the initial chat as a lightweight local draft, prewarm one shared managed OpenCode server in the background, and create the native session atomically on first send. Historical chats remain accessible, with automatic recovery when their saved OpenCode session no longer exists.

**Tech Stack:** Electron, React, TanStack Router, Effect, Vitest, OpenCode SDK.

## Global Constraints

- DJL is the only user-facing product name.
- The main chat route always opens a fresh, blank home-chat draft.
- A native OpenCode session is created only when the first prompt is sent.
- Historical chats remain available from the sidebar and recover safely from stale native sessions.

---

## Implementation Changes

- [ ] Change the main `/` route to always create a fresh blank home-chat draft. It must skip `lastThreadRoute`, split-view restoration, the 1.8-second recovery delay, and old unsent drafts. Sent chats remain in the sidebar; DJL Work restoration remains unchanged.
- [ ] Keep model selection cache-first. Show the composer immediately with the last usable model, or an immediate “Configure a model” action when none exists. Do not create an empty durable thread or OpenCode session merely by launching DJL.
- [ ] Prewarm managed OpenCode shortly after server startup instead of waiting 20 seconds. Pool managed OpenCode servers by binary, configuration, credentials, and transport—not working directory—and use a directory-scoped SDK client for each chat. Concurrent discovery and first-send requests must join the same single-flight startup.
- [ ] On first send, promote the draft, create a fresh OpenCode session, persist its new resume cursor, and submit the prompt through one ordered server operation. The click must remain queued while startup completes rather than being ignored or requiring a tab switch.
- [ ] Validate historical OpenCode resume cursors before declaring a session ready. If `session.get` returns the specific 404 “Session not found,” create a replacement session and persist its ID. Other validation failures must remain visible errors.
- [ ] Add a defensive one-time recovery for the same 404 during `session.promptAsync`: clear the dead cursor, start a fresh session, bootstrap it from DJL’s stored transcript, and resend once. Never retry generic provider errors.

## Interfaces and Compatibility

- [ ] No new public WebSocket RPC is required.
- [ ] Give the shared route bootstrap an explicit internal mode: fresh home chat versus remembered-route restoration. Only DJL Work continues using restoration.
- [ ] Add one shared OpenCode “session not found” classifier used by startup validation and the one-time prompt recovery.
- [ ] Preserve existing saved chats, model credentials, model catalog data, and local-model storage. Existing `lastThreadRoute` data remains useful for navigation within a running app but is ignored on main-app launch.

## Tests and Acceptance Criteria

- [ ] Web tests: a saved old route is never opened from `/`; stale-route recovery is not invoked; React Strict Mode creates only one fresh draft; an old unsent draft is replaced; sent chats remain selectable; DJL Work still restores its last task.
- [ ] Runtime tests: different working directories reuse one managed OpenCode server while receiving correctly scoped clients; concurrent discovery and first-send startup create one process; configuration or credential revisions still rotate the pool safely.
- [ ] Provider tests: valid resume succeeds; missing resume creates and persists a replacement; permission-update incompatibility remains nonfatal only after validation; non-404 validation errors do not report ready.
- [ ] Orchestration tests: a first prompt uses the new session ID; prompt-time stale recovery retries once with transcript context; no generic retry or duplicate user turn occurs.
- [ ] Isolated Windows Electron E2E: seed an old DJL chat and dead OpenCode cursor, restart DJL, confirm a blank new chat appears, send within five seconds, and receive streamed output. Then explicitly open the historical chat and verify transparent session replacement.
- [ ] Performance targets for the packaged Windows build:
  - Blank composer visible within one second after renderer connection.
  - Cached models visible immediately.
  - First prompt accepted by a valid OpenCode session within five seconds of clicking Send.
  - No `Session not found`, ignored send, tab-switch workaround, duplicate OpenCode process, or automatic reopening of an old chat.
  - Response completion time is excluded because it depends on the selected model/provider.

## Verification

- [ ] Run focused web browser, OpenCode runtime, adapter, and orchestration tests first.
- [ ] Run the isolated Electron cold-start E2E twice: once with an empty profile and once with persisted stale state.
- [ ] Build the Windows desktop artifact and rerun the packaged cold-start scenario before any release, commit, push, or VPS publication.
