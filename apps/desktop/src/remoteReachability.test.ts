import { describe, expect, it } from "vitest";

import {
  DEFAULT_REMOTE_REACHABILITY_PREFERENCES,
  LOGIN_HIDDEN_ARG,
  createStayAwakeController,
  launchedHiddenAtLogin,
  mergeRemoteReachabilityPreferences,
  openAtLoginSupported,
  parseRemoteReachabilityPreferences,
  phonePairedFromChildMessage,
  remoteReachabilityState,
  shouldStayAwake,
} from "./remoteReachability";

const base = {
  mode: "pluggedIn",
  remoteEnabled: true,
  phonePaired: true,
  phoneConnected: false,
  onBattery: false,
} as const;

describe("shouldStayAwake", () => {
  it("keeps a paired computer awake on power, and lets it sleep on battery", () => {
    expect(shouldStayAwake(base)).toBe(true);
    expect(shouldStayAwake({ ...base, onBattery: true })).toBe(false);
  });

  it("stays awake on battery too when the user chose always", () => {
    expect(shouldStayAwake({ ...base, mode: "always", onBattery: true })).toBe(true);
  });

  it("never holds the computer awake when the user chose never, or Remote is off", () => {
    expect(shouldStayAwake({ ...base, mode: "never", phoneConnected: true })).toBe(false);
    expect(shouldStayAwake({ ...base, remoteEnabled: false, phoneConnected: true })).toBe(false);
  });

  it("does nothing until a phone is paired", () => {
    expect(shouldStayAwake({ ...base, phonePaired: false })).toBe(false);
    expect(shouldStayAwake({ ...base, mode: "always", phonePaired: false })).toBe(false);
  });

  it("stays awake while a phone is connected, even on battery", () => {
    expect(shouldStayAwake({ ...base, onBattery: true, phoneConnected: true })).toBe(true);
  });
});

const fakeBlocker = () => {
  const started = new Set<number>();
  let next = 0;
  return {
    started,
    calls: [] as string[],
    start(type: "prevent-app-suspension") {
      this.calls.push(`start:${type}`);
      started.add(++next);
      return next;
    },
    stop(id: number) {
      this.calls.push(`stop:${id}`);
      started.delete(id);
    },
    isStarted: (id: number) => started.has(id),
  };
};

describe("stay-awake controller", () => {
  it("holds one block however often it is asked, and releases it", () => {
    const blocker = fakeBlocker();
    const controller = createStayAwakeController(blocker);
    expect(controller.set(true)).toBe(true);
    expect(controller.set(true)).toBe(true);
    expect(blocker.calls).toEqual(["start:prevent-app-suspension"]);
    expect(controller.set(false)).toBe(false);
    expect(controller.set(false)).toBe(false);
    expect(blocker.calls).toEqual(["start:prevent-app-suspension", "stop:1"]);
  });

  it("starts a fresh block if the system dropped the old one", () => {
    const blocker = fakeBlocker();
    const controller = createStayAwakeController(blocker);
    controller.set(true);
    blocker.started.clear();
    expect(controller.isActive()).toBe(false);
    expect(controller.set(true)).toBe(true);
    expect(blocker.calls.filter((call) => call.startsWith("start"))).toHaveLength(2);
  });
});

describe("preferences", () => {
  it("falls back to the defaults for missing or malformed files", () => {
    expect(parseRemoteReachabilityPreferences(null)).toEqual(
      DEFAULT_REMOTE_REACHABILITY_PREFERENCES,
    );
    expect(
      parseRemoteReachabilityPreferences({ keepAwake: "forever", openAtLogin: "yes" }),
    ).toEqual({ keepAwake: "pluggedIn", openAtLogin: false });
    expect(parseRemoteReachabilityPreferences({ keepAwake: "always", openAtLogin: true })).toEqual({
      keepAwake: "always",
      openAtLogin: true,
    });
  });

  it("applies only the valid parts of a change", () => {
    const current = { keepAwake: "pluggedIn", openAtLogin: false } as const;
    expect(mergeRemoteReachabilityPreferences(current, { keepAwake: "never" })).toEqual({
      keepAwake: "never",
      openAtLogin: false,
    });
    expect(
      mergeRemoteReachabilityPreferences(current, { keepAwake: 7, openAtLogin: true }),
    ).toEqual({ keepAwake: "pluggedIn", openAtLogin: true });
    expect(mergeRemoteReachabilityPreferences(current, "nonsense")).toEqual(current);
  });

  it("reports start at login as off where it cannot work", () => {
    const preferences = { keepAwake: "always", openAtLogin: true } as const;
    expect(
      remoteReachabilityState({
        preferences,
        openAtLoginSupported: false,
        stayingAwake: true,
        onBattery: false,
      }),
    ).toEqual({
      keepAwake: "always",
      openAtLogin: false,
      openAtLoginSupported: false,
      stayingAwake: true,
      onBattery: false,
    });
  });
});

const status = (phonePaired: unknown) => ({ type: "status", status: { phonePaired } });

describe("paired phone", () => {
  it("follows the gateway's status and ignores messages that do not say", () => {
    expect(phonePairedFromChildMessage(status(true), false)).toBe(true);
    expect(phonePairedFromChildMessage(status(false), true)).toBe(false);
    expect(phonePairedFromChildMessage(status(undefined), true)).toBe(true);
    expect(phonePairedFromChildMessage({ type: "pairing" }, true)).toBe(true);
    expect(phonePairedFromChildMessage(null, false)).toBe(false);
  });
});

describe("start at login", () => {
  it("stays hidden only when the system launched DJL at login", () => {
    expect(launchedHiddenAtLogin({ platform: "darwin", argv: [], wasOpenedAtLogin: true })).toBe(
      true,
    );
    expect(
      launchedHiddenAtLogin({
        platform: "darwin",
        argv: [LOGIN_HIDDEN_ARG],
        wasOpenedAtLogin: false,
      }),
    ).toBe(false);
    expect(
      launchedHiddenAtLogin({
        platform: "win32",
        argv: ["DJL.exe", LOGIN_HIDDEN_ARG],
        wasOpenedAtLogin: false,
      }),
    ).toBe(true);
    expect(
      launchedHiddenAtLogin({ platform: "win32", argv: ["DJL.exe"], wasOpenedAtLogin: true }),
    ).toBe(false);
    expect(
      launchedHiddenAtLogin({
        platform: "linux",
        argv: [LOGIN_HIDDEN_ARG],
        wasOpenedAtLogin: true,
      }),
    ).toBe(false);
  });

  it("is offered only for an installed app on macOS and Windows", () => {
    expect(openAtLoginSupported({ platform: "darwin", packaged: true })).toBe(true);
    expect(openAtLoginSupported({ platform: "win32", packaged: true })).toBe(true);
    expect(openAtLoginSupported({ platform: "linux", packaged: true })).toBe(false);
    expect(openAtLoginSupported({ platform: "darwin", packaged: false })).toBe(false);
  });
});
