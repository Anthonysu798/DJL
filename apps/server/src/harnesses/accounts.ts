import { inspectInstalledOpenCodeProtocol } from "../provider/openCodeInstalledProtocol";
import { grokSubscriptionEnvironment, probeGrokSubscriptionAccount } from "./native/grok";
import { resolveGrokBinaryPath } from "./grokExecutable";
import { resolveKimiBinaryPath } from "./kimiExecutable";
import { kimiSubscriptionEnvironment, probeKimiSubscriptionAccount } from "./native/kimi";
import { parseGenericCliVersion } from "../provider/providerMaintenance";
// Fresh account probes and official-runtime login invocations. No credential values leave this module.
import { prepareWindowsSafeProcess } from "@synara/shared/windowsProcess";
import { execFile } from "node:child_process";
import { stripVTControlCharacters } from "node:util";
import type {
  HarnessAccount,
  HarnessId,
  ServerProviderStatus,
  ServerSettings,
} from "@synara/contracts";
import { buildCursorAgentCommand } from "../provider/acp/CursorAcpCommand";
import {
  buildOpenCodeServerProcessEnv,
  resolveDjlOpenCodeBinaryPath,
} from "../provider/opencodeRuntime";

export const NATIVE_HARNESS_IDS = ["codex", "claudeAgent", "cursor", "grok", "kimi"] as const;
const HARNESS_IDS = [...NATIVE_HARNESS_IDS, "opencode"] as const;

export function buildHarnessInvocation(
  harness: HarnessId,
  settings: ServerSettings,
  _managedRootDir: string,
  baseEnv: NodeJS.ProcessEnv = process.env,
) {
  const env = { ...baseEnv };
  if (harness === "kimi")
    return {
      binary: resolveKimiBinaryPath(settings.providers.kimi.binaryPath),
      prefixArgs: [] as string[],
      loginArgs: ["login"],
      statusArgs: ["doctor"],
      env: kimiSubscriptionEnvironment(env, settings.providers.kimi.region),
    };
  if (harness === "grok") {
    return {
      binary: resolveGrokBinaryPath(settings.providers.grok.binaryPath),
      prefixArgs: ["--no-auto-update"],
      loginArgs: ["login"],
      statusArgs: ["inspect", "--json"],
      env: grokSubscriptionEnvironment(env),
    };
  }
  if (harness === "codex") {
    if (settings.providers.codex.homePath.trim())
      env.CODEX_HOME = settings.providers.codex.homePath.trim();
    return {
      binary: settings.providers.codex.binaryPath.trim() || "codex",
      prefixArgs: [] as string[],
      loginArgs: ["login"],
      statusArgs: ["login", "status"],
      env,
    };
  }
  if (harness === "claudeAgent") {
    return {
      binary: settings.providers.claudeAgent.binaryPath.trim() || "claude",
      prefixArgs: [] as string[],
      loginArgs: ["auth", "login"],
      statusArgs: ["auth", "status"],
      env,
    };
  }
  if (harness === "cursor") {
    const command = buildCursorAgentCommand(settings.providers.cursor.binaryPath, [], { env });
    return {
      binary: command.command,
      prefixArgs: [...command.args],
      loginArgs: ["login"],
      statusArgs: ["status"],
      env,
    };
  }
  return {
    binary: resolveDjlOpenCodeBinaryPath(settings.providers.opencode.binaryPath),
    prefixArgs: [] as string[],
    loginArgs: ["auth", "login"],
    statusArgs: ["auth", "list"],
    env: buildOpenCodeServerProcessEnv({ baseEnv }),
  };
}

export type ProbeOutput = { code: number; stdout: string; stderr: string; missing?: boolean };
export type AccountProbe = (
  binary: string,
  args: string[],
  env: NodeJS.ProcessEnv,
) => Promise<ProbeOutput>;

