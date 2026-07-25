import { describe, expect, it, vi } from "vitest";

import {
  BrowserCommentingLifecycle,
  type BrowserCommentingCommand,
  resolveBrowserCommentingRuntimeTarget,
} from "./browserCommentingLifecycle";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("BrowserCommentingLifecycle", () => {
  it("keeps desired commenting mode pending until the switched tab webview is attached", () => {
    expect(resolveBrowserCommentingRuntimeTarget(true, "tab-2", null)).toEqual({
      enabled: false,
      tabId: null,
    });
    expect(resolveBrowserCommentingRuntimeTarget(true, "tab-2", "tab-2")).toEqual({
      enabled: true,
      tabId: "tab-2",
    });
  });

  it("applies a rapid enable then disable in serialized order", async () => {
    const enabling = deferred();
    const calls: string[] = [];
    const lifecycle = new BrowserCommentingLifecycle(async (tabId, enabled) => {
      calls.push(`${enabled ? "enable" : "disable"}:${tabId}`);
      if (enabled) await enabling.promise;
    });

    const first = lifecycle.reconcile(true, "tab-1", new Set(["tab-1"]));
    const second = lifecycle.reconcile(false, "tab-1", new Set(["tab-1"]));
    await vi.waitFor(() => expect(calls).toEqual(["enable:tab-1"]));
    enabling.resolve();
    await Promise.all([first, second]);
    expect(calls).toEqual(["enable:tab-1", "disable:tab-1"]);
  });

  it("keeps the latest same-tab re-enable last when revisions overlap", async () => {
    const firstEnable = deferred();
    const calls: string[] = [];
    let enableCount = 0;
    const lifecycle = new BrowserCommentingLifecycle(async (tabId, enabled) => {
      calls.push(`${enabled ? "enable" : "disable"}:${tabId}`);
      if (enabled && ++enableCount === 1) await firstEnable.promise;
    });

    const first = lifecycle.reconcile(true, "tab-1", new Set(["tab-1"]));
    const revision = lifecycle.reconcile(true, "tab-1", new Set(["tab-1"]));
    await vi.waitFor(() => expect(calls).toEqual(["enable:tab-1"]));
    firstEnable.resolve();
    await Promise.all([first, revision]);
    expect(calls).toEqual(["enable:tab-1", "enable:tab-1"]);
    expect(lifecycle.activeTabId).toBe("tab-1");
  });

  it("does not fail a current-tab switch when the prior tab was already closed", async () => {
    const command = vi.fn(async () => undefined);
    const lifecycle = new BrowserCommentingLifecycle(command);
    await lifecycle.reconcile(true, "tab-1", new Set(["tab-1"]));
    await lifecycle.reconcile(true, "tab-2", new Set(["tab-2"]));
    expect(command.mock.calls).toEqual([
      ["tab-1", true],
      ["tab-2", true],
    ]);
  });

  it("retries a fresh-tab enable after its about:blank navigation transition rejects", async () => {
    const command = vi
      .fn<BrowserCommentingCommand>()
      .mockRejectedValueOnce(new Error("about:blank context replaced"))
      .mockResolvedValue(undefined);
    const lifecycle = new BrowserCommentingLifecycle(command);
    await expect(lifecycle.reconcile(true, "fresh-tab", new Set(["fresh-tab"]))).rejects.toThrow(
      "about:blank context replaced",
    );
    await expect(
      lifecycle.reconcile(true, "fresh-tab", new Set(["fresh-tab"])),
    ).resolves.toBeUndefined();
    expect(command.mock.calls).toEqual([
      ["fresh-tab", true],
      ["fresh-tab", true],
    ]);
    expect(lifecycle.activeTabId).toBe("fresh-tab");
  });
});
