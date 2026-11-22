import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { MultiPostRuntimeContext } from "@djl/contracts";
import { DesktopMultiPostRuntime } from "./runtime";

const fixture = vi.hoisted(() => ({
  window: undefined as unknown as ReturnType<typeof createWindow>,
}));
vi.mock("electron", () => ({
  app: { getName: () => "DJL", userAgentFallback: "Chrome/144.0.0.0" },
  BrowserWindow: vi.fn(function () {
    return fixture.window;
  }),
  session: {
    fromPartition: () => ({
      setUserAgent: vi.fn(),
      setPermissionRequestHandler: vi.fn(),
      setPermissionCheckHandler: vi.fn(),
    }),
  },
  net: { isOnline: () => true },
  powerMonitor: { on: vi.fn(), removeListener: vi.fn() },
}));
const context = {
  scope: { workspaceId: "qa", threadId: "qa", authorizedRoot: "/private/tmp" },
  account: { id: "qa", platformKey: "instagram", label: "QA" },
  job: {
    id: "qa",
    adapterId: "DYNAMIC_INSTAGRAM",
    dueAt: new Date().toISOString(),
    target: {},
    snapshot: { data: { title: "QA" } },
  },
} as MultiPostRuntimeContext;
let runtime: DesktopMultiPostRuntime;
function createWindow() {
  return {
    isDestroyed: () => false,
    destroy: vi.fn(),
    on: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    loadURL: vi.fn(() => new Promise<void>(() => {})),
    webContents: {
      getURL: () => "",
      isLoading: () => true,
      setWindowOpenHandler: vi.fn(),
      debugger: { isAttached: () => true, sendCommand: vi.fn(async () => {}) },
      stop: vi.fn(),
      executeJavaScript: vi.fn(async (_script: string): Promise<unknown> => true),
    },
  };
}
beforeEach(() => {
  fixture.window = createWindow();
  runtime = new DesktopMultiPostRuntime();
});
afterEach(() => {
  runtime.dispose();
  vi.useRealTimers();
});
it("opens an already-loading execution window without replacing its navigation", async () => {
  void runtime.open(context);
  await Promise.resolve();
  expect(fixture.window.loadURL).not.toHaveBeenCalled();
  expect(fixture.window.show).toHaveBeenCalledOnce();
});
it("bounds stalled platform navigation within the preparation deadline", async () => {
  vi.useFakeTimers();
  let failure: Error | undefined;
  void runtime.prepare(context).catch((error) => {
    failure = error;
  });
  await vi.advanceTimersByTimeAsync(120_001);
  expect(failure?.message).toMatch(/preparation timed out/i);
  expect(fixture.window.webContents.stop).toHaveBeenCalledOnce();
});
it("does not run preparation if navigation completes after its deadline", async () => {
  vi.useFakeTimers();
  let finish!: () => void;
  fixture.window.loadURL.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  void runtime.prepare(context).catch(() => {});
  await vi.advanceTimersByTimeAsync(120_001);
  finish();
  await vi.waitFor(() =>
    expect(fixture.window.webContents.executeJavaScript).toHaveBeenCalledTimes(1),
  );
  // Only the cancellation script may run, never a late adapter preparation.
  expect(fixture.window.webContents.executeJavaScript.mock.calls[0]?.[0]).toContain("?.cancel()");
  await vi.advanceTimersByTimeAsync(100);
  expect(fixture.window.webContents.executeJavaScript).toHaveBeenCalledTimes(1);
});
it("verifies the reopened execution page after a desktop restart", async () => {
  fixture.window.webContents.getURL = () => "https://www.instagram.com/p/qa_new/";
  fixture.window.webContents.executeJavaScript.mockResolvedValue({
    state: "published",
    postUrl: "https://www.instagram.com/p/qa_new/",
  });
  await runtime.open(context);
  await expect(runtime.verify(context)).resolves.toMatchObject({
    state: "published",
    postUrl: "https://www.instagram.com/p/qa_new/",
  });
});
it("waits for Instagram's asynchronous share confirmation without resubmitting", async () => {
  vi.useFakeTimers();
  fixture.window.webContents.getURL = () => "https://www.instagram.com/";
  fixture.window.webContents.executeJavaScript
    .mockResolvedValueOnce({ state: "uncertain" })
    .mockResolvedValue({ state: "published", message: "Instagram confirmed sharing." });
  await runtime.open(context);
  const result = runtime.verify({
    ...context,
    job: { ...context.job, submittedAt: new Date().toISOString() },
  });
  await vi.advanceTimersByTimeAsync(1000);
  await expect(result).resolves.toMatchObject({ state: "published" });
  expect(fixture.window.loadURL).not.toHaveBeenCalled();
});
