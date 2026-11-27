import { inspectInstalledOpenCodeProtocol } from "../provider/openCodeInstalledProtocol";
import { grokSubscriptionEnvironment, probeGrokSubscriptionAccount } from "./native/grok";
import { resolveGrokBinaryPath } from "./grokExecutable";
import { resolveKimiBinaryPath } from "./kimiExecutable";
import { kimiSubscriptionEnvironment, probeKimiSubscriptionAccount } from "./native/kimi";
import { iflowSubscriptionEnvironment, probeIFlowSubscriptionAccount } from "./native/iflow";
import { qwenSubscriptionEnvironment, probeQwenSubscriptionAccount } from "./native/qwen";
import { copilotSubscriptionEnvironment, probeCopilotSubscriptionAccount } from "./native/copilot";
import { probeGeminiSubscriptionAccount } from "./native/gemini";
import { piSubscriptionEnvironment, probePiSubscriptionAccount } from "./native/pi";
import { museSubscriptionEnvironment, probeMuseSubscriptionAccount } from "./native/muse";
import {
  codeBuddySubscriptionEnvironment,
  probeCodeBuddySubscriptionAccount,
} from "./native/codebuddy";
import { parseGenericCliVersion } from "../provider/providerMaintenance";
// Fresh account probes and official-runtime login invocations. No credential values leave this module.
import { prepareWindowsSafeProcess } from "@djl/shared/windowsProcess";
import { execFile } from "node:child_process";
import { stripVTControlCharacters } from "node:util";
import type {
  HarnessAccount,
  HarnessId,
  ServerProviderStatus,
  ServerSettings,
} from "@djl/contracts";
import { buildCursorAgentCommand } from "../provider/acp/CursorAcpCommand";
import {
  buildOpenCodeServerProcessEnv,
  resolveDjlOpenCodeBinaryPath,
} from "../provider/opencodeRuntime";
import { activeCliAccountDir } from "./cliAccountSelection";
import { readClaudeLogin } from "./claudeLogin";

export const NATIVE_HARNESS_IDS = [
  "codex",
  "claudeAgent",
  "cursor",
  "gemini",
  "grok",
  "kimi",
  "iflow",
  "qwen",
  "copilot",
  "codebuddy",
  "pi",
  "muse",
] as const;
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
  // iFlow and Qwen Code have no login subcommand: the interactive CLI opens its
  // own account dialog when it has no stored credentials.
  if (harness === "iflow")
    return {
      binary: settings.providers.iflow.binaryPath.trim() || "iflow",
      prefixArgs: [] as string[],
      loginArgs: [] as string[],
      statusArgs: ["--version"],
      env: iflowSubscriptionEnvironment(env),
    };
  if (harness === "qwen")
    return {
      binary: settings.providers.qwen.binaryPath.trim() || "qwen",
      prefixArgs: [] as string[],
      loginArgs: [] as string[],
      statusArgs: ["--version"],
      env: qwenSubscriptionEnvironment(env),
    };
  // https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference
  // `copilot login` runs GitHub's web or device-code flow and stores the token.
  if (harness === "copilot")
    return {
      binary: settings.providers.copilot.binaryPath.trim() || "copilot",
      prefixArgs: [] as string[],
      loginArgs: ["login"],
      statusArgs: ["--version"],
      env: copilotSubscriptionEnvironment(env),
    };
  // Gemini CLI signs in from its interactive TUI, which opens the browser itself.
  if (harness === "gemini")
    return {
      binary: settings.providers.gemini.binaryPath.trim() || "gemini",
      prefixArgs: [] as string[],
      loginArgs: [] as string[],
      statusArgs: ["--version"],
      env,
    };
  // CodeBuddy Code signs in with the TUI `/login` picker; there is no login subcommand.
  if (harness === "codebuddy")
    return {
      binary: settings.providers.codebuddy.binaryPath.trim() || "codebuddy",
      prefixArgs: [] as string[],
      loginArgs: [] as string[],
      statusArgs: ["--version"],
      env: codeBuddySubscriptionEnvironment(env),
    };
  // Pi signs in with the TUI `/login` command; there is no login subcommand.
  if (harness === "pi")
    return {
      binary: settings.providers.pi.binaryPath.trim() || "pi",
      prefixArgs: [] as string[],
      loginArgs: [] as string[],
      statusArgs: ["--version"],
      env: piSubscriptionEnvironment(env, settings.providers.pi.agentDir),
    };
  // `muse login` shows a device code and opens the browser itself.
  if (harness === "muse")
    return {
      binary: settings.providers.muse.binaryPath.trim() || "muse",
      prefixArgs: [] as string[],
      loginArgs: ["login"],
      statusArgs: ["--version"],
      env: museSubscriptionEnvironment(env),
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
    // The active extra account (Settings → AI accounts) runs Codex from its own folder.
    const accountDir = activeCliAccountDir(settings, "codex");
    if (accountDir) env.CODEX_HOME = accountDir;
    else if (settings.providers.codex.homePath.trim())
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
    const accountDir = activeCliAccountDir(settings, "claudeAgent");
    if (accountDir) env.CLAUDE_CONFIG_DIR = accountDir;
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
  readLogin: typeof readClaudeLogin = readClaudeLogin,
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
  if (harness === "iflow")
    return {
      id: harness,
      installed: true,
      enabled: true,
      status: await probeIFlowSubscriptionAccount(invocation.binary, process.cwd()),
      version: version.stdout.trim().slice(0, 100),
    };
  if (harness === "gemini")
    return {
      id: harness,
      installed: true,
      enabled: true,
      status: await probeGeminiSubscriptionAccount(invocation.binary, process.cwd()),
      version: version.stdout.trim().slice(0, 100),
    };
  if (harness === "qwen")
    return {
      id: harness,
      installed: true,
      enabled: true,
      status: await probeQwenSubscriptionAccount(invocation.binary, process.cwd()),
      version: version.stdout.trim().slice(0, 100),
    };
  if (harness === "copilot")
    return {
      id: harness,
      installed: true,
      enabled: true,
      status: await probeCopilotSubscriptionAccount(invocation.binary, process.cwd()),
      version: version.stdout.trim().slice(0, 100),
    };
  if (harness === "codebuddy")
    return {
      id: harness,
      installed: true,
      enabled: true,
      status: await probeCodeBuddySubscriptionAccount(invocation.binary, process.cwd()),
      version: version.stdout.trim().slice(0, 100),
    };
  if (harness === "pi")
    return {
      id: harness,
      installed: true,
      enabled: true,
      status: await probePiSubscriptionAccount(
        invocation.binary,
        process.cwd(),
        settings.providers.pi.agentDir,
      ),
      version: version.stdout.trim().slice(0, 100),
    };
  if (harness === "muse")
    return {
      id: harness,
      installed: true,
      enabled: true,
      status: await probeMuseSubscriptionAccount(invocation.binary, process.cwd()),
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
  if (harness === "claudeAgent") {
    // Read the stored Claude.ai login: `claude auth status` could rotate its refresh token.
    const login = await readLogin({ configDir: invocation.env.CLAUDE_CONFIG_DIR });
    if (login.signedIn)
      return {
        id: harness,
        installed: true,
        enabled: true,
        status: "ready",
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
