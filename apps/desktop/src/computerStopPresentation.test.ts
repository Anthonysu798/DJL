import { Script } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import type { BrowserWindow, IpcMain, IpcMainEvent } from "electron";
import { ComputerStopPresentation, computerStopWindowOptions } from "./computerStopPresentation";
import { COMPUTER_STOP_CHANNELS } from "./computerStopChannels";

function fixture(autoReady = true) {
  const handlers = new Map<string, (event: IpcMainEvent) => void>();
  const windowEvents = new Map<string, () => void>();
  const rendererEvents = new Map<string, () => void>();
  const frame = {};
  let destroyed = false;
  const contents = {
    mainFrame: frame,
    isDestroyed: () => destroyed,
    send: vi.fn(),
    setWindowOpenHandler: vi.fn(),
    on: (name: string, callback: () => void) => rendererEvents.set(name, callback),
    once: (name: string, callback: () => void) => rendererEvents.set(name, callback),
  };
  const trusted = { sender: contents, senderFrame: frame } as unknown as IpcMainEvent;
  const window = {
    webContents: contents,
    isDestroyed: () => destroyed,
    showInactive: vi.fn(),
    hide: vi.fn(),
    loadURL: vi.fn(async (_url: string) => {
      if (autoReady) queueMicrotask(() => handlers.get(COMPUTER_STOP_CHANNELS.ready)?.(trusted));
    }),
    once: (name: string, callback: () => void) => windowEvents.set(name, callback),
    // The actual non-closable macOS panel ignores close().
    close: vi.fn(),
    destroy: vi.fn(() => {
      destroyed = true;
      windowEvents.get("closed")?.();
    }),
  };
  const stop = vi.fn(async (_tasks: readonly { threadId: string }[]) => {});
  const ipc = {
    on: (name: string, callback: (event: IpcMainEvent) => void) => handlers.set(name, callback),
    removeListener: (name: string) => handlers.delete(name),
  } as unknown as IpcMain;
  const presentation = new ComputerStopPresentation({
    createWindow: () => window as unknown as BrowserWindow,
    ipc,
    copy: () => ({
      title: "Computer",
      stop: "Stop",
      stopping: "Stopping",
      failure: "Could not confirm Stop",
    }),
    stop,
    onError: vi.fn(),
  });
  return { presentation, window, handlers, trusted, stop, rendererEvents };
}
describe("native Computer Stop presentation", () => {
  it.each(["task-end", "confirmed-stop", "dispose"] as const)(
    "destroys its non-closable safety window on %s",
    async (reason) => {
      const f = fixture();
      const task = { threadId: "fixture", turnId: "native-cleanup" };
      await f.presentation.taskStarted(task);
      if (reason === "task-end") f.presentation.taskEnded(task);
      else if (reason === "confirmed-stop") await f.presentation.requestStop();
      else f.presentation.dispose();
      expect(f.window.destroy).toHaveBeenCalledOnce();
      expect(f.window.close).not.toHaveBeenCalled();
      expect(f.window.isDestroyed()).toBe(true);
      f.presentation.dispose();
    },
  );

  it("ships a valid locked-down page script", async () => {
    const f = fixture();
    await f.presentation.taskStarted({ threadId: "fixture", turnId: "page" });
    const html = decodeURIComponent(
      f.window.loadURL.mock.calls[0]![0].split(",").slice(1).join(","),
    );
    const script = /<script nonce="[^"]+">([\s\S]*?)<\/script>/.exec(html)?.[1];
    expect(script).toBeTruthy();
    expect(() => new Script(script!)).not.toThrow();
    expect(html).toContain("default-src");
    f.presentation.dispose();
  });

  it("uses a non-activating panel with a sandboxed renderer", () => {
    const options = computerStopWindowOptions(
      { x: 0, y: 0, width: 1000, height: 800 },
      "/owned/preload.js",
    );
    expect(options).toMatchObject({
      type: "panel",
      focusable: false,
      acceptFirstMouse: true,
      show: false,
      alwaysOnTop: true,
      closable: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
  });
  it("waits for the owned main-frame Stop bridge before exposing the presentation", async () => {
    const f = fixture(false);
    const started = f.presentation.taskStarted({ threadId: "fixture", turnId: "first" });
    await Promise.resolve();
    expect(f.window.showInactive).not.toHaveBeenCalled();
    f.handlers.get(COMPUTER_STOP_CHANNELS.ready)!({
      ...f.trusted,
      senderFrame: {},
    } as IpcMainEvent);
    await Promise.resolve();
    expect(f.window.showInactive).not.toHaveBeenCalled();
    f.handlers.get(COMPUTER_STOP_CHANNELS.ready)!(f.trusted);
    await started;
    expect(f.window.showInactive).toHaveBeenCalledOnce();
    f.presentation.dispose();
  });
  it("does not hide while Stop is awaiting acknowledgement, and ignores stale task-end events", async () => {
    const f = fixture();
    await f.presentation.taskStarted({ threadId: "fixture", turnId: "new" });
    f.presentation.taskEnded({ threadId: "fixture", turnId: "old" });
    expect(f.window.hide).not.toHaveBeenCalled();
    let finish!: () => void;
    f.stop.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const stopping = f.presentation.requestStop();
    await Promise.resolve();
    f.presentation.taskEnded({ threadId: "fixture", turnId: "new" });
    expect(f.window.hide).not.toHaveBeenCalled();
    finish();
    await stopping;
    expect(f.window.hide).toHaveBeenCalledOnce();
    f.presentation.dispose();
  });
  it("keeps failure visible and permits a bounded retry without granting new authority", async () => {
    const f = fixture();
    await f.presentation.taskStarted({ threadId: "fixture", turnId: "first" });
    f.stop.mockRejectedValueOnce(new Error("cleanup unacknowledged"));
    await expect(f.presentation.requestStop()).rejects.toThrow("cleanup unacknowledged");
    f.presentation.taskEnded({ threadId: "fixture", turnId: "first" });
    expect(f.window.hide).not.toHaveBeenCalled();
    expect(f.window.webContents.send).toHaveBeenLastCalledWith(
      COMPUTER_STOP_CHANNELS.state,
      expect.objectContaining({ failed: true, pending: false }),
    );
    await expect(f.presentation.taskStarted({ threadId: "other", turnId: "new" })).rejects.toThrow(
      "Stop must be confirmed",
    );
    await f.presentation.requestStop();
    expect(f.window.hide).toHaveBeenCalledOnce();
    f.presentation.dispose();
  });
  it("stops the task if its owned safety window disappears", async () => {
    const f = fixture();
    await f.presentation.taskStarted({ threadId: "fixture", turnId: "closed" });
    f.window.destroy();
    await f.presentation.requestStop();
    expect(f.stop).toHaveBeenCalledOnce();
    f.presentation.dispose();
  });
  it("rejects Stop messages from another sender", async () => {
    const f = fixture();
    await f.presentation.taskStarted({ threadId: "fixture", turnId: "first" });
    f.handlers.get(COMPUTER_STOP_CHANNELS.request)!({
      sender: {},
      senderFrame: {},
    } as IpcMainEvent);
    expect(f.stop).not.toHaveBeenCalled();
    f.presentation.dispose();
  });
});
