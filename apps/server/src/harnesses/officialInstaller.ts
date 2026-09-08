import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { probe } from "./accounts";

export type InstallerCommandRunner = (
  command: string,
  args: readonly string[],
  env?: NodeJS.ProcessEnv,
) => Promise<void>;

export async function canRunOfficialInstaller() {
  if (!["darwin", "linux", "win32"].includes(process.platform)) return false;
  const shell = await probe(
    process.platform === "win32" ? "powershell.exe" : "bash",
    process.platform === "win32"
      ? ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"]
      : ["--version"],
    process.env,
  );
  return (
    shell.code === 0 &&
    (process.platform === "win32" || (await probe("curl", ["--version"], process.env)).code === 0)
  );
}

export function officialInstallerUrl(provider: "kimi" | "cursor", platform = process.platform) {
  return provider === "cursor"
    ? `https://cursor.com/install${platform === "win32" ? "?win32=true" : ""}`
    : `https://code.kimi.com/kimi-code/install.${platform === "win32" ? "ps1" : "sh"}`;
}

export async function runOfficialInstaller(
  provider: "kimi" | "cursor",
  run: InstallerCommandRunner,
  env = process.env,
) {
  const directory = await mkdtemp(join(tmpdir(), `djl-${provider}-install-`));
  try {
    const response = await fetch(officialInstallerUrl(provider), {
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error("Could not download the official provider installer.");
    const script = join(directory, process.platform === "win32" ? "install.ps1" : "install.sh");
    await writeFile(script, await response.text(), { mode: 0o600 });
    await run(
      process.platform === "win32" ? "powershell.exe" : "bash",
      process.platform === "win32"
        ? ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script]
        : [script],
      env,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
