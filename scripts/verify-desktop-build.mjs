// FILE: verify-desktop-build.mjs
// Purpose: Verifies the built Electron main process, preload, and gateway child entrypoints.

import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";

const root = resolve(import.meta.dirname, "..");
const desktopBuild = resolve(root, "apps/desktop/dist-electron");
const requiredEntries = ["main.js", "preload.js", "commerce-preload.js", "remoteGatewayChild.js"];

for (const name of requiredEntries) {
  const path = resolve(desktopBuild, name);
  if (!statSync(path).isFile() || statSync(path).size === 0) {
    throw new Error(`Desktop build entry is missing or empty: ${path}`);
  }
  execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });
}

const main = readFileSync(resolve(desktopBuild, "main.js"), "utf8");
if (!main.includes("preload.js")) {
  throw new Error("Built Electron main process does not reference the sandboxed preload.");
}
if (!main.includes("commerce-preload.js")) {
  throw new Error("Built main process does not reference the isolated commerce preload.");
}
const commercePreload = readFileSync(resolve(desktopBuild, "commerce-preload.js"), "utf8");
if (
  !commercePreload.includes("desktop:shop-checkout") ||
  commercePreload.includes("desktopBridge")
) {
  throw new Error(
    "Commerce preload must expose only its fixed checkout capability, not the AI bridge.",
  );
}

// Build-time diagnostic only: model sandboxed require and bridge exposure, not a real Electron run.
const exposures = [];
const calls = [];
const checkoutResult = Promise.resolve(true);
runInNewContext(
  commercePreload,
  {
    exports: {},
    require(name) {
      if (name !== "electron") {
        throw new Error(`Commerce preload must be self-contained: unexpected require(${name}).`);
      }
      return {
        contextBridge: {
          exposeInMainWorld: (name, bridge) => exposures.push({ name, bridge }),
        },
        ipcRenderer: {
          invoke: (...args) => {
            calls.push(args);
            return checkoutResult;
          },
        },
      };
    },
  },
  { filename: "commerce-preload.js", timeout: 1000 },
);
const exposure = exposures[0];
const bridge = exposure?.bridge;
if (
  exposures.length !== 1 ||
  exposure.name !== "djlCommerce" ||
  !bridge ||
  bridge.kind !== "desktop" ||
  typeof bridge.openCheckout !== "function" ||
  Reflect.ownKeys(bridge).toSorted().join(",") !== "kind,openCheckout" ||
  !Object.isFrozen(bridge)
) {
  throw new Error("Commerce preload must expose only the frozen djlCommerce checkout bridge.");
}
const checkoutInput = { orderId: "build-diagnostic", attemptId: "build-diagnostic-attempt" };
if (
  bridge.openCheckout(checkoutInput) !== checkoutResult ||
  calls.length !== 1 ||
  calls[0].length !== 2 ||
  calls[0][0] !== "desktop:shop-checkout" ||
  calls[0][1] !== checkoutInput
) {
  throw new Error("Commerce preload must invoke only desktop:shop-checkout with its input.");
}

console.log("Desktop main, preload, and gateway child build entries are valid.");
