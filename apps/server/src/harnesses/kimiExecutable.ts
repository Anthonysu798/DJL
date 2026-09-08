import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export function kimiInstallRoot(env: NodeJS.ProcessEnv = process.env) {
  return env.KIMI_INSTALL_DIR?.trim()
    ? resolve(env.KIMI_INSTALL_DIR)
    : join(homedir(), ".kimi-code");
}

export function resolveKimiBinaryPath(configured?: string) {
  const binary = configured?.trim();
  if (binary && binary !== "kimi") return binary;
  const installed = join(
    kimiInstallRoot(),
    "bin",
    process.platform === "win32" ? "kimi.exe" : "kimi",
  );
  return existsSync(installed) ? installed : "kimi";
}

export function isNativeKimiPath(binary: string) {
  return (
    resolve(binary) ===
    join(kimiInstallRoot(), "bin", process.platform === "win32" ? "kimi.exe" : "kimi")
  );
}
