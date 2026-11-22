import { contextBridge, ipcRenderer } from "electron";
import type { CommerceDesktopBridge } from "@djl/contracts/cloud";

const bridge: CommerceDesktopBridge = {
  kind: "desktop",
  openCheckout: (input) => ipcRenderer.invoke("desktop:shop-checkout", input),
};

contextBridge.exposeInMainWorld("djlCommerce", Object.freeze(bridge));
