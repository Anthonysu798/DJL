import { realpathSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { HarnessTool, ServerSettings } from "@synara/contracts";
import {
  createProviderVersionAdvisory,
  parseGenericCliVersion,
} from "../provider/providerMaintenance";
import { probe } from "./accounts";
import { resolveGrokBinaryPath } from "./grokExecutable";

const STABLE_SOURCES = [
  "https://x.ai/cli/stable",
  "https://storage.googleapis.com/grok-build-public-artifacts/cli/stable",
];

export async function fetchGrokLatestVersion(
  fetcher: (url: string, init?: RequestInit) => Promise<Response> = fetch,
): Promise<string | null> {
  for (const url of STABLE_SOURCES) {
    try {
      const response = await fetcher(url, { signal: AbortSignal.timeout(4_000) });
      if (!response.ok) continue;
      const version = (await response.text()).trim();
      if (/^\d+\.\d+\.\d+(?:-[A-Za-z0-9._-]+)?$/.test(version) && version.length < 100)
        return version;
    } catch {
      /* Offline checks remain unknown; never invent an installed version. */
    }
  }
  return null;
}

export function isOfficialGrokInstallation(binary: string, home = homedir()) {
  const directory = dirname(resolve(binary));
  return directory === join(home, ".grok", "bin") || directory === join(home, ".grok", "downloads");
}

async function canRunOfficialInstaller() {
  // Windows requires native Git/MSYS Bash, not a WSL launcher installing Linux binaries.
  const system = await probe("bash", ["-c", "uname -s"], process.env);
  if (
    system.code !== 0 ||
    !(process.platform === "win32" ? /^(MINGW|MSYS|CYGWIN)/ : /^(Darwin|Linux)/).test(system.stdout)
  )
    return false;
  const curl = await probe("curl", ["--version"], process.env);
  if (curl.code === 0) return true;
  return (await probe("wget", ["--version"], process.env)).code === 0;
}

export async function inspectGrokTool(settings: ServerSettings): Promise<HarnessTool> {
  const binary = resolveGrokBinaryPath(settings.providers.grok.binaryPath);
  const result = await probe(binary, ["--no-auto-update", "--version"], process.env);
  const currentVersion = result.code === 0 ? parseGenericCliVersion(result.stdout) : null;
  const latestVersion = settings.enableProviderUpdateChecks ? await fetchGrokLatestVersion() : null;
  let installedPath = binary;
  try {
    installedPath = realpathSync(binary);
  } catch {
    /* Bare/custom paths remain unmanaged. */
  }
  return {
    id: "grok",
    installed: result.code === 0,
    currentVersion,
    latestVersion,
    status: createProviderVersionAdvisory({ provider: "grok", currentVersion, latestVersion })
      .status,
    canUpdate:
      result.code === 0 &&
      isOfficialGrokInstallation(installedPath) &&
      settings.providers.grok.enabled,
    canInstall:
      !!result.missing &&
      binary === "grok" &&
      settings.providers.grok.enabled &&
      (await canRunOfficialInstaller()),
  };
}

export async function maintainGrokTool(
  before: HarnessTool,
  settings: ServerSettings,
  run: (command: string, args: readonly string[]) => Promise<void>,
) {
  if (before.installed) {
    await run(resolveGrokBinaryPath(settings.providers.grok.binaryPath), [
      "--no-auto-update",
      "update",
      "--stable",
    ]);
    return;
  }
  const directory = await mkdtemp(join(tmpdir(), "djl-grok-install-"));
  try {
    const response = await fetch("https://x.ai/cli/install.sh", {
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error("Could not download the official Grok installer.");
    const script = join(directory, "install.sh");
    await writeFile(script, await response.text(), { mode: 0o600 });
    await run("bash", [script]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
