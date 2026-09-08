import type { HarnessTool, ServerSettings } from "@synara/contracts";
import {
  createProviderVersionAdvisory,
  parseGenericCliVersion,
} from "../provider/providerMaintenance";
import type { ProbeOutput } from "./accounts";
import { isNativeKimiPath, kimiInstallRoot } from "./kimiExecutable";
import {
  canRunOfficialInstaller,
  runOfficialInstaller,
  type InstallerCommandRunner,
} from "./officialInstaller";

export async function inspectKimiNativeTool(
  settings: ServerSettings,
  binary: string,
  version: ProbeOutput,
): Promise<HarnessTool | undefined> {
  if (!isNativeKimiPath(binary) && !(version.missing && binary === "kimi")) return undefined;
  let latestVersion: string | null = null;
  if (settings.enableProviderUpdateChecks) {
    try {
      const response = await fetch("https://code.kimi.com/kimi-code/latest", {
        signal: AbortSignal.timeout(4_000),
      });
      const text = response.ok ? (await response.text()).trim() : "";
      if (/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(text)) latestVersion = text;
    } catch {
      /* Native CDN checks remain unknown when offline. */
    }
  }
  const currentVersion = version.code === 0 ? parseGenericCliVersion(version.stdout) : null;
  const installer = settings.providers.kimi.enabled && (await canRunOfficialInstaller());
  return {
    id: "kimi",
    installed: version.code === 0,
    currentVersion,
    latestVersion,
    status: createProviderVersionAdvisory({ provider: "kimi", currentVersion, latestVersion })
      .status,
    canInstall: !!version.missing && binary === "kimi" && installer,
    canUpdate: version.code === 0 && isNativeKimiPath(binary) && installer,
  };
}

export async function maintainKimiNativeTool(before: HarnessTool, run: InstallerCommandRunner) {
  await runOfficialInstaller("kimi", run, {
    ...process.env,
    KIMI_INSTALL_DIR: kimiInstallRoot(),
    KIMI_NO_MODIFY_PATH: "1",
    KIMI_VERSION: before.latestVersion ?? undefined,
  });
}
