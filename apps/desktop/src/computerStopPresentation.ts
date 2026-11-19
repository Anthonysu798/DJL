import { randomBytes } from "node:crypto";
import type {
  BrowserWindow,
  BrowserWindowConstructorOptions,
  IpcMain,
  IpcMainEvent,
} from "electron";
import { cuaComputerTaskKey, type CuaComputerTask } from "@synara/shared/cuaDriverProtocol";
import { COMPUTER_STOP_CHANNELS } from "./computerStopChannels";

export function computerStopWindowOptions(
  area: { x: number; y: number; width: number; height: number },
  preload: string,
): BrowserWindowConstructorOptions {
  return {
    width: 254,
    height: 68,
    x: area.x + Math.max(0, area.width - 274),
    y: area.y + 20,
    title: "DJL Computer Stop",
    type: "panel",
    frame: false,
    show: false,
    focusable: false,
    closable: false,
    acceptFirstMouse: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    backgroundColor: "#202020",
    webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false },
  };
}

/** Owns only the safety presentation. Task authority and native input stay in their brokers. */
export class ComputerStopPresentation {
  private readonly tasks = new Map<string, CuaComputerTask>();
  private window: BrowserWindow | undefined;
  private ready: Promise<void> | undefined;
  private readyResolve: (() => void) | undefined;
  private readyReject: ((error: Error) => void) | undefined;
  private pending: Promise<void> | undefined;
  private failedTasks: readonly CuaComputerTask[] | undefined;
  private failed = false;
  private disposed = false;
  constructor(
    private readonly options: {
      readonly createWindow: () => BrowserWindow;
      readonly ipc: Pick<IpcMain, "on" | "removeListener">;
      readonly copy: () => { title: string; stop: string; stopping: string; failure: string };
      readonly stop: (tasks: readonly CuaComputerTask[]) => Promise<void>;
      readonly onError: (error: unknown) => void;
    },
  ) {
    options.ipc.on(COMPUTER_STOP_CHANNELS.request, this.receiveStop);
    options.ipc.on(COMPUTER_STOP_CHANNELS.ready, this.receiveReady);
  }
  private readonly receiveReady = (event: IpcMainEvent) => {
    const contents = this.window?.webContents;
    if (contents && event.sender === contents && event.senderFrame === contents.mainFrame)
      this.readyResolve?.();
  };
  private readonly receiveStop = (event: IpcMainEvent) => {
    const contents = this.window?.webContents;
    if (!contents || event.sender !== contents || event.senderFrame !== contents.mainFrame) return;
    void this.requestStop().catch(this.options.onError);
  };
  async taskStarted(task: CuaComputerTask): Promise<void> {
    if (this.disposed || this.pending || this.failedTasks)
      throw new Error("Computer Stop must be confirmed before a new task starts.");
    const key = cuaComputerTaskKey(task);
    this.tasks.set(key, { ...task });
    let owner: BrowserWindow | undefined;
    try {
      const ready = this.ensureWindow();
      owner = this.window;
      await ready;
    } catch (error) {
      this.tasks.delete(key);
      owner ??= this.window;
      if (this.window === owner && this.tasks.size === 0 && !this.pending && !this.failedTasks)
        owner?.destroy();
      throw error;
    }
    if (this.tasks.has(key) && this.window === owner && owner && !owner.isDestroyed()) {
      this.sendState();
      owner.showInactive();
    }
  }
  taskEnded(task: CuaComputerTask): void {
    for (const [key, current] of this.tasks)
      if (
        current.threadId === task.threadId &&
        (task.turnId === undefined || current.turnId === task.turnId)
      )
        this.tasks.delete(key);
    this.syncVisibility();
  }
  activeTasks(): readonly CuaComputerTask[] {
    return [...this.tasks.values()];
  }
  requestStop(): Promise<void> {
    if (this.pending) return this.pending;
    const snapshot = this.failedTasks ?? this.activeTasks();
    if (snapshot.length === 0) return Promise.resolve();
    this.failed = false;
    const work = Promise.resolve()
      .then(() => this.options.stop(snapshot))
      .then(() => {
        for (const task of snapshot) this.tasks.delete(cuaComputerTaskKey(task));
        this.failedTasks = undefined;
      })
      .catch((error) => {
        this.failed = true;
        this.failedTasks = snapshot;
        throw error;
      })
      .finally(() => {
        this.pending = undefined;
        this.syncVisibility();
      });
    this.pending = work;
    this.sendState();
    return work;
  }
  private sendState(): void {
    if (this.window && !this.window.isDestroyed() && !this.window.webContents.isDestroyed())
      this.window.webContents.send(COMPUTER_STOP_CHANNELS.state, {
        ...this.options.copy(),
        pending: this.pending !== undefined,
        failed: this.failed,
      });
  }
  private syncVisibility(): void {
    this.sendState();
    if (this.tasks.size === 0 && !this.pending && !this.failedTasks && this.window) {
      const window = this.window;
      this.readyReject?.(new Error("Computer Stop presentation ended."));
      this.readyResolve = undefined;
      this.readyReject = undefined;
      this.window = undefined;
      this.ready = undefined;
      window.hide();
      // Native non-closable panels ignore close() and otherwise block app quit.
      window.destroy();
    }
  }
  private ensureWindow(): Promise<void> {
    if (this.window && !this.window.isDestroyed() && this.ready) return this.ready;
    const window = this.options.createWindow();
    this.window = window;
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    window.webContents.once("render-process-gone", () => {
      if (this.window === window) void this.requestStop().catch(this.options.onError);
    });
    window.once("closed", () => {
      if (this.window !== window) return;
      this.readyReject?.(new Error("Computer Stop window closed."));
      this.readyResolve = undefined;
      this.readyReject = undefined;
      this.window = undefined;
      this.ready = undefined;
      if (!this.disposed && (this.tasks.size > 0 || this.failedTasks))
        void this.requestStop().catch(this.options.onError);
    });
    const nonce = randomBytes(18).toString("base64");
    const initial = JSON.stringify({
      ...this.options.copy(),
      pending: false,
      failed: false,
    }).replaceAll("<", "\\u003c");
    const html =
      '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;; script-src &#39;nonce-' +
      nonce +
      '&#39;"><style>body{margin:0;background:#202020;color:#f5f5f5;font:12px -apple-system,BlinkMacSystemFont,sans-serif}main{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px;-webkit-app-region:drag}p{margin:0}small{display:block;color:#f9b4b4;font-size:10px;margin-top:3px}button{-webkit-app-region:no-drag;border:0;border-radius:8px;background:#c53b3b;color:white;padding:9px 14px;font:inherit;cursor:pointer}button:disabled{opacity:.7}</style></head><body><main><div><p id="title"></p><small id="error" role="alert"></small></div><button id="stop" type="button"></button></main><script nonce="' +
      nonce +
      '">const button=document.getElementById("stop");const update=state=>{document.getElementById("title").textContent=state.title;document.getElementById("error").textContent=state.failed?state.failure:"";button.textContent=state.pending?state.stopping:state.stop;button.disabled=state.pending;button.setAttribute("aria-label",state.stop);};update(' +
      initial +
      ");button.onclick=()=>window.djlComputerStop.request();window.djlComputerStop.subscribe(update);window.djlComputerStop.ready();</script></body></html>";
    let resolveReady!: () => void;
    let rejectReady!: (error: Error) => void;
    const signal = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    this.readyResolve = resolveReady;
    this.readyReject = rejectReady;
    const timer = setTimeout(
      () =>
        rejectReady(new Error("Computer Stop did not become ready; native input was not started.")),
      5000,
    );
    timer.unref();
    this.ready = Promise.all([
      window.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html)),
      signal,
    ])
      .then(() => undefined)
      .finally(() => {
        clearTimeout(timer);
        if (this.window === window) {
          this.readyResolve = undefined;
          this.readyReject = undefined;
        }
      });
    return this.ready;
  }
  refresh(): void {
    this.sendState();
  }
  dispose(): void {
    this.disposed = true;
    this.options.ipc.removeListener(COMPUTER_STOP_CHANNELS.request, this.receiveStop);
    this.options.ipc.removeListener(COMPUTER_STOP_CHANNELS.ready, this.receiveReady);
    this.readyReject?.(new Error("Computer Stop disposed."));
    this.tasks.clear();
    this.failedTasks = undefined;
    this.window?.destroy();
    this.window = undefined;
  }
}
