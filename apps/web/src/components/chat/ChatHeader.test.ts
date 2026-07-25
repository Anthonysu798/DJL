// FILE: ChatHeader.test.ts
// Purpose: Covers chat header presentation helpers that choose thread identity chrome.
// Layer: Component unit tests
// Depends on: ChatHeader pure helpers and Vitest assertions.

import { describe, expect, it } from "vitest";

import { resolveChatHeaderThreadIconKind, resolveHeaderPanelMenuItems } from "./ChatHeader";

describe("resolveChatHeaderThreadIconKind", () => {
  it("uses the terminal icon for terminal-first threads", () => {
    expect(resolveChatHeaderThreadIconKind("terminal")).toBe("terminal");
  });

  it("hides provider branding for chat threads", () => {
    expect(resolveChatHeaderThreadIconKind("chat")).toBe("none");
  });
});

describe("resolveHeaderPanelMenuItems", () => {
  it("keeps Browser available when Diff is unavailable", () => {
    expect(
      resolveHeaderPanelMenuItems({
        browserOpen: false,
        diffOpen: false,
        diffDisabledReason: null,
        isElectron: true,
        isGitRepo: false,
        gitRequiredDetail: "Git repository required",
        desktopRequiredDetail: "Desktop app required",
      }),
    ).toEqual([
      { kind: "browser", active: false, disabled: false },
      {
        kind: "diff",
        active: false,
        disabled: true,
        detail: "Git repository required",
      },
    ]);
  });

  it("explains that Browser requires the desktop app", () => {
    expect(
      resolveHeaderPanelMenuItems({
        browserOpen: false,
        diffOpen: false,
        diffDisabledReason: null,
        isElectron: false,
        isGitRepo: true,
        gitRequiredDetail: "Git repository required",
        desktopRequiredDetail: "Desktop app required",
      })[0],
    ).toEqual({
      kind: "browser",
      active: false,
      disabled: true,
      detail: "Desktop app required",
    });
  });

  it("preserves active panes and current Diff availability reasons", () => {
    expect(
      resolveHeaderPanelMenuItems({
        browserOpen: true,
        diffOpen: true,
        diffDisabledReason: "Waiting for the worktree",
        isElectron: true,
        isGitRepo: true,
        gitRequiredDetail: "Git repository required",
        desktopRequiredDetail: "Desktop app required",
      }),
    ).toEqual([
      { kind: "browser", active: true, disabled: false },
      { kind: "diff", active: true, disabled: false },
    ]);

    expect(
      resolveHeaderPanelMenuItems({
        browserOpen: false,
        diffOpen: false,
        diffDisabledReason: "Waiting for the worktree",
        isElectron: true,
        isGitRepo: true,
        gitRequiredDetail: "Git repository required",
        desktopRequiredDetail: "Desktop app required",
      })[1],
    ).toEqual({
      kind: "diff",
      active: false,
      disabled: true,
      detail: "Waiting for the worktree",
    });
  });
});
