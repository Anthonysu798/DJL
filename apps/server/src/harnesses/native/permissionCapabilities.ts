import {
  permissionModesForProvider,
  type ProviderComposerCapabilities,
  type ProviderStartOptions,
  type RuntimeMode,
} from "@synara/contracts";
import { probe } from "../accounts";
import { resolveClaudeExecutable } from "./claudeExecutable";
import { NativeRpc, object } from "./protocol";
import type { NativeProvider } from "./types";

type Modes = NonNullable<ProviderComposerCapabilities["permissionModes"]>;
const cache = new Map<string, { expires: number; value: Modes }>();
const rejectedModes = new Map<string, { expires: number; reason: string }>();

export function recordPermissionRejection(
  provider: NativeProvider,
  mode: RuntimeMode,
  options: ProviderStartOptions,
  error: unknown,
) {
  const reason = error instanceof Error ? error.message : "";
  if (
    !/(auto mode|bypass|approval.?review|permission mode).*(unavailable|unsupported|not supported|disabled|not allowed)|(?:disabled|not allowed).*(auto|bypass)/i.test(
      reason,
    )
  )
    return;
  const key = `${provider}:${JSON.stringify(options)}`;
  cache.delete(key);
  rejectedModes.set(`${key}:${mode}`, { expires: Date.now() + 30_000, reason });
}

export async function nativePermissionModes(
  provider: NativeProvider,
  options: ProviderStartOptions,
): Promise<Modes> {
  const key = `${provider}:${JSON.stringify(options)}`;
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;
  let modes = permissionModesForProvider(provider).map((mode) => ({
    mode,
    available: true,
    reason: undefined as string | undefined,
  }));
  const disable = (mode: RuntimeMode, reason: string) => {
    modes = modes.map((entry) =>
      entry.mode === mode ? { ...entry, available: false, reason } : entry,
    );
  };
  try {
    if (provider === "claudeAgent") {
      const binary = await resolveClaudeExecutable(options.claudeAgent?.binaryPath ?? "claude");
      const version = await probe(binary, ["--version"], process.env);
      const parts = version.stdout
        .match(/(\d+)\.(\d+)\.(\d+)/)
        ?.slice(1)
        .map(Number);
      if (version.code !== 0 || !parts)
        throw new Error("Could not verify the configured Claude Code installation");
      if (
        parts[0]! < 2 ||
        (parts[0] === 2 && parts[1] === 0) ||
        (parts[0] === 2 && parts[1] === 1 && parts[2]! < 83)
      )
        disable("auto-approval", "Update Claude Code to use Auto mode");
    } else if (provider === "codex") {
      const env = options.codex?.homePath
        ? { ...process.env, CODEX_HOME: options.codex.homePath }
        : process.env;
      const version = await probe(options.codex?.binaryPath ?? "codex", ["--version"], env);
      const parts = version.stdout
        .match(/(\d+)\.(\d+)\.(\d+)/)
        ?.slice(1)
        .map(Number);
      if (!parts || version.code !== 0)
        throw new Error("Could not verify the configured Codex installation");
      if (parts[0] === 0 && (parts[1]! < 153 || (parts[1] === 153 && parts[2]! < 4)))
        disable("auto-approval", "Update Codex to use native Approve for me");
      const rpc = new NativeRpc(
        options.codex?.binaryPath ?? "codex",
        ["app-server"],
        process.cwd(),
        env,
      );
      try {
        await rpc.request("initialize", {
          clientInfo: { name: "djl_permissions", version: "1.0.0" },
        });
        rpc.notify("initialized");
        const result = object(await rpc.request("configRequirements/read", {}));
        const requirements = result.requirements ? object(result.requirements) : {};
        const policies = requirements.allowedApprovalPolicies;
        const sandboxes = requirements.allowedSandboxModes;
        const reviewers = requirements.allowedApprovalsReviewers;
        if (Array.isArray(reviewers) && !reviewers.includes("user")) {
          disable("approval-required", "Codex organization policy requires an automatic reviewer");
          disable("full-access", "Codex organization policy requires an automatic reviewer");
        }
        const profiles = requirements.allowedPermissionProfiles
          ? object(requirements.allowedPermissionProfiles)
          : undefined;
        if (
          (Array.isArray(policies) && !policies.includes("on-request")) ||
          (Array.isArray(sandboxes) && !sandboxes.includes("workspace-write")) ||
          (Array.isArray(reviewers) && !reviewers.includes("auto_review")) ||
          (profiles !== undefined && profiles[":workspace"] !== true)
        )
          disable(
            "auto-approval",
            "Codex organization policy does not allow this automatic-review profile",
          );
        if (
          (Array.isArray(policies) && !policies.includes("never")) ||
          (Array.isArray(sandboxes) && !sandboxes.includes("danger-full-access")) ||
          (profiles !== undefined && profiles[":danger-full-access"] !== true)
        )
          disable("full-access", "Codex organization policy does not allow Full access");
        if (Array.isArray(policies) && !policies.includes("untrusted"))
          disable("approval-required", "Codex organization policy does not allow the Ask profile");
      } finally {
        rpc.close();
      }
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Could not verify provider permissions";
    modes = modes.map((entry) => ({ ...entry, available: false, reason }));
  }
  // eslint-disable-next-line oxc/no-map-spread -- Keep caller-owned records immutable.
  const value: Modes = modes.map(({ reason, ...entry }) => {
    const rejected = rejectedModes.get(`${key}:${entry.mode}`);
    if (rejected && rejected.expires > Date.now())
      return { ...entry, available: false, reason: rejected.reason };
    return { ...entry, ...(reason ? { reason } : {}) };
  });
  cache.set(key, { expires: Date.now() + 30_000, value });
  return value;
}
