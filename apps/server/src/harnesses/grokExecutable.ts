import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// The official installer adds ~/.grok/bin to future shells. An already-running
// desktop process must also find it without restarting or choosing another CLI.
export function resolveGrokBinaryPath(configured?: string) {
  const binary = configured?.trim();
  if (binary && binary !== "grok") return binary;
  const installed = join(
    homedir(),
    ".grok",
    "bin",
    process.platform === "win32" ? "grok.exe" : "grok",
  );
  return existsSync(installed) ? installed : "grok";
}
