import { StrictMode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render } from "vitest-browser-react";
import { useDesktopReady } from "../hooks/useDesktopReady";

function Shell() {
  useDesktopReady();
  return <button>Startup test shell</button>;
}

afterEach(async () => {
  await cleanup();
  vi.unstubAllGlobals();
});

it("notifies Electron only after the shell commits, including StrictMode replay", async () => {
  const notifyReady = vi.fn(() => {
    expect(document.body.textContent).toContain("Startup test shell");
  });
  vi.stubGlobal("desktopBridge", { notifyReady });
  await render(
    <StrictMode>
      <Shell />
    </StrictMode>,
  );
  await expect.poll(() => notifyReady.mock.calls.length).toBe(1);
});

it("cancels the pending reveal when the shell unmounts", async () => {
  const callbacks = new Map<number, FrameRequestCallback>();
  let nextId = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callbacks.set(++nextId, callback);
    return nextId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => callbacks.delete(id));
  const notifyReady = vi.fn();
  vi.stubGlobal("desktopBridge", { notifyReady });
  const view = await render(<Shell />);
  expect(callbacks.size).toBe(1);
  await view.unmount();
  expect(callbacks.size).toBe(0);
  expect(notifyReady).not.toHaveBeenCalled();
});
