// FILE: useThreadHandoff.ts
// Purpose: Creates provider-to-provider handoff threads from the active web state.
// Layer: Web hook
// Exports: useThreadHandoff

import { useNavigate } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import {
  type ModelSelection,
  type OrchestrationCommand,
  type ProviderKind,
} from "@synara/contracts";
import { useComposerDraftStore } from "../composerDraftStore";
import { useProviderStatusesForLocalConfig } from "./useProviderStatusesForLocalConfig";
import { useRefreshProviderStatusesNow } from "./useProviderStatusRefresh";
import {
  canCreateThreadHandoff,
  resolveAvailableHandoffTargetProviders,
  resolveThreadHandoffModelSelection,
  resolveThreadHandoffTitle,
} from "../lib/threadHandoff";
import { resolveProviderSendAvailabilityWithRefresh } from "../lib/providerAvailability";
import { newCommandId, newThreadId } from "../lib/utils";
import { readNativeApi } from "../nativeApi";
import { useStore } from "../store";
import { type Thread } from "../types";

let handoffCreationInFlight = false;
let pendingHandoffRetry: {
  key: string;
  command: Extract<OrchestrationCommand, { type: "thread.handoff.create" }>;
} | null = null;

export function useThreadHandoff() {
  const navigate = useNavigate();
  const projects = useStore((store) => store.projects);
  const syncServerShellSnapshot = useStore((store) => store.syncServerShellSnapshot);
  const providerStatuses = useProviderStatusesForLocalConfig();
  const refreshProviderStatuses = useRefreshProviderStatusesNow();
  const [isCreatingHandoff, setIsCreatingHandoff] = useState(false);

  const createThreadHandoff = useCallback(
    async (
      thread: Thread,
      targetProvider: ProviderKind,
      options?: {
        modelSelection?: ModelSelection;
        prompt?: string;
      },
    ): Promise<Thread["id"]> => {
      if (handoffCreationInFlight) throw new Error("A handoff is already being created.");
      if (options?.modelSelection && options.modelSelection.provider !== targetProvider) {
        throw new Error("The selected model does not belong to the handoff provider.");
      }
      handoffCreationInFlight = true;
      setIsCreatingHandoff(true);
      try {
        const api = readNativeApi();
        if (!api) {
          throw new Error("Native API not found");
        }

        const project = projects.find((entry) => entry.id === thread.projectId);
        if (!project) {
          throw new Error("Project not found for handoff thread.");
        }

        if (!canCreateThreadHandoff({ thread })) {
          throw new Error("This thread cannot be handed off yet.");
        }
        if (
          !resolveAvailableHandoffTargetProviders(thread.modelSelection.provider).includes(
            targetProvider,
          )
        ) {
          throw new Error("This handoff target is not available for the current thread.");
        }
        const targetAvailability = await resolveProviderSendAvailabilityWithRefresh({
          provider: targetProvider,
          statuses: providerStatuses,
          refreshStatuses: () => refreshProviderStatuses({ silent: true }),
        });
        if (!targetAvailability.usable) {
          throw new Error(targetAvailability.unavailableReason);
        }

        const createdAt = new Date().toISOString();
        const { copyTransferableComposerState, stickyModelSelectionByProvider } =
          useComposerDraftStore.getState();

        const modelSelection =
          options?.modelSelection ??
          resolveThreadHandoffModelSelection({
            sourceThread: thread,
            targetProvider,
            projectDefaultModelSelection: project.defaultModelSelection,
            stickyModelSelectionByProvider,
          });
        const runtimeMode = targetProvider === "claudeAgent" ? "bypass-permissions" : "full-access";
        const requestKey = JSON.stringify([
          runtimeMode,
          thread.id,
          thread.updatedAt,
          thread.messages.at(-1)?.id,
          modelSelection,
          options?.prompt,
        ]);
        // Reuse the command receipt after an uncertain network response so retry
        // cannot create a second destination for the same handoff.
        const command =
          pendingHandoffRetry?.key === requestKey
            ? pendingHandoffRetry.command
            : ({
                type: "thread.handoff.create",
                commandId: newCommandId(),
                threadId: newThreadId(),
                sourceThreadId: thread.id,
                expectedSourceUpdatedAt: thread.updatedAt ?? thread.createdAt,
                projectId: thread.projectId,
                title: resolveThreadHandoffTitle(thread),
                modelSelection,
                runtimeMode,
                interactionMode: thread.interactionMode,
                envMode: thread.envMode ?? (thread.worktreePath ? "worktree" : "local"),
                branch: thread.branch,
                worktreePath: thread.worktreePath,
                associatedWorktreePath:
                  thread.associatedWorktreePath ?? thread.worktreePath ?? null,
                associatedWorktreeBranch: thread.associatedWorktreeBranch ?? thread.branch ?? null,
                associatedWorktreeRef:
                  thread.associatedWorktreeRef ??
                  thread.associatedWorktreeBranch ??
                  thread.branch ??
                  null,
                createBranchFlowCompleted: thread.createBranchFlowCompleted ?? false,
                createdAt,
              } satisfies Extract<OrchestrationCommand, { type: "thread.handoff.create" }>);
        pendingHandoffRetry = { key: requestKey, command };
        await api.orchestration.dispatchCommand(command);
        const nextThreadId = command.threadId;

        copyTransferableComposerState(thread.id, nextThreadId);
        if (options?.prompt !== undefined) {
          useComposerDraftStore.getState().setPrompt(nextThreadId, options.prompt);
        }

        const snapshot = await api.orchestration.getShellSnapshot();
        syncServerShellSnapshot(snapshot);
        await navigate({
          to: "/$threadId",
          params: { threadId: nextThreadId },
        });
        pendingHandoffRetry = null;

        return nextThreadId;
      } finally {
        handoffCreationInFlight = false;
        setIsCreatingHandoff(false);
      }
    },
    [navigate, projects, providerStatuses, refreshProviderStatuses, syncServerShellSnapshot],
  );

  return {
    createThreadHandoff,
    isCreatingHandoff,
  };
}
