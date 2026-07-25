import { describe, expect, it, vi } from "vitest";

import {
  browserAddressDisplayValue,
  buildBrowserAddressSuggestions,
  normalizeBrowserAddressInput,
  requestBrowserPanelClose,
  restoreOrDisableBrowserAnnotation,
  clearMatchingBrowserError,
  shouldPreserveBrowserCommentingDuringTransitionFailure,
  resolveBrowserChromeStatus,
  resolveBrowserAddressSync,
} from "./BrowserPanel.logic";

describe("browser annotation recovery", () => {
  it("awaits a failed cancel and disables the runtime before allowing UI cleanup", async () => {
    const calls: string[] = [];
    await expect(
      restoreOrDisableBrowserAnnotation(
        async () => {
          calls.push("cancel");
          throw new Error("context gone");
        },
        async () => void calls.push("disable"),
      ),
    ).resolves.toBe("disabled");
    expect(calls).toEqual(["cancel", "disable"]);
  });

  it("keeps recovery blocked when both cancel and disable fail", async () => {
    await expect(
      restoreOrDisableBrowserAnnotation(
        async () => Promise.reject(new Error("cancel failed")),
        async () => Promise.reject(new Error("disable failed")),
      ),
    ).resolves.toBe("failed");
  });

  it("clears only the commenting transition error after a successful retry", () => {
    const transitionError = "Couldn't change browser commenting mode.";
    expect(clearMatchingBrowserError(transitionError, transitionError)).toBeNull();
    expect(clearMatchingBrowserError("Couldn't capture screenshot.", transitionError)).toBe(
      "Couldn't capture screenshot.",
    );
  });

  it("preserves desired mode during a fresh about:blank tab's first real navigation", () => {
    expect(
      shouldPreserveBrowserCommentingDuringTransitionFailure({
        desiredEnabled: true,
        activeTabIsLoading: true,
        activeTabAttached: true,
      }),
    ).toBe(true);
    expect(
      shouldPreserveBrowserCommentingDuringTransitionFailure({
        desiredEnabled: true,
        activeTabIsLoading: false,
        activeTabAttached: true,
      }),
    ).toBe(false);
  });
});

describe("requestBrowserPanelClose", () => {
  it("preserves the editor when discard is cancelled", async () => {
    const closePanel = vi.fn();
    await expect(requestBrowserPanelClose(async () => false, closePanel)).resolves.toBe(false);
    expect(closePanel).not.toHaveBeenCalled();
  });

  it("cleans the editor before a confirmed panel close", async () => {
    const calls: string[] = [];
    await expect(
      requestBrowserPanelClose(
        async () => {
          calls.push("cleanup-preview");
          return true;
        },
        () => calls.push("close-panel"),
      ),
    ).resolves.toBe(true);
    expect(calls).toEqual(["cleanup-preview", "close-panel"]);
  });
});

describe("browserAddressDisplayValue", () => {
  it("hides about:blank for new tabs", () => {
    expect(browserAddressDisplayValue({ url: "about:blank" })).toBe("");
  });

  it("keeps real urls visible", () => {
    expect(browserAddressDisplayValue({ url: "https://x.com/" })).toBe("https://x.com/");
  });
});

describe("resolveBrowserAddressSync", () => {
  it("restores a saved draft when switching to another tab", () => {
    expect(
      resolveBrowserAddressSync({
        activeTabId: "tab-2",
        previousActiveTabId: "tab-1",
        savedDraft: "x.com",
        nextDisplayValue: "",
        lastSyncedValue: "",
        isEditing: false,
      }),
    ).toEqual({
      type: "replace",
      value: "x.com",
      syncedValue: "",
    });
  });

  it("keeps the typed value while the active tab is still being edited", () => {
    expect(
      resolveBrowserAddressSync({
        activeTabId: "tab-2",
        previousActiveTabId: "tab-2",
        savedDraft: "x.com",
        nextDisplayValue: "",
        lastSyncedValue: "",
        isEditing: true,
      }),
    ).toEqual({
      type: "keep",
    });
  });

  it("updates the input when a submitted navigation resolves to a new url", () => {
    expect(
      resolveBrowserAddressSync({
        activeTabId: "tab-2",
        previousActiveTabId: "tab-2",
        savedDraft: "x.com",
        nextDisplayValue: "https://x.com/",
        lastSyncedValue: "",
        isEditing: false,
      }),
    ).toEqual({
      type: "replace",
      value: "https://x.com/",
      syncedValue: "https://x.com/",
    });
  });
});

describe("normalizeBrowserAddressInput", () => {
  it("adds https to naked domains", () => {
    expect(normalizeBrowserAddressInput("phodex.app")).toBe("https://phodex.app/");
  });

  it("turns spaced text into a search url", () => {
    expect(normalizeBrowserAddressInput("how to bake bread")).toContain(
      "https://www.google.com/search?q=how%20to%20bake%20bread",
    );
  });
});

describe("buildBrowserAddressSuggestions", () => {
  it("hides blank tabs and surfaces direct navigation", () => {
    const suggestions = buildBrowserAddressSuggestions({
      query: "open",
      activeTabId: "tab-1",
      tabs: [
        {
          id: "tab-1",
          title: "New tab",
          url: "about:blank",
          faviconUrl: null,
          lastCommittedUrl: null,
        },
        {
          id: "tab-2",
          title: "OpenAI",
          url: "https://openai.com/",
          faviconUrl: null,
          lastCommittedUrl: "https://openai.com/",
        },
      ],
      recentHistory: [
        {
          url: "about:blank",
          title: "Blank",
          tabId: "tab-1",
        },
        {
          url: "https://news.ycombinator.com/",
          title: "Hacker News",
          tabId: "tab-3",
        },
      ],
    });

    expect(suggestions[0]).toMatchObject({
      kind: "navigate",
      url: "https://www.google.com/search?q=open",
    });
    expect(suggestions.some((suggestion) => suggestion.url === "about:blank")).toBe(false);
    expect(suggestions.some((suggestion) => suggestion.url === "https://openai.com/")).toBe(true);
  });
});

describe("resolveBrowserChromeStatus", () => {
  it("surfaces recoverable browser errors ahead of idle state", () => {
    expect(
      resolveBrowserChromeStatus({
        localError: "Couldn't complete that browser action.",
        threadLastError: null,
        activeTabStatus: "ready",
        hasActiveTab: true,
        workspaceReady: true,
      }),
    ).toEqual({
      tone: "error",
      label: "Couldn't complete that browser action.",
    });
  });

  it("does not duplicate the current url when a page is loaded", () => {
    expect(
      resolveBrowserChromeStatus({
        localError: null,
        threadLastError: null,
        activeTabStatus: "ready",
        hasActiveTab: true,
        workspaceReady: true,
      }),
    ).toBeNull();
  });

  it("keeps onboarding copy for empty browser states", () => {
    expect(
      resolveBrowserChromeStatus({
        localError: null,
        threadLastError: null,
        activeTabStatus: "suspended",
        hasActiveTab: false,
        workspaceReady: false,
      }),
    ).toEqual({
      tone: "default",
      label: "Starting browser...",
    });
  });
});
