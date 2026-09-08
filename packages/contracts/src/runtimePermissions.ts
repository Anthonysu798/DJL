import type { ProviderKind } from "./orchestration";
import { Schema } from "effect";

export const RuntimeMode = Schema.Literals([
  "approval-required",
  "accept-edits",
  "auto-approval",
  "full-access",
  "bypass-permissions",
]);
export type RuntimeMode = typeof RuntimeMode.Type;

export function effectiveRuntimeMode(provider: ProviderKind, mode: RuntimeMode): RuntimeMode {
  if (provider === "claudeAgent" && mode === "full-access") return "approval-required";
  if (provider !== "claudeAgent" && mode === "bypass-permissions") return "approval-required";
  return mode;
}

export function permissionModesForProvider(provider: ProviderKind): readonly RuntimeMode[] {
  if (provider === "claudeAgent")
    return ["approval-required", "accept-edits", "auto-approval", "bypass-permissions"];
  if (provider === "codex" || provider === "opencode")
    return ["approval-required", "auto-approval", "full-access"];
  return ["approval-required", "full-access"];
}
