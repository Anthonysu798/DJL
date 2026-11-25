#!/usr/bin/env node
// FILE: update-desktop-stage-override-lock.ts
// Purpose: Regenerates the committed lock for staged override versions that bun.lock lacks.
//          Run after editing DESKTOP_STAGE_DEPENDENCY_OVERRIDES and commit the result.
// Layer: Release/build script

import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { DESKTOP_STAGE_DEPENDENCY_OVERRIDES } from "./lib/desktop-stage-dependency-overrides.ts";
import {
  DESKTOP_STAGE_OVERRIDE_LOCK_PATH,
  lockContainsPackage,
  parseBunLock,
} from "./lib/desktop-stage-lockfile.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const workspaceLock = parseBunLock(readFileSync(join(repoRoot, "bun.lock"), "utf8"));
const missing = Object.fromEntries(
  Object.entries(DESKTOP_STAGE_DEPENDENCY_OVERRIDES).filter(
    ([name, version]) => !lockContainsPackage(workspaceLock, name, version),
  ),
);

const directory = mkdtempSync(join(tmpdir(), "djl-desktop-stage-overrides-"));
try {
  writeFileSync(
    join(directory, "package.json"),
    `${JSON.stringify(
      {
        name: "djl-desktop-stage-overrides",
        private: true,
        dependencies: missing,
        overrides: DESKTOP_STAGE_DEPENDENCY_OVERRIDES,
      },
      null,
      2,
    )}\n`,
  );
  const result = spawnSync("bun", ["install", "--lockfile-only"], {
    cwd: directory,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    throw new Error(`bun install --lockfile-only exited with ${result.status}.`);
  }
  copyFileSync(join(directory, "bun.lock"), join(repoRoot, DESKTOP_STAGE_OVERRIDE_LOCK_PATH));
  console.log(
    `Locked ${Object.keys(missing).join(", ") || "no packages"} in ${DESKTOP_STAGE_OVERRIDE_LOCK_PATH}`,
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
