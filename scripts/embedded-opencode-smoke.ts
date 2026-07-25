// FILE: embedded-opencode-smoke.ts
// Purpose: Builds and launches only the OpenCode binary that DJL embeds as a desktop dependency.

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { DJL_OPENCODE_VERSION, prepareVendoredOpenCode } from "./lib/vendored-opencode.ts";

const binary = prepareVendoredOpenCode({ repoRoot: resolve(import.meta.dirname, "..") });
const result = spawnSync(binary, ["--version"], { encoding: "utf8" });
if (result.status !== 0) {
  throw new Error(
    `Embedded OpenCode runtime failed to launch (${result.status ?? "unknown"}): ${result.stderr}`,
  );
}
if (result.stdout.trim() !== DJL_OPENCODE_VERSION) {
  throw new Error(
    `Embedded OpenCode version mismatch: expected ${DJL_OPENCODE_VERSION}, received ${result.stdout.trim() || "no output"}.`,
  );
}
console.log(`Embedded OpenCode ${DJL_OPENCODE_VERSION} launched successfully.`);
