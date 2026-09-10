import { execFile } from "node:child_process";
import { Effect } from "effect";
import type {
  HarnessTool,
  HarnessToolId,
  HarnessMaintainToolInput,
  ServerSettings,
} from "@synara/contracts";
import { prepareWindowsSafeProcess } from "@synara/shared/windowsProcess";
import { probe } from "./accounts";
import { inspectGrokTool, maintainGrokTool } from "./grokTools";
import { inspectCursorTool, maintainCursorTool } from "./cursorTools";
import { inspectKimiNativeTool, maintainKimiNativeTool } from "./kimiTools";
import { isNativeKimiPath, resolveKimiBinaryPath } from "./kimiExecutable";
import { inspectInstalledOpenCodeProtocol } from "../provider/openCodeInstalledProtocol";
import { resolveDjlOpenCodeBinaryPath } from "../provider/opencodeRuntime";
import { PACKAGE_MANAGED_PROVIDER_UPDATES } from "../provider/Layers/ProviderHealth";
import {
  createProviderVersionAdvisory,
  parseGenericCliVersion,
  resolveLatestProviderVersion,
  resolveProviderMaintenanceCapabilitiesEffect,
  type PackageManagedProviderMaintenanceDefinition,
} from "../provider/providerMaintenance";

const TOOL_IDS = [
  "codex",
  "claudeAgent",
  "opencode",
  "grok",
  "kimi",
  "iflow",
  "qwen",
  "codebuddy",
  "pi",
  "cursor",
] as const;
const KIMI_TOOL: PackageManagedProviderMaintenanceDefinition = {
  provider: "kimi",
  binaryName: "kimi",
  npmPackageName: "@moonshot-ai/kimi-code",
  homebrew: null,
  nativeUpdate: null,
};
const OPENCODE_TOOL: PackageManagedProviderMaintenanceDefinition = {
  provider: "opencode",
  binaryName: "opencode",
  npmPackageName: "opencode-ai",
  homebrew: { name: "opencode", kind: "formula" },
  nativeUpdate: {
    executable: "opencode",
    args: () => ["upgrade"],
    lockKey: "opencode-cli",
    strategy: "matching-path",
    isCommandPath: (path) => /[/\\]\.opencode[/\\]bin[/\\]opencode(?:\.exe)?$/.test(path),
  },
};

function definition(id: HarnessToolId) {
  if (id === "kimi") return KIMI_TOOL;
  return id === "opencode" ? OPENCODE_TOOL : PACKAGE_MANAGED_PROVIDER_UPDATES[id]!;
}

// Tool maintenance uses the same executable as accounts and chat.
function binaryPath(id: HarnessToolId, settings: ServerSettings) {
  if (id === "kimi") return resolveKimiBinaryPath(settings.providers.kimi.binaryPath);
  return id === "opencode"
    ? resolveDjlOpenCodeBinaryPath(settings.providers.opencode.binaryPath)
    : settings.providers[id].binaryPath.trim() || definition(id).binaryName;
}

export const inspectHarnessTool = Effect.fn("inspectHarnessTool")(function* (
  id: HarnessToolId,
  settings: ServerSettings,
) {
  if (id === "grok") return yield* Effect.promise(() => inspectGrokTool(settings));
  if (id === "cursor") return yield* Effect.promise(() => inspectCursorTool(settings));
  const binary = binaryPath(id, settings);
  const result = yield* Effect.promise(() => probe(binary, ["--version"], process.env));
  if (id === "kimi") {
    const native = yield* Effect.promise(() => inspectKimiNativeTool(settings, binary, result));
    if (native) return native;
  }
  const capabilities = yield* resolveProviderMaintenanceCapabilitiesEffect(definition(id), {
    binaryPath: binary,
  });
  const latestVersion = settings.enableProviderUpdateChecks
    ? yield* resolveLatestProviderVersion(capabilities, true)
    : null;
  const currentVersion = result.code === 0 ? parseGenericCliVersion(result.stdout) : null;
  const compatibility =
    id === "opencode" && currentVersion
      ? yield* Effect.promise(() => inspectInstalledOpenCodeProtocol(binary, currentVersion))
      : {};
  const advisory = createProviderVersionAdvisory({ provider: id, currentVersion, latestVersion });
  const npm =
    result.missing && binary === definition(id).binaryName
      ? yield* Effect.promise(() => probe("npm", ["--version"], process.env))
      : null;
  return {
    id,
    ...compatibility,
    installed: result.code === 0,
    currentVersion,
    latestVersion,
    status: advisory.status,
    canInstall: npm?.code === 0,
    canUpdate: result.code === 0 && capabilities.update !== null && settings.providers[id].enabled,
  } satisfies HarnessTool;
});

