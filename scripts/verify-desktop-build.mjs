// FILE: verify-desktop-build.mjs
// Purpose: Verifies the built Electron main process, preload, and gateway child entrypoints.

import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

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

console.log("Desktop main, preload, and gateway child build entries are valid.");
