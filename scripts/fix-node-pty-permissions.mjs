// FILE: fix-node-pty-permissions.mjs
// Purpose: Restores the executable bit Bun omits from node-pty's prebuilt macOS helper.

import { chmodSync, existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

if (process.platform !== "win32") {
  const root = resolve(import.meta.dirname, "..");
  const helper = resolve(
    root,
    "apps/server/node_modules/node-pty/prebuilds",
    `${process.platform}-${process.arch}`,
    "spawn-helper",
  );
  if (existsSync(helper)) {
    chmodSync(helper, (statSync(helper).mode & 0o777) | 0o111);
    console.log(`Restored executable permissions on ${helper}.`);
  }
}
