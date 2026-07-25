// FILE: terminalCloseConfirmation.ts
// Purpose: Shares terminal-tab close confirmation copy and dialog plumbing across chat and workspace surfaces.
// Layer: UI logic helper
// Depends on: Native dialog contract from the app shell.

import type { NativeApi } from "@synara/contracts";
import type { TFunction } from "i18next";

// Prefer title overrides, then persisted labels, so confirmation copy matches visible tab names.
export function resolveTerminalCloseTitle(options: {
  terminalId: string;
  terminalLabelsById: Record<string, string>;
  terminalTitleOverridesById: Record<string, string>;
  t: TFunction<"workspace">;
}): string {
  return (
    options.terminalTitleOverridesById[options.terminalId]?.trim() ||
    options.terminalLabelsById[options.terminalId]?.trim() ||
    options.t("terminal.name")
  );
}

export function buildTerminalCloseConfirmationMessage(options: {
  terminalTitle: string | null | undefined;
  willDeleteThread: boolean;
  t: TFunction<"workspace">;
}): string {
  const title = options.terminalTitle?.trim();
  return [
    title ? options.t("terminalClose.confirmNamed", { title }) : options.t("terminalClose.confirm"),
    options.willDeleteThread
      ? options.t("terminalClose.historyAndThread")
      : options.t("terminalClose.history"),
  ].join("\n");
}

export function shouldPromptForTerminalClose(options: {
  confirmationEnabled: boolean;
  runningTerminalIds: readonly string[];
  terminalAttentionStatesById: Record<string, unknown>;
  terminalId: string;
}): boolean {
  if (!options.confirmationEnabled) {
    return false;
  }
  return (
    options.runningTerminalIds.includes(options.terminalId) ||
    options.terminalAttentionStatesById[options.terminalId] !== undefined
  );
}

export async function confirmTerminalTabClose(options: {
  api: Pick<NativeApi, "dialogs"> | null | undefined;
  enabled: boolean;
  terminalTitle: string | null | undefined;
  willDeleteThread?: boolean;
  t: TFunction<"workspace">;
}): Promise<boolean> {
  if (!options.enabled || !options.api) {
    return true;
  }

  return options.api.dialogs.confirm(
    buildTerminalCloseConfirmationMessage({
      terminalTitle: options.terminalTitle,
      willDeleteThread: options.willDeleteThread ?? false,
      t: options.t,
    }),
  );
}
