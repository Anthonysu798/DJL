import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildSmokeEnvironment,
  buildSmokeLaunchArguments,
  terminateSmokeProcessTree,
} from "./smoke-test-process.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(__dirname, "..");
const electronBin = resolve(desktopDir, "node_modules/.bin/electron");
const mainJs = resolve(desktopDir, "dist-electron/main.js");
const smokeRoot = mkdtempSync(join(tmpdir(), "djl-desktop-smoke-"));
const userDataDirectory = join(smokeRoot, "profile");
mkdirSync(join(smokeRoot, "home"), { recursive: true });
mkdirSync(join(smokeRoot, "state"), { recursive: true });
mkdirSync(userDataDirectory, { recursive: true });
const smokeEnvironment = buildSmokeEnvironment(
  process.env,
  smokeRoot,
  String(20_000 + (process.pid % 20_000)),
);

console.log("\nLaunching Electron smoke test...");

const child = spawn(electronBin, buildSmokeLaunchArguments(mainJs, userDataDirectory), {
  stdio: ["pipe", "pipe", "pipe"],
  detached: process.platform !== "win32",
  env: smokeEnvironment,
});

let output = "";
child.stdout.on("data", (chunk) => {
  output += chunk.toString();
});
child.stderr.on("data", (chunk) => {
  output += chunk.toString();
});

let forceKillTimeout;

async function cleanupSmokeRoot() {
  let lastError;
  // Electron's child processes can briefly retain a file handle after the main process exits on
  // Windows. Retrying the disposable profile cleanup keeps the smoke result about app startup,
  // rather than turning that normal handle-release race into a false negative.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(smokeRoot, { recursive: true, force: true, maxRetries: 4, retryDelay: 150 });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  throw lastError;
}

const timeout = setTimeout(() => {
  terminateSmokeProcessTree(child);
  forceKillTimeout = setTimeout(() => {
    terminateSmokeProcessTree(child, "SIGKILL");
  }, 2_000);
}, 8_000);

child.on("exit", async () => {
  clearTimeout(timeout);
  clearTimeout(forceKillTimeout);
  try {
    await cleanupSmokeRoot();
  } catch (error) {
    console.error("\nDesktop smoke test could not clean its temporary profile:", error);
    process.exit(1);
  }

  const fatalPatterns = [
    "Cannot find module",
    "MODULE_NOT_FOUND",
    "Refused to execute",
    "Uncaught Error",
    "Uncaught TypeError",
    "Uncaught ReferenceError",
  ];
  const failures = fatalPatterns.filter((pattern) => output.includes(pattern));

  if (failures.length > 0) {
    console.error("\nDesktop smoke test failed:");
    for (const failure of failures) {
      console.error(` - ${failure}`);
    }
    console.error("\nFull output:\n" + output);
    process.exit(1);
  }

  console.log("Desktop smoke test passed.");
  process.exit(0);
});