export function runToolCommand(
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const launch = prepareWindowsSafeProcess(command, args, {
    env,
    platform: process.platform,
  });
  return new Promise((resolve, reject) => {
    execFile(
      launch.command,
      launch.args,
      {
        ...launch,
        env,
        timeout: 8 * 60_000,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      },
      (error) => {
        // Do not return package-manager output: local registry configuration can contain credentials.
        if (error)
          reject(
            new Error(
              error.killed
                ? "Installation timed out. Check the provider setup guide and try again."
                : "Installation failed. Check network access and installation permissions in the provider setup guide.",
            ),
          );
        else resolve();
      },
    );
  });
}

export const maintainHarnessTool = Effect.fn("maintainHarnessTool")(function* (
  before: HarnessTool,
  settings: ServerSettings,
) {
  if (before.id === "grok")
    return yield* Effect.tryPromise(() => maintainGrokTool(before, settings, runToolCommand));
  if (before.id === "cursor")
    return yield* Effect.tryPromise(() => maintainCursorTool(before, settings, runToolCommand));
  if (before.id === "kimi" && (!before.installed || isNativeKimiPath(binaryPath("kimi", settings))))
    return yield* Effect.tryPromise(() => maintainKimiNativeTool(before, runToolCommand));
  if (!before.installed) {
    yield* Effect.tryPromise(() =>
      runToolCommand("npm", ["install", "-g", `${definition(before.id).npmPackageName}@latest`]),
    );
    return;
  }
  const capabilities = yield* resolveProviderMaintenanceCapabilitiesEffect(definition(before.id), {
    binaryPath: binaryPath(before.id, settings),
  });
  if (!capabilities.update)
    return yield* Effect.fail(
      new Error("Use the provider setup guide to update this installation."),
    );
  const update = capabilities.update;
  yield* Effect.tryPromise(() => runToolCommand(update.executable, update.args));
});

export function createHarnessToolsController(deps: {
  inspect: (id: HarnessToolId) => Promise<HarnessTool>;
  run: (before: HarnessTool) => Promise<void>;
  isIdle?: () => Promise<boolean>;
}) {
  let running = false;
  const maintenance = new Map<HarnessToolId, HarnessTool["maintenanceStatus"]>();
  return {
    list: async () => ({
      tools: await Promise.all(
        TOOL_IDS.map(async (id) => {
          const tool = await deps.inspect(id);
          const status = maintenance.get(id);
          return status ? Object.assign({}, tool, { maintenanceStatus: status }) : tool;
        }),
      ),
    }),
    async maintain(input: HarnessMaintainToolInput): Promise<HarnessTool> {
      if (running) throw new Error("A provider installation or update is already running.");
      running = true;
      maintenance.set(input.harness, "running");
      try {
        const before = await deps.inspect(input.harness);
        if (deps.isIdle && !(await deps.isIdle()))
          throw new Error(
            "Finish running chats and close terminals before updating provider tools.",
          );
        if (!(before.installed ? before.canUpdate : before.canInstall))
          throw new Error("Use the provider setup guide for this installation.");
        await deps.run(before);
        const after = await deps.inspect(input.harness);
        if (!after.installed || !after.currentVersion)
          throw new Error(
            "The CLI was not detected after installation. Check PATH and the provider setup guide.",
          );
        if (after.id === "opencode" && after.compatible !== true)
          throw new Error(
            after.compatibilityMessage ??
              "OpenCode protocol compatibility could not be verified. Check the provider setup guide.",
          );
        if (after.status === "behind_latest")
          throw new Error(
            "The command finished, but the detected CLI is still outdated. Check for another installation earlier in PATH.",
          );
        if (!after.latestVersion)
          throw new Error(
            "The CLI is installed, but the latest version could not be verified. Check for updates again.",
          );
        maintenance.set(input.harness, "succeeded");
        return { ...after, maintenanceStatus: "succeeded" };
      } catch (error) {
        maintenance.set(input.harness, "failed");
        throw error;
      } finally {
        running = false;
      }
    },
  };
}
