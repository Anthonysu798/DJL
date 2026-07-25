# Panels Browser Launcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the header's disabled Diff-only toggle with an always-available Panels menu that opens or focuses the existing Browser right-dock pane and preserves Diff access.

**Architecture:** Add a small shared right-dock menu-content component driven by the canonical pane metadata, then use it from both the dock's Add panel menu and the chat header. Pass an explicit open-only Browser callback through `ChatView` and the route surfaces so menu selection never toggles an existing Browser pane closed.

**Tech Stack:** React 19, TypeScript, Base UI Menu, Zustand right-dock state, Vitest unit/browser tests.

## Global Constraints

- Reuse `BrowserPanel`, `useRightDockStore`, and existing pane hydration; do not create a new browser runtime.
- Preserve `browser.toggle` and `diff.toggle` keyboard shortcuts.
- Keep the launcher enabled when Diff is unavailable; disable only the affected menu item.
- Disable Browser outside Electron with visible `Desktop app required` detail.
- Preserve single-chat and split-chat behavior.
- Do not run `bun fmt`, `bun lint`, or `bun typecheck` unless explicitly requested.
- Never run `bun test`; use `bun run test`.

---

### Task 1: Shared right-dock menu content

**Files:**

- Create: `apps/web/src/components/chat/RightDockPaneMenuItems.tsx`
- Create: `apps/web/src/components/chat/RightDockPaneMenuItems.browser.tsx`
- Modify: `apps/web/src/components/chat/RightDock.tsx`

**Interfaces:**

- Consumes: `RightDockPaneKind` and `getRightDockPaneMeta(kind)`.
- Produces: `RightDockPaneMenuItems({ items, onSelect })`, where each item contains `kind`, optional `active`, optional `disabled`, and optional `detail`.

- [x] **Step 1: Write a failing browser test**

Render `RightDockPaneMenuItems` in a Base UI `Menu` and verify Browser/Diff labels, disabled detail, keyboard-selectable enabled items, and active indication.

- [x] **Step 2: Run the test and verify RED**

Run: `bun run --cwd apps/web test:browser src/components/chat/RightDockPaneMenuItems.browser.tsx`

Expected: failure because the shared component does not exist.

- [x] **Step 3: Implement the shared component**

Use the canonical pane metadata for icons and labels. Render `detail` as trailing muted text and an active check when no detail is present. Forward selection through `onSelect(kind)` and pass `disabled` to `MenuItem`.

- [x] **Step 4: Reuse it in RightDock**

Replace the inline `addMenuKinds.map(...)` block with `RightDockPaneMenuItems`, preserving current ordering and `onAddPane` behavior.

- [x] **Step 5: Run the focused browser and metadata tests**

Run:

- `bun run --cwd apps/web test:browser src/components/chat/RightDockPaneMenuItems.browser.tsx`
- `bun run --cwd apps/web test src/components/chat/rightDockPaneMeta.test.ts`

Expected: all selected tests pass.

---

### Task 2: Header Panels menu and open-only Browser action

**Files:**

- Modify: `apps/web/src/components/chat/ChatHeader.tsx`
- Modify: `apps/web/src/components/ChatView.tsx`
- Modify: `apps/web/src/routes/_chat.$threadId.tsx`
- Modify: `apps/web/src/components/chat/ChatHeader.test.ts`
- Modify or create focused route/store tests where needed.

**Interfaces:**

- Add `browserOpen: boolean` and `onOpenBrowser: () => void` to `ChatHeaderProps`.
- Add `onOpenBrowserPanel?: () => void` to `ChatViewProps`.
- Add `onOpenBrowser: () => void` to `DeferredChatView` and route surface props.

- [x] **Step 1: Write failing unit tests for menu item state**

Extract and test a pure `resolveHeaderPanelMenuItems` helper. Verify:

- Browser is enabled in Electron and disabled with `Desktop app required` outside Electron.
- Diff is disabled for non-Git repositories or a current disabled reason.
- Browser remains enabled when Diff is disabled.
- Active state follows `browserOpen` and `diffOpen`.

- [x] **Step 2: Run the unit test and verify RED**

Run: `bun run --cwd apps/web test src/components/chat/ChatHeader.test.ts`

Expected: failure because the resolver and menu behavior do not exist.

- [x] **Step 3: Replace the Diff-only toggle with the Panels menu**

Use the existing header control classes and `PanelRightCloseIcon` as the trigger. Set `aria-label` and title to `Open panels menu`. Render Browser and Diff using `RightDockPaneMenuItems`; Browser calls `onOpenBrowser`, Diff calls `onToggleDiff`. Keep the launcher enabled regardless of either item's availability.

- [x] **Step 4: Add an open-only Browser callback in ChatView**

When `onOpenBrowserPanel` exists, call it unconditionally. In the search-parameter fallback, navigate to `panel: "browser"` only when it is not already open. Keep the existing toggle callback exclusively for the keyboard/menu toggle command.

- [x] **Step 5: Wire open-only behavior through routes**

For the single right dock, request immediate Browser hydration and call `openPane(threadId, { kind: "browser" })`. For split panes, update the pane panel state to `{ panel: "browser" }`. Pass the callback through every `DeferredChatView` mount, including placeholder/no-op editor surfaces.

- [x] **Step 6: Run focused tests**

Run:

- `bun run --cwd apps/web test src/components/chat/ChatHeader.test.ts src/rightDockStore.logic.test.ts`
- `bun run --cwd apps/web test:browser src/components/chat/RightDockPaneMenuItems.browser.tsx`

Expected: all selected tests pass.

---

### Task 3: Verification and integration

**Files:**

- Review all files changed in Tasks 1–2.

- [x] **Step 1: Inspect the diff**

Confirm no browser manager, CDP bridge, keybinding, sizing, or disclosure animation code changed.

- [x] **Step 2: Run the final focused verification**

Run the focused web unit and browser commands from Tasks 1–2. Do not run the heavyweight workspace format/lint/typecheck commands.

- [x] **Step 3: Perform rendered QA in an isolated desktop-safe environment if available**

Verify the target flow: chat header → Panels menu → Browser → existing Browser right-dock pane. Confirm Diff-only disabled state no longer disables the launcher and Browser is disabled in a non-Electron surface.

- [ ] **Step 4: Commit the worktree changes**

Commit with: `feat(web): add browser panel launcher menu`

- [ ] **Step 5: Merge into `feat/djl-work` and re-run focused verification**

Integrate without overwriting the dirty checkout's unrelated user changes. Resolve only feature-owned overlaps, retain user work, then remove the owned worktree and delete the merged feature branch.
