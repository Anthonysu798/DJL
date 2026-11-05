import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => {
  type Listener = (_event: unknown, action: unknown) => void;
  const listeners = new Map<string, Set<Listener>>();
  return {
    listeners,
    bridge: null as {
      onMenuAction: (listener: (action: string) => void, actions?: readonly string[]) => () => void;
    } | null,
    expose: vi.fn(),
    ipc: {
      on: vi.fn((channel: string, listener: Listener) => {
        const channelListeners = listeners.get(channel) ?? new Set<Listener>();
        channelListeners.add(listener);
        listeners.set(channel, channelListeners);
      }),
      removeListener: vi.fn((channel: string, listener: Listener) => {
        listeners.get(channel)?.delete(listener);
      }),
      send: vi.fn(),
      sendSync: vi.fn(),
      invoke: vi.fn(),
    },
  };
});

vi.mock("electron", () => ({
  contextBridge: { exposeInMainWorld: fixture.expose },
  ipcRenderer: fixture.ipc,
}));

function receive(action: unknown) {
  for (const listener of fixture.listeners.get("desktop:menu-action") ?? []) {
    listener({}, action);
  }
}

function subscribe(listener: (action: string) => void, actions?: readonly string[]) {
  if (!fixture.bridge) throw new Error("AI preload did not expose its bridge");
  return fixture.bridge.onMenuAction(listener, actions);
}

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  fixture.listeners.clear();
  fixture.bridge = null;
  fixture.expose.mockImplementation((name, bridge) => {
    if (name === "desktopBridge") fixture.bridge = bridge;
  });
  await import("./preload");
});

describe("AI preload menu delivery during window restoration", () => {
  it("delivers the first shortcuts command after its owner mounts, not to an unrelated subscriber", () => {
    receive("show-shortcuts"); // did-finish-load precedes the React effects.
    const unrelated = vi.fn();
    subscribe(unrelated, ["toggle-sidebar", "open-settings"]);
    const legacy = vi.fn();
    subscribe(legacy);
    expect(unrelated).not.toHaveBeenCalled();
    expect(legacy).not.toHaveBeenCalled();

    const shortcuts = vi.fn();
    subscribe(shortcuts, ["show-shortcuts"]);
    expect(shortcuts).toHaveBeenCalledExactlyOnceWith("show-shortcuts");
  });

  it.each(["toggle-sidebar", "open-settings"])(
    "retains the initial global %s command",
    (action) => {
      receive(action);
      const owner = vi.fn();
      subscribe(owner, ["toggle-sidebar", "open-settings"]);
      expect(owner).toHaveBeenCalledExactlyOnceWith(action);
    },
  );

  it("consumes pending commands once across effect cleanup and remount", () => {
    receive("show-shortcuts");
    const owner = vi.fn();
    const unsubscribe = subscribe(owner, ["show-shortcuts"]);
    unsubscribe();
    subscribe(owner, ["show-shortcuts"]);
    expect(owner).toHaveBeenCalledTimes(1);
  });

  it("preserves repeated live broadcasts and unsubscribe behavior", () => {
    const owner = vi.fn();
    const legacy = vi.fn();
    const unsubscribe = subscribe(owner, ["show-shortcuts"]);
    subscribe(legacy);
    receive("show-shortcuts");
    receive("show-shortcuts");
    expect(owner).toHaveBeenCalledTimes(2);
    expect(legacy).toHaveBeenCalledTimes(2);
    unsubscribe();
    receive("show-shortcuts");
    expect(owner).toHaveBeenCalledTimes(2);
    expect(legacy).toHaveBeenCalledTimes(3);
    subscribe(owner, ["show-shortcuts"]);
    expect(owner).toHaveBeenCalledTimes(2);
  });

  it("does not replay route-dependent browser, terminal or notification actions later", () => {
    for (const action of ["toggle-browser", "new-terminal-tab", "notification-open-thread:demo"]) {
      receive(action);
    }
    const owner = vi.fn();
    subscribe(owner, ["toggle-browser", "new-terminal-tab", "notification-open-thread:demo"]);
    expect(owner).not.toHaveBeenCalled();
    receive("new-terminal-tab");
    expect(owner).toHaveBeenCalledExactlyOnceWith("new-terminal-tab");
  });

  it("keeps subscriptions independent even when they share the same callback", () => {
    const owner = vi.fn();
    const unsubscribe = subscribe(owner, ["show-shortcuts"]);
    subscribe(owner, ["show-shortcuts"]);
    receive("show-shortcuts");
    expect(owner).toHaveBeenCalledTimes(2);
    unsubscribe();
    receive("show-shortcuts");
    expect(owner).toHaveBeenCalledTimes(3);
  });

  it("tracks startup readiness per action rather than per first subscriber", () => {
    subscribe(vi.fn(), ["show-shortcuts"]);
    receive("open-settings");
    const owner = vi.fn();
    subscribe(owner, ["toggle-sidebar", "open-settings"]);
    expect(owner).toHaveBeenCalledExactlyOnceWith("open-settings");
  });

  it("keeps initial commands ordered without collapsing intentional repeated toggles", () => {
    receive("toggle-sidebar");
    receive("open-settings");
    receive("toggle-sidebar");
    const owner = vi.fn();
    subscribe(owner, ["toggle-sidebar", "open-settings"]);
    expect(owner.mock.calls.map(([action]) => action)).toEqual([
      "toggle-sidebar",
      "open-settings",
      "toggle-sidebar",
    ]);
  });

  it("removes pending work before invoking a handler and never retries thrown work", () => {
    receive("show-shortcuts");
    const failure = new Error("handler failed");
    expect(() =>
      subscribe(() => {
        throw failure;
      }, ["show-shortcuts"]),
    ).toThrow(failure);
    const next = vi.fn();
    subscribe(next, ["show-shortcuts"]);
    expect(next).not.toHaveBeenCalled();
  });

  it("ignores malformed IPC payloads", () => {
    for (const value of [null, undefined, 42, {}, ["show-shortcuts"]]) receive(value);
    const owner = vi.fn();
    subscribe(owner, ["show-shortcuts"]);
    expect(owner).not.toHaveBeenCalled();
    receive("show-shortcuts");
    expect(owner).toHaveBeenCalledExactlyOnceWith("show-shortcuts");
  });
});
