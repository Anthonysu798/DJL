import type { ProviderStartOptions, ServerSettings } from "@synara/contracts";
import type { NativeProvider } from "./types";

/** Same server-owned settings used by Accounts; resolve defaults before persisting a session. */
export function nativeProfileOptions(
  provider: NativeProvider,
  settings: ServerSettings,
): ProviderStartOptions {
  switch (provider) {
    case "codex":
      return {
        codex: {
          binaryPath: settings.providers.codex.binaryPath.trim() || "codex",
          ...(settings.providers.codex.homePath.trim()
            ? { homePath: settings.providers.codex.homePath.trim() }
            : {}),
        },
      };
    case "claudeAgent":
      return {
        claudeAgent: { binaryPath: settings.providers.claudeAgent.binaryPath.trim() || "claude" },
      };
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
