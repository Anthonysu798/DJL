# Sidebar Desktop Update Icon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace DJL's Electron sidebar update text pill with a tested blue circular download icon that appears for newer stable releases and restarts DJL to install once ready.

**Architecture:** Keep the existing Electron updater, canonical `Anthonysu798/DJL` release feed, IPC state subscription, and click handler unchanged. Add one focused presentational component for the compact icon and wire the existing `DesktopUpdateState`-derived tooltip, disabled state, and action into it from `Sidebar.tsx`.

**Tech Stack:** React 19, TypeScript, Tailwind CSS, Base UI tooltip primitives, Vitest, Electron updater IPC.

## Global Constraints

- Production desktop builds continue to use the public `Anthonysu798/DJL` repository as the canonical update source.
- Only a newer, fully published stable release is actionable; drafts and prereleases remain excluded.
- The update remains Electron-only.
- DJL downloads updates in the background and only installation/restart is user-controlled.
- Existing retry, install-watchdog, error-toast, and manual-download fallback behavior must remain intact.
- Add automated regression tests before production code.

---

## File Map

- Create `apps/web/src/components/DesktopUpdateSidebarButton.tsx`: focused visual component for the circular update icon.
- Create `apps/web/src/components/DesktopUpdateSidebarButton.test.tsx`: server-rendered markup tests for ready and busy icon states.
- Create `apps/web/src/components/Sidebar.desktopUpdateIcon.source-audit.test.ts`: integration guard that keeps the sidebar wired to the icon instead of the former text pill.
- Modify `apps/web/src/components/Sidebar.tsx`: replace the existing update text pill with the new icon component while preserving updater state and actions.

### Task 1: Tested compact update icon component

**Files:**
- Create: `apps/web/src/components/DesktopUpdateSidebarButton.tsx`
- Create: `apps/web/src/components/DesktopUpdateSidebarButton.test.tsx`

**Interfaces:**
- Consumes: `SidebarIconButton`, `DownloadIcon`, and `cn`.
- Produces: `DesktopUpdateSidebarButton(props: { label: string; disabled: boolean; busy: boolean; onClick: () => void }): ReactElement`.

- [x] **Step 1: Write the failing component tests**

Create `DesktopUpdateSidebarButton.test.tsx` with two focused cases:

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { DesktopUpdateSidebarButton } from "./DesktopUpdateSidebarButton";

