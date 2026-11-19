import { describe, expect, it, vi } from "vitest";
import type { BrowserWindow } from "electron";
const mocks = vi.hoisted(() => ({ quit: vi.fn(), menu: vi.fn((items: unknown) => items) }));
vi.mock("electron", () => ({
  app: { quit: mocks.quit },
  Menu: { buildFromTemplate: mocks.menu },
  nativeImage: { createEmpty: () => ({}) },
  Tray: class {
    setToolTip() {}
    setContextMenu() {}
    on() {}
    destroy() {}
  },
}));
vi.mock("../desktopI18n", () => ({ desktopT: (key: string) => key }));
import { MultiPostTray } from "./tray";
describe("MultiPost tray lifecycle", () => {
  it("hides the window on close but allows explicit application quit", () => {
    const handlers = new Map<string, (event: { preventDefault: () => void }) => void>();
    const hide = vi.fn();
    const window = {
      on: (name: string, fn: (event: { preventDefault: () => void }) => void) =>
        handlers.set(name, fn),
      hide,
    } as unknown as BrowserWindow;
    let quitting = false;
    const tray = new MultiPostTray(null, () => {});
    tray.attach(window, () => quitting);
    const preventDefault = vi.fn();
    handlers.get("close")!({ preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(hide).toHaveBeenCalledOnce();
    quitting = true;
    handlers.get("close")!({ preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(hide).toHaveBeenCalledOnce();
    const menu = mocks.menu.mock.calls.at(-1)![0] as { label?: string; click?: () => void }[];
    // Closing is always background execution; stopping is an explicit Quit.
    expect(menu).toHaveLength(3);
    menu.at(-1)!.click!();
    expect(mocks.quit).toHaveBeenCalledOnce();
    tray.dispose();
  });
});
