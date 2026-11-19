import { describe, expect, it, vi } from "vitest";
import type { IpcMain, IpcMainInvokeEvent } from "electron";
import type { DesktopAppSnapManager } from "./appSnapManager";
import { registerAppSnapIpcHandlers } from "./appSnapIpc";
import { APPSNAP_IPC_CHANNELS } from "./ipcChannels";

describe("AppSnap IPC ownership", () => {
  it("rejects a foreign renderer before probing permissions", async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const manager = { refreshState: vi.fn() };
    const ipc = {
      removeHandler: vi.fn(),
      handle: (name: string, handler: (...args: unknown[]) => unknown) =>
        handlers.set(name, handler),
    } as unknown as IpcMain;
    registerAppSnapIpcHandlers(ipc, manager as unknown as DesktopAppSnapManager, {
      isTrustedSender: () => false,
      openPermissionSettingsPane: vi.fn(),
      restartApp: vi.fn(),
    });
    expect(() => handlers.get(APPSNAP_IPC_CHANNELS.getState)!({} as IpcMainInvokeEvent)).toThrow(
      "Untrusted",
    );
    expect(manager.refreshState).not.toHaveBeenCalled();
  });
});
