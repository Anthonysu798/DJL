"use strict";

const fs = require("node:fs/promises");
const { join } = require("node:path");
const { setTimeout: sleep } = require("node:timers/promises");

// Runs after ASAR integrity is written, before the next Windows resource edit.
// Probe without truncating; never skip integrity, resource editing or signing.
module.exports = async function afterPack(context, dependencies = { open: fs.open, sleep }) {
  if (context.electronPlatformName !== "win32") return;
  const executable = join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  let writable = false;
  let lastBusy;
  for (let attempt = 0; attempt < 41; attempt++) {
    let handle;
    try {
      handle = await dependencies.open(executable, "r+");
    } catch (error) {
      if (error?.code !== "EBUSY") throw error;
      lastBusy = error;
      writable = false;
    }
    if (handle) {
      await handle.close();
      if (writable) return;
      writable = true;
    }
    if (attempt < 40) await dependencies.sleep(250);
  }
  // Reaching this point necessarily includes EBUSY: two successes return above.
  throw lastBusy;
};
