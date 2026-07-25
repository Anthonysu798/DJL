// FILE: useHandleNewStudioChat.ts
// Purpose: Starts ordinary AI threads inside the hidden Studio project container.
// Layer: Web hook
// Exports: useHandleNewStudioChat

import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { ensureStudioProject } from "../lib/studioProjects";
import { startContainerChat, type StartContainerChatResult } from "../lib/startContainerChat";
import { useWorkspaceStore } from "../workspaceStore";
import { useHandleNewThread } from "./useHandleNewThread";

export function useHandleNewStudioChat() {
  const { t } = useTranslation("work");
  const homeDir = useWorkspaceStore((state) => state.homeDir);
  const chatWorkspaceRoot = useWorkspaceStore((state) => state.chatWorkspaceRoot);
  const studioWorkspaceRoot = useWorkspaceStore((state) => state.studioWorkspaceRoot);
  const { handleNewThread } = useHandleNewThread();

  const handleNewStudioChat = useCallback(
    async (options?: { fresh?: boolean }): Promise<StartContainerChatResult> =>
      startContainerChat({
        ensureProjectId: () =>
          ensureStudioProject({ homeDir, chatWorkspaceRoot, studioWorkspaceRoot }),
        handleNewThread,
        fresh: options?.fresh,
        errorLabel: t("studio.errors.prepareTask"),
      }),
    [chatWorkspaceRoot, handleNewThread, homeDir, studioWorkspaceRoot, t],
  );

  return { handleNewStudioChat };
}
