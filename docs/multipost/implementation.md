# DJL MultiPost implementation specification

Approved 2026-11-05. Source: leaperone/MultiPost-Extension commit 5522ca01100a58572de3a652aebd7851f5fa648a, Apache-2.0.

## Acceptance

- Embed all 110 public adapters (31 dynamic,42 article,30 video,7 podcast),16 identity resolvers and platform configuration; no proprietary Agent or hosted upstream API dependency.
- Desktop macOS/Windows first; local workspace ownership without Cloud login, isolated persistent multi-account sessions.
- Independent DJL MultiPost workbench linked to chat and existing marketing media/brand/video tools.
- UI,MCP,local HTTP call one versioned service. Default explicit per-batch review; UI-only standing grants bound to workflow revision/accounts/kinds/expiry/day limit/timezone.
- prepare,submit,verify; check identity and consent before irreversible submit; atomically reserve quota per target; uncertain sends never automatically retry.
- Tray background; explicit quit stops; overdue offline/sleep jobs become missed and require user action. Native platform schedule acceptance is not publication, and cancellation requires platform evidence.
- New jobs only use MultiPost. Existing confirmed Cloud tasks drain unchanged; historical cloud review/report/tracking links remain under original owners. Imported drafts require new identity mapping/review.
- Dedicated authenticated scoped Streamable HTTP DJL multipost mcp (djl-multipost/djl_multipost), plus five packaged Skills. Work MCP/computer tools remain separate.
- SDD and TDD; real SQLite/MCP/browser integration; adapter DOM fixtures; packaged Mac/Windows checks; Computer Use actual application E2E; representative live accounts need account/content approval before publishing.

## Task ledger

1. Shared contracts,source provenance and adapter runtime.
2. SQLite drafts/accounts/workflows/grants,queue and state machine.
3. Isolated desktop browser host and tray lifecycle.
4. Independent MCP,Skills and Agent registrations.
5. Workbench and legacy compatibility.
6. Integration,regression,Computer Use,packaging and evidence.

## Baseline

Original checkout remains untouched. Snapshot includes its pre-existing modified/untracked source, excluding secrets,caches,nested worktrees. No unrelated changes are to be committed.
Targeted social baseline before implementation: 3 files,4 tests pass; initial sandbox localhost EPERM was resolved by rerunning outside sandbox.

## Implementation record

Implementation is isolated on `codex/djl-multipost` in the managed `djl-multipost/Production_DJL` worktree. The original source checkout has not been edited, reset, cleaned or stashed. No commit, push, deployment or release is included.

- All 110 pinned adapters and 16 original identity resolvers are embedded. DJL additionally checks own-profile identities for Instagram, LinkedIn, Threads and YouTube, and binds Webhook identity to its configured destination. Unsupported identity resolution requires manual final platform steps.
- The upstream AST adaptation retains original source bytes separately. It defers final submit paths, preserves early validation guards and Boolean preparation results, and awaits upstream asynchronous preparation. CSDN's unconditional public publish API is deferred as a complete publisher; it cannot execute during preparation.
- One SQLite service implements revisions, exact approval, workflow-bound grants, atomic per-target quotas, immutable job snapshots, deduplication, cancellation and conservative recovery. Disconnecting a profile revokes its grants and stops pending jobs before browser cleanup. Editing a draft aborts active older revisions; the final asynchronous identity check is followed by a fresh revision/authorization check. Tasks already overdue when execution restarts require review, including short app exits.
- The authenticated scoped `djl-multipost` endpoint remains separate from DJL Work Tools. Codex, Claude, OpenCode and tool-capable Cloud registration paths are integrated. Only local Codex was exercised with a real product Agent during this acceptance.
- Five real packaged Skills are validated. UI, chat, MCP and local API use the same state/service. Seven locale catalogs cover the new workbench; translations remain subject to human linguistic review.
- Imported legacy campaigns keep the selected original or recipe-rendered media and the rendered file's real MIME/name. Cloud OAuth/approval is not transferred; existing confirmed Cloud tasks keep their executor/owner.
- Closing the main window retains background execution; explicit Quit stops. Native schedule acceptance, delivery acknowledgements, uncertain submissions and proven publication remain distinct. Existing post links and old schedule notices cannot prove new publication.

## Specification-driven and test-driven checks

The specification and source matrix preceded implementation. Red-to-green cycles covered unauthorized approval, scoped data, version changes, quota/revocation, identity changes, missed schedules, offset normalization, exact media preservation, authenticated MCP, abort propagation, router navigation, repeat-review UI, native lifecycle, legacy image rendering metadata and packaged resources. All 110 Chromium fixtures now verify content filling, denied host consent and the adapter's authorized deferred/manual path; they assert preparation errors as failures rather than accepting partial filling.

The user explicitly chose **local acceptance only**, with no representative live platform account. The actual DJL Electron Agent selected MultiPost Skills, called the independent MCP, saved exact drafts, displayed review cards, and sent approved immediate/scheduled messages to a disposable loopback test site. The site and SQLite records retain provider evidence. See [acceptance](acceptance.md) for current test conclusions and limitations.

## Remaining external validation boundaries

- Real social platforms, CAPTCHA/login workflows and live account identity/cancellation need representative test accounts and content approval. Fixture parity is not current-platform certification.
- Windows native packaging/session/tray execution needs a Windows runner. macOS package smoke is recorded separately from development E2E.
- Whole-repository pre-existing formatting/branding/history-test failures are recorded separately and are not silently fixed or reported green.
- Media files currently have a 100 MiB per-file limit; larger uploads are not qualified.
