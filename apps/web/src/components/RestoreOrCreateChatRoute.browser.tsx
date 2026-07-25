// FILE: RestoreOrCreateChatRoute.browser.tsx
// Purpose: Guards cold-start route recovery against React Strict Mode remount stalls.
// Layer: Browser component tests

import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "vitest-browser-react";

import { useSplitViewStore } from "../splitViewStore";
import { useStore } from "../store";
import { RestoreOrCreateChatRoute } from "./RestoreOrCreateChatRoute";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(async () => undefined),
  refreshSnapshot: vi.fn(async () => false),
  waitForFallback: vi.fn(async () => undefined),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => mocks.navigate,
}));

vi.mock("../chatRouteRecovery", () => ({
  refreshEmptyRouteRestoreSnapshot: mocks.refreshSnapshot,
  waitForEmptyRouteRestoreFallbackDelay: mocks.waitForFallback,
}));

vi.mock("../nativeApi", () => ({
  readNativeApi: () => undefined,
}));

const SIDEBAR_UI_STATE_STORAGE_KEY = "synara:sidebar-ui:v1";

describe("RestoreOrCreateChatRoute", () => {
  beforeEach(() => {
    window.localStorage.setItem(
      SIDEBAR_UI_STATE_STORAGE_KEY,
      JSON.stringify({ lastThreadRoute: { threadId: "removed-thread" } }),
    );
    useStore.setState({
      threadsHydrated: true,
      threadIds: [],
      threads: [],
    });
    useSplitViewStore.setState({
      hasHydrated: true,
      splitViewsById: {},
      splitViewIdBySourceThreadId: {},
    });
    mocks.navigate.mockClear();
    mocks.refreshSnapshot.mockClear();
    mocks.waitForFallback.mockClear();
  });

  afterEach(async () => {
    await cleanup();
    window.localStorage.removeItem(SIDEBAR_UI_STATE_STORAGE_KEY);
  });

  it("falls back to a fresh chat after stale-route recovery under Strict Mode", async () => {
    const createFreshChat = vi.fn(async () => ({ ok: true }) as const);

    await render(
      <StrictMode>
        <RestoreOrCreateChatRoute
          resolveRestoreRoute={() => null}
          createFreshChat={createFreshChat}
        />
      </StrictMode>,
    );

    await expect.poll(() => mocks.refreshSnapshot.mock.calls.length).toBeGreaterThanOrEqual(1);
    await expect.poll(() => createFreshChat.mock.calls.length).toBe(1);
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("creates a fresh home chat without recovering a remembered route in fresh mode", async () => {
    const createFreshChat = vi.fn(async () => ({ ok: true }) as const);

    await render(
      <StrictMode>
        <RestoreOrCreateChatRoute
          mode="fresh"
          resolveRestoreRoute={() => ({ threadId: "removed-thread" })}
          createFreshChat={createFreshChat}
        />
      </StrictMode>,
    );

    await expect.poll(() => createFreshChat.mock.calls.length).toBe(1);
    expect(mocks.refreshSnapshot).not.toHaveBeenCalled();
    expect(mocks.waitForFallback).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
