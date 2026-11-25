import type { ProviderStartOptions, ServerSettings } from "@djl/contracts";
import type { NativeProvider } from "./types";
import { activeCliAccountDir, chatCliAccountDir } from "../cliAccountSelection";

/** Same server-owned settings used by Accounts; resolve defaults before persisting a session. */
export function nativeProfileOptions(
  provider: NativeProvider,
  settings: ServerSettings,
): ProviderStartOptions {
  switch (provider) {
    case "kimi":
      return {
        kimi: {
          binaryPath: settings.providers.kimi.binaryPath.trim() || "kimi",
          region: settings.providers.kimi.region,
        },
      };
    case "grok":
      return { grok: { binaryPath: settings.providers.grok.binaryPath.trim() || "grok" } };
    case "iflow":
      return { iflow: { binaryPath: settings.providers.iflow.binaryPath.trim() || "iflow" } };
    case "qwen":
      return { qwen: { binaryPath: settings.providers.qwen.binaryPath.trim() || "qwen" } };
    case "copilot":
      return {
        copilot: { binaryPath: settings.providers.copilot.binaryPath.trim() || "copilot" },
      };
    case "gemini":
      return { gemini: { binaryPath: settings.providers.gemini.binaryPath.trim() || "gemini" } };
    case "codebuddy":
      return {
        codebuddy: { binaryPath: settings.providers.codebuddy.binaryPath.trim() || "codebuddy" },
      };
    case "pi":
      return {
        pi: {
          binaryPath: settings.providers.pi.binaryPath.trim() || "pi",
          ...(settings.providers.pi.agentDir.trim()
            ? { agentDir: settings.providers.pi.agentDir.trim() }
            : {}),
        },
      };
    case "codex": {
      // New chats use the account chosen in Settings → AI accounts; resumed ones keep theirs.
      const homePath =
        activeCliAccountDir(settings, "codex") ?? settings.providers.codex.homePath.trim();
      return {
        codex: {
          binaryPath: settings.providers.codex.binaryPath.trim() || "codex",
          ...(homePath ? { homePath } : {}),
        },
      };
    }
    case "claudeAgent": {
      const configDir = activeCliAccountDir(settings, "claudeAgent");
      return {
        claudeAgent: {
          binaryPath: settings.providers.claudeAgent.binaryPath.trim() || "claude",
          ...(configDir ? { configDir } : {}),
        },
      };
    }
    case "muse":
      return { muse: { binaryPath: settings.providers.muse.binaryPath.trim() || "muse" } };
    case "doubao":
      return {
        doubao: {
          binaryPath: settings.providers.doubao.binaryPath.trim() || "claude",
          region: settings.providers.doubao.region,
        },
      };
    case "deepseek":
      return {
        deepseek: { binaryPath: settings.providers.deepseek.binaryPath.trim() || "claude" },
      };
    case "djlCloud":
      return { djlCloud: { region: settings.providers.djlCloud.region } };
    case "group":
      // Each member resolves its own profile when the group opens it.
      return {};
    case "cursor":
      return {
        cursor: {
          binaryPath: settings.providers.cursor.binaryPath.trim() || "cursor-agent",
          ...(settings.providers.cursor.apiEndpoint.trim()
            ? { apiEndpoint: settings.providers.cursor.apiEndpoint.trim() }
            : {}),
        },
      };
  }
}

export function mergeNativeProfile(
  provider: NativeProvider,
  base?: ProviderStartOptions,
  override?: ProviderStartOptions,
): ProviderStartOptions {
  return { [provider]: { ...base?.[provider], ...override?.[provider] } };
}

/**
 * Applies the account a chat chose (`cliAccountId` in its Claude / Codex options) on top of the
 * merged profile: the server owns the folder, so a client-sent `homePath` / `configDir` never
 * overrides it. Unknown ids fall back to the app-wide account.
 */
export function applyChatAccount(
  provider: NativeProvider,
  options: ProviderStartOptions,
  settings: ServerSettings,
): ProviderStartOptions {
  if (provider === "codex") {
    const current = options.codex;
    const id = current?.cliAccountId;
    if (!current || !id) return options;
    const account = chatCliAccountDir(settings, "codex", id);
    if (!account) {
      const { cliAccountId: _unknown, ...rest } = current;
      return { codex: rest };
    }
    const { homePath: _clientHome, ...rest } = current;
    const homePath = account.dir ?? settings.providers.codex.homePath.trim();
    return { codex: { ...rest, ...(homePath ? { homePath } : {}) } };
  }
  if (provider === "claudeAgent") {
    const current = options.claudeAgent;
    const id = current?.cliAccountId;
    if (!current || !id) return options;
    const account = chatCliAccountDir(settings, "claudeAgent", id);
    if (!account) {
      const { cliAccountId: _unknown, ...rest } = current;
      return { claudeAgent: rest };
    }
    const { configDir: _previous, ...rest } = current;
    return { claudeAgent: { ...rest, ...(account.dir ? { configDir: account.dir } : {}) } };
  }
  return options;
}

/** The account folder a profile runs in (Codex home / Claude config dir), for comparisons. */
export function profileAccountDir(
  provider: NativeProvider,
  options: ProviderStartOptions | undefined,
): string | undefined {
  if (provider === "codex") return options?.codex?.homePath;
  if (provider === "claudeAgent") return options?.claudeAgent?.configDir;
  return undefined;
}