export function parseHarnessAccountStatus(
  harness: HarnessId,
  output: ProbeOutput,
): "ready" | "required" | "unknown" {
  const text = stripVTControlCharacters(`${output.stdout}\n${output.stderr}`);
  if (harness === "claudeAgent") {
    try {
      const account: unknown = JSON.parse(output.stdout);
      if (account && typeof account === "object" && "loggedIn" in account) {
        if (account.loggedIn === true && output.code === 0) return "ready";
        if (account.loggedIn === false) return "required";
      }
    } catch {
      /* An unrecognized CLI response must not be reported as authenticated. */
    }
  }
  if (harness === "opencode" && output.code === 0 && /\b[1-9]\d* credentials?\b/i.test(text))
    return "ready";
  if (
    /not (?:logged in|authenticated)|login required|authentication required|0 credentials/i.test(
      text,
    )
  )
    return "required";
  if (output.code !== 0) return "unknown";
  if (harness === "codex" && /logged in using/i.test(text)) return "ready";
  if (harness === "cursor" && /(?:logged in as|authenticated as)/i.test(text)) return "ready";
  if (harness === "opencode" && /\b[1-9]\d* credentials?\b/i.test(text)) return "ready";
  return "unknown";
}

export function probe(
  binary: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): Promise<ProbeOutput> {
  const launch = prepareWindowsSafeProcess(binary, args, { env, platform });
  return new Promise((resolve) => {
    execFile(
      launch.command,
      launch.args,
      { ...launch, env, timeout: 10_000, maxBuffer: 128 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        resolve({ code: error ? 1 : 0, stdout, stderr, missing: error?.code === "ENOENT" });
      },
    );
  });
}

export async function probeHarnessAccount(
  harness: HarnessId,
  settings: ServerSettings,
  managedRootDir: string,
  runProbe: AccountProbe = probe,
): Promise<HarnessAccount> {
  if (!settings.providers[harness].enabled)
    return { id: harness, installed: false, enabled: false, status: "disabled" };
  const invocation = buildHarnessInvocation(harness, settings, managedRootDir);
  const version = await runProbe(
    invocation.binary,
    [...invocation.prefixArgs, "--version"],
    invocation.env,
  );
  if (version.missing) return { id: harness, installed: false, enabled: true, status: "missing" };
  if (version.code !== 0)
    return { id: harness, installed: false, enabled: true, status: "unknown" };
  if (harness === "kimi")
    return {
      id: harness,
      installed: true,
      enabled: true,
      status: await probeKimiSubscriptionAccount(
        invocation.binary,
        process.cwd(),
        settings.providers.kimi.region,
      ),
      version: version.stdout.trim().slice(0, 100),
    };
  if (harness === "grok")
    return {
      id: harness,
      installed: true,
      enabled: true,
      status: await probeGrokSubscriptionAccount(invocation.binary, process.cwd()),
      version: version.stdout.trim().slice(0, 100),
    };
  if (harness === "opencode") {
    const compatibility = await inspectInstalledOpenCodeProtocol(
      invocation.binary,
      version.stdout.trim(),
    );
    if (!compatibility.compatible)
      return {
        id: harness,
        installed: true,
        enabled: true,
        status: "incompatible",
        version: version.stdout.trim().slice(0, 100),
      };
  }
  const auth = await runProbe(
    invocation.binary,
    [...invocation.prefixArgs, ...invocation.statusArgs],
    invocation.env,
  );
  return {
    id: harness,
    installed: true,
    enabled: true,
    status: parseHarnessAccountStatus(harness, auth),
    version: version.stdout.trim().slice(0, 100),
  };
}

export async function listHarnessAccounts(settings: ServerSettings, managedRootDir: string) {
  return {
    accounts: await Promise.all(
      HARNESS_IDS.map((id) => probeHarnessAccount(id, settings, managedRootDir)),
    ),
  };
}

export async function probeNativeHarnessStatuses(
  settings: ServerSettings,
  managedRootDir: string,
  runProbe: AccountProbe = probe,
): Promise<ServerProviderStatus[]> {
  const accounts = await Promise.all(
    NATIVE_HARNESS_IDS.map((id) => probeHarnessAccount(id, settings, managedRootDir, runProbe)),
  );
  return accounts.map((account) => ({
    provider: account.id,
    available: account.installed && account.enabled,
    status: account.status === "ready" ? "ready" : "warning",
    authStatus:
      account.status === "ready"
        ? "authenticated"
        : account.status === "required"
          ? "unauthenticated"
          : "unknown",
    checkedAt: new Date().toISOString(),
    version: account.version ? parseGenericCliVersion(account.version) : null,
  }));
}