describe("DesktopUpdateSidebarButton", () => {
  it("renders an enabled circular blue download icon when an update is ready", () => {
    const markup = renderToStaticMarkup(
      <DesktopUpdateSidebarButton
        label="Update 1.1.0 is ready. Click to restart and install."
        disabled={false}
        busy={false}
        onClick={vi.fn()}
      />,
    );

    expect(markup).toContain('data-testid="desktop-update-button"');
    expect(markup).toContain(
      'aria-label="Update 1.1.0 is ready. Click to restart and install."',
    );
    expect(markup).toContain("rounded-full");
    expect(markup).toContain("bg-[var(--info)]");
    expect(markup).toContain("<svg");
    expect(markup).not.toContain("disabled");
    expect(markup).not.toContain('aria-busy="true"');
  });

  it("is disabled and exposes busy state while the update downloads", () => {
    const markup = renderToStaticMarkup(
      <DesktopUpdateSidebarButton
        label="Preparing update (42%)"
        disabled
        busy
        onClick={vi.fn()}
      />,
    );

    expect(markup).toContain("disabled");
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain("animate-pulse");
  });
});
```

- [x] **Step 2: Run the test and verify RED**

Run:

```bash
bun run --cwd apps/web test -- src/components/DesktopUpdateSidebarButton.test.tsx
```

Expected: FAIL because `./DesktopUpdateSidebarButton` does not exist.

- [x] **Step 3: Implement the minimal component**

Create `DesktopUpdateSidebarButton.tsx`:

```tsx
import { DownloadIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { SidebarIconButton } from "./SidebarIconButton";

export function DesktopUpdateSidebarButton(props: {
  label: string;
  disabled: boolean;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <SidebarIconButton
      icon={DownloadIcon}
      label={props.label}
      tooltip={props.label}
      tooltipSide="top"
      iconClassName="size-4 text-white"
      data-testid="desktop-update-button"
      disabled={props.disabled}
      aria-busy={props.busy || undefined}
      className={cn(
        "relative size-7 rounded-full bg-[var(--info)] text-white shadow-sm transition-[filter,opacity,transform]",
        props.disabled ? "cursor-not-allowed opacity-70" : "hover:brightness-110 active:scale-95",
        props.busy && "animate-pulse",
      )}
      onClick={props.onClick}
    />
  );
}
```

- [x] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
bun run --cwd apps/web test -- src/components/DesktopUpdateSidebarButton.test.tsx
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit the tested component**

```bash
git add apps/web/src/components/DesktopUpdateSidebarButton.tsx apps/web/src/components/DesktopUpdateSidebarButton.test.tsx
git commit -m "feat: add desktop update sidebar icon"
```

### Task 2: Wire existing updater state into the icon

**Files:**
- Modify: `apps/web/src/components/Sidebar.tsx`
- Create: `apps/web/src/components/Sidebar.desktopUpdateIcon.source-audit.test.ts`

**Interfaces:**
- Consumes: `DesktopUpdateSidebarButton`, `shouldShowDesktopUpdateButton`, `isDesktopUpdateButtonDisabled`, `resolveDesktopUpdateButtonAction`, and `getDesktopUpdateButtonTooltip`.
- Produces: Electron footer behavior where `available`/`downloading` is visible and disabled, `downloaded` is enabled, and clicking the ready control invokes the existing `installUpdate` path.

- [ ] **Step 1: Add the failing sidebar integration audit**

Create `Sidebar.desktopUpdateIcon.source-audit.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sidebarSource = readFileSync(new URL("./Sidebar.tsx", import.meta.url), "utf8");

describe("Sidebar desktop update icon integration", () => {
  it("renders the compact update icon instead of the former text pill", () => {
    expect(sidebarSource).toContain("<DesktopUpdateSidebarButton");
    expect(sidebarSource).not.toContain("desktopUpdateRowButtonClasses");
    expect(sidebarSource).not.toContain("desktopUpdateButtonPresentation");
  });
});
```

- [ ] **Step 2: Run the integration audit and verify RED**

Run:

```bash
bun run --cwd apps/web test -- src/components/Sidebar.desktopUpdateIcon.source-audit.test.ts
```

Expected: FAIL because `Sidebar.tsx` still renders `desktopUpdateRowButtonClasses` and does not use `DesktopUpdateSidebarButton`.

- [ ] **Step 3: Make the minimal sidebar integration change**

In `Sidebar.tsx`:

- Import `DesktopUpdateSidebarButton`.
- Remove the footer-only text-pill presentation variables and classes.
- Compute:

```ts
const desktopUpdateIconBusy =
  installingDesktopUpdate ||
  desktopUpdateState?.status === "available" ||
  desktopUpdateState?.status === "downloading";
```

- Replace the existing tooltip-wrapped text pill with:

```tsx
<DesktopUpdateSidebarButton
  label={desktopUpdateTooltip}
  disabled={desktopUpdateButtonDisabled}
  busy={desktopUpdateIconBusy}
  onClick={handleDesktopUpdateButtonClick}
/>
```

Keep `handleDesktopUpdateButtonClick` unchanged so the downloaded state continues through `persistAppStateNow()` and `window.desktopBridge.installUpdate()`.

- [ ] **Step 4: Run both focused test files and verify GREEN**

Run:

```bash
bun run --cwd apps/web test -- src/components/DesktopUpdateSidebarButton.test.tsx src/components/Sidebar.desktopUpdateIcon.source-audit.test.ts src/components/desktopUpdate.logic.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 5: Commit the integration**

```bash
git add apps/web/src/components/Sidebar.tsx apps/web/src/components/Sidebar.desktopUpdateIcon.source-audit.test.ts
git commit -m "feat: surface ready desktop updates in sidebar"
```

### Task 3: Full verification and live Electron check

**Files:**
- Modify only if verification reveals a defect directly caused by Tasks 1-2.

**Interfaces:**
- Consumes: the completed icon component and sidebar integration.
- Produces: fresh evidence that tests, types, formatting, production builds, and live Electron rendering are valid.

- [ ] **Step 1: Run all web tests**

```bash
bun run --cwd apps/web test
```

Expected: exit code 0 with zero failed tests.

- [ ] **Step 2: Run desktop CI typechecks**

```bash
bun run ci:desktop:typecheck
```

Expected: exit code 0.

- [ ] **Step 3: Run formatting and lint checks**

```bash
bun run ci:desktop:format
bun run ci:desktop:lint
```

Expected: both commands exit 0.

- [ ] **Step 4: Build the web and desktop targets**

```bash
bun run --cwd apps/web build
bun run build:desktop
```

Expected: both commands exit 0.

- [ ] **Step 5: Confirm the canonical release-source regression test**

```bash
bun run --cwd scripts test -- lib/desktop-publish-config.test.ts public-desktop-release.test.ts
```

Expected: tests confirm `Anthonysu798/DJL`, stable release metadata, and updater manifests.

- [ ] **Step 6: Verify Electron development rendering**

Run or reuse:

```bash
bun run dev:desktop
```

Verify the Electron process remains running and the sidebar footer still lays out Settings plus the compact update slot without overflow. If a controlled update-state fixture is available, verify the blue circular download glyph, disabled busy state, tooltip progress, and enabled ready state.

- [ ] **Step 7: Review the final diff**

```bash
git status --short
git diff --check
git diff HEAD~2 -- apps/web/src/components docs/superpowers
```

Expected: only the planned feature, tests, and design/plan documents are present; no unrelated changes.
