// FILE: useKanbanTaskSubmit.ts
// Purpose: Owns the kanban new-task dialog's draft/create/send lifecycle.
// Layer: Kanban UI hook
// Exports: useKanbanTaskSubmit

import type {
  AssistantDeliveryMode,
  ModelSlug,
  ProjectId,
  ProviderInteractionMode,
  ProviderKind,
  ProviderStartOptions,
  RuntimeMode,
  ServerProviderStatus,
  ThreadId,
} from "@synara/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { toastManager } from "~/components/ui/toast";
import type { DraftThreadEnvMode } from "~/composerDraftStore";
import { useRefreshProviderStatusesNow } from "~/hooks/useProviderStatusRefresh";
import { createAndSendKanbanTask, createKanbanDraftTask } from "~/lib/kanbanTaskCreate";
import { resolveProviderSendAvailabilityWithRefresh } from "~/lib/providerAvailability";
import { buildModelSelection } from "~/providerModelOptions";
import { truncateKanbanTaskPreview } from "./KanbanNewTaskDialog.logic";

interface UseKanbanTaskSubmitInput {
  readonly selectedProjectId: ProjectId | null;
  readonly hasSendableContent: boolean;
  readonly selectedProvider: ProviderKind;
  readonly selectedModel: ModelSlug | null;
  readonly taskPreview: string;
  readonly trimmedPrompt: string;
  readonly scratchThreadId: ThreadId;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
  readonly envMode: DraftThreadEnvMode;
  readonly sendAsDraft: boolean;
  readonly defaultProvider: ProviderKind;
  readonly assistantDeliveryMode: AssistantDeliveryMode;
  readonly providerOptionsForDispatch: ProviderStartOptions | undefined;
  readonly providerStatuses: readonly ServerProviderStatus[];
  readonly onOpenChange: (open: boolean) => void;
}

export function useKanbanTaskSubmit(input: UseKanbanTaskSubmitInput) {
  const { t } = useTranslation("work");
  const {
    selectedProjectId,
    hasSendableContent,
    selectedProvider,
    selectedModel,
    taskPreview,
    trimmedPrompt,
    scratchThreadId,
    runtimeMode,
    interactionMode,
    envMode,
    sendAsDraft,
    defaultProvider,
    assistantDeliveryMode,
    providerOptionsForDispatch,
    providerStatuses,
    onOpenChange,
  } = input;
  const navigate = useNavigate();
  const [isCreating, setIsCreating] = useState(false);
  const refreshProviderStatuses = useRefreshProviderStatusesNow();
  // Synchronous re-entry guard: repeated Cmd+Enter can fire before React flushes
  // the loading state, and two passes here would create two tasks.
  const isCreatingRef = useRef(false);

  const canCreate =
    selectedProjectId !== null && hasSendableContent && selectedModel !== null && !isCreating;

  const handleCreate = useCallback(async () => {
    if (
      !selectedProjectId ||
      !hasSendableContent ||
      selectedModel === null ||
      isCreating ||
      isCreatingRef.current
    ) {
      return;
    }

    isCreatingRef.current = true;
    const truncatedPrompt = truncateKanbanTaskPreview(taskPreview);
    // Kanban intentionally has no model controls. Always rebuild the selection
    // from the configured app default at submission time so a scratch draft
    // cannot inherit a remembered chat provider/model.
    const modelSelection = buildModelSelection(selectedProvider, selectedModel);
    const taskInput = {
      projectId: selectedProjectId,
      prompt: trimmedPrompt,
      sourceComposerThreadId: scratchThreadId,
      modelSelection,
      runtimeMode,
      interactionMode,
      envMode,
    };

    if (sendAsDraft) {
      createKanbanDraftTask(taskInput);
      toastManager.add({
        type: "success",
        title: t("kanban.submit.addedToDrafts"),
        description: truncatedPrompt,
      });
      onOpenChange(false);
      return;
    }

    // Send now: create + promote + dispatch straight to In Progress.
    const sendAvailability = await resolveProviderSendAvailabilityWithRefresh({
      provider: modelSelection.provider,
      statuses: providerStatuses,
      refreshStatuses: () => refreshProviderStatuses({ silent: true }),
    });
    if (!sendAvailability.usable) {
      toastManager.add({
        type: "error",
        title: sendAvailability.unavailableReason,
      });
      isCreatingRef.current = false;
      return;
    }

    setIsCreating(true);
    void createAndSendKanbanTask({
      ...taskInput,
      defaultProvider,
      assistantDeliveryMode,
      providerOptions: providerOptionsForDispatch,
    })
      .then(({ threadId, result }) => {
        if (result.kind === "dispatched") {
          toastManager.add({
            type: "success",
            title: t("kanban.submit.started"),
            description: truncatedPrompt,
          });
          onOpenChange(false);
          return;
        }
        if (result.kind === "open-thread") {
          toastManager.add({
            type: "info",
            title: t("kanban.submit.finishInChat"),
            description:
              result.reason === "worktree-pending"
                ? t("kanban.submit.worktreePending")
                : t("kanban.submit.savedAsDraft"),
          });
          onOpenChange(false);
          void navigate({ to: "/$threadId", params: { threadId } });
          return;
        }
        // Promotion/dispatch could not complete faithfully; the draft still
        // exists on the board, so surface the failure and keep the dialog open.
        toastManager.add({
          type: "error",
          title: t("kanban.submit.failed"),
          description: result.kind === "error" ? result.message : t("kanban.submit.savedFallback"),
        });
        isCreatingRef.current = false;
        setIsCreating(false);
      })
      .catch((error: unknown) => {
        toastManager.add({
          type: "error",
          title: t("kanban.submit.failed"),
          description: error instanceof Error ? error.message : t("kanban.errors.unexpected"),
        });
        isCreatingRef.current = false;
        setIsCreating(false);
      });
  }, [
    assistantDeliveryMode,
    defaultProvider,
    envMode,
    hasSendableContent,
    interactionMode,
    isCreating,
    navigate,
    onOpenChange,
    providerOptionsForDispatch,
    providerStatuses,
    refreshProviderStatuses,
    runtimeMode,
    scratchThreadId,
    selectedModel,
    selectedProjectId,
    selectedProvider,
    sendAsDraft,
    taskPreview,
    t,
    trimmedPrompt,
  ]);

  return {
    isCreating,
    canCreate,
    handleCreate,
  };
}
