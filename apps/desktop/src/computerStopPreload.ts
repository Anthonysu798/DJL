import { contextBridge, ipcRenderer } from "electron";
import { COMPUTER_STOP_CHANNELS, type ComputerStopView } from "./computerStopChannels";
contextBridge.exposeInMainWorld("djlComputerStop", {
  request: () => ipcRenderer.send(COMPUTER_STOP_CHANNELS.request),
  ready: () => ipcRenderer.send(COMPUTER_STOP_CHANNELS.ready),
  subscribe: (listener: (state: ComputerStopView) => void) => {
    const receive = (_event: Electron.IpcRendererEvent, state: ComputerStopView) => {
      if (
        state &&
        typeof state.title === "string" &&
        typeof state.stop === "string" &&
        typeof state.stopping === "string" &&
        typeof state.failure === "string" &&
        typeof state.pending === "boolean" &&
        typeof state.failed === "boolean"
      )
        listener(state);
    };
    ipcRenderer.on(COMPUTER_STOP_CHANNELS.state, receive);
    return () => ipcRenderer.removeListener(COMPUTER_STOP_CHANNELS.state, receive);
  },
});
