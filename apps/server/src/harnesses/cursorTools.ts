import type { HarnessTool, ServerSettings } from "@synara/contracts";
import { buildCursorAgentCommand } from "../provider/acp/CursorAcpCommand";
import { probe } from "./accounts";
import {
  officialInstallerUrl,
  runOfficialInstaller,
  type InstallerCommandRunner,
} from "./officialInstaller";

export function parseCursorRelease(output: string): string | null {
  const versions = new Set(output.match(/\b\d{4}\.\d{2}\.\d{2}-[a-f0-9]{7,40}\b/g));
  return versions.size === 1 ? [...versions][0]! : null;
}

export function cursorVersionStatus(
  current: string | null,
  latest: string | null,
): HarnessTool["status"] {
  if (!current || !latest) return "unknown";
  return current === latest || current.slice(0, 10) > latest.slice(0, 10)
    ? "current"
    : "behind_latest";
}

export async function inspectCursorTool(settings: ServerSettings): Promise<HarnessTool> {
  const binary = settings.providers.cursor.binaryPath;
  const command = buildCursorAgentCommand(binary, ["--version"]);
  const version = await probe(command.command, [...command.args], process.env);
  const currentVersion = version.code === 0 ? parseCursorRelease(version.stdout) : null;
  let latestVersion: string | null = null;
  if (settings.enableProviderUpdateChecks) {
    try {
      const response = await fetch(officialInstallerUrl("cursor"), {
        signal: AbortSignal.timeout(4_000),
      });
      if (response.ok) latestVersion = parseCursorRelease(await response.text());
    } catch {
      /* Leave offline version checks unknown. */
    }
  }
  const defaultBinary = !binary.trim() || binary === "cursor-agent" || binary === "agent";
  const shell =
    version.missing && defaultBinary
      ? await probe(
          process.platform === "win32" ? "powershell.exe" : "bash",
          process.platform === "win32"
            ? ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"]
            : ["--version"],
          process.env,
        )
      : null;
  const curl =
    shell?.code === 0 && process.platform !== "win32"
      ? await probe("curl", ["--version"], process.env)
      : null;
  return {
    id: "cursor",
    installed: version.code === 0,
    currentVersion,
    latestVersion,
    status: cursorVersionStatus(currentVersion, latestVersion),
    canUpdate: version.code === 0 && !!currentVersion && settings.providers.cursor.enabled,
    canInstall:
      shell?.code === 0 &&
      (process.platform === "win32" || curl?.code === 0) &&
      settings.providers.cursor.enabled,
  };
}

export async function maintainCursorTool(
  before: HarnessTool,
  settings: ServerSettings,
  run: InstallerCommandRunner,
) {
  if (!before.installed) return runOfficialInstaller("cursor", run);
  const command = buildCursorAgentCommand(settings.providers.cursor.binaryPath, ["update"]);
  await run(command.command, command.args);
}
