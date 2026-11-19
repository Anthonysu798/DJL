// FILE: verify-desktop-build.mjs
// Purpose: Verifies the built Electron main process, preload, and gateway child entrypoints.

import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";

const root = resolve(import.meta.dirname, "..");
const desktopBuild = resolve(root, "apps/desktop/dist-electron");
const requiredEntries = ["main.js", "preload.js", "remoteGatewayChild.js"];

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

// Electron's sandboxed preload cannot require arbitrary installed packages.
// Execute the actual bundle with only its Electron bridge API available so a
// transitive schema import cannot silently break every desktop renderer.
const exposed = new Map();
runInNewContext(
  readFileSync(resolve(desktopBuild, "preload.js"), "utf8"),
  {
    exports: {},
    require(name) {
      if (name !== "electron")
        throw new Error(`Sandboxed preload requires unsupported module: ${name}`);
      return {
        contextBridge: { exposeInMainWorld: (key, value) => exposed.set(key, value) },
        ipcRenderer: {
          on() {},
          removeListener() {},
          send() {},
          sendSync() {},
          invoke() {
            return Promise.resolve();
          },
        },
      };
    },
    process: { platform: process.platform, env: {}, versions: {} },
    console,
    URL,
  },
  { timeout: 1_000, filename: "preload.js" },
);
if (!exposed.get("desktopBridge")?.computer?.request)
  throw new Error("Sandboxed preload did not expose the desktop computer-use bridge.");

const stopExposed = new Map();
runInNewContext(
  readFileSync(resolve(desktopBuild, "computerStopPreload.js"), "utf8"),
  {
    exports: {},
    require(name) {
      if (name !== "electron") throw new Error("Unsupported Stop preload dependency: " + name);
      return {
        contextBridge: { exposeInMainWorld: (key, value) => stopExposed.set(key, value) },
        ipcRenderer: { on() {}, removeListener() {}, send() {} },
      };
    },
    console,
  },
  { timeout: 1000, filename: "computerStopPreload.js" },
);
if (
  stopExposed.size !== 1 ||
  !stopExposed.get("djlComputerStop")?.request ||
  !stopExposed.get("djlComputerStop")?.ready
)
  throw new Error(
    "The sandboxed Computer Stop bridge is unavailable or exposes extra capabilities.",
  );

console.log("Desktop main, preload, safety control, and gateway child build entries are valid.");
