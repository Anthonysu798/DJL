// FILE: workDraftRuntimeMode.ts
// Purpose: The permission mode a new Work chat starts in. Work users should not be asked to
//          approve commands they cannot judge, so the chat starts in the safest automatic mode
//          the agent offers (Claude's Auto classifier, Codex's sandboxed auto-review). An agent
//          without one asks, in plain words; it never starts in full access.
// Layer: Web chat helper

import type { ProviderComposerCapabilities, ProviderKind, RuntimeMode } from "@djl/contracts";

export function workDraftRuntimeMode(input: {
  provider: ProviderKind;
  permissionModes: ProviderComposerCapabilities["permissionModes"];
  /** False when the selected model cannot run Claude's Auto mode. */
  supportsAutoMode: boolean | undefined;
}): RuntimeMode {
  const offersAutomaticMode =
    (input.provider === "claudeAgent" || input.provider === "codex") &&
    input.supportsAutoMode !== false &&
    input.permissionModes?.some((entry) => entry.mode === "auto-approval" && entry.available) ===
      true;
  return offersAutomaticMode ? "auto-approval" : "approval-required";
}
