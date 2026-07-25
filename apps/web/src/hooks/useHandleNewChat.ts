import { useCallback } from "react";

import { ensureHomeChatProject } from "../lib/chatProjects";
import { startContainerChat, type StartContainerChatResult } from "../lib/startContainerChat";
import { useWorkspaceStore } from "../workspaceStore";
import { useHandleNewThread } from "./useHandleNewThread";
import { translateRendererCopy } from "../i18n";

export function useHandleNewChat() {
  const homeDir = useWorkspaceStore((state) => state.homeDir);
  const chatWorkspaceRoot = useWorkspaceStore((state) => state.chatWorkspaceRoot);
  const { handleNewThread } = useHandleNewThread();

  const handleNewChat = useCallback(
    async (options?: { fresh?: boolean }): Promise<StartContainerChatResult> => {
      if (!homeDir) {
        return {
          ok: false,
          error: {
            summary: translateRendererCopy(
              "common:hardening.homeUnavailable",
              "Home folder is not available yet.",
            ),
            detail: null,
          },
        };
      }

      return startContainerChat({
        ensureProjectId: () => ensureHomeChatProject({ homeDir, chatWorkspaceRoot }),
        handleNewThread,
        fresh: options?.fresh,
        errorLabel: translateRendererCopy(
          "common:hardening.newChatFailed",
          "Unable to prepare a new chat.",
        ),
      });
    },
    [chatWorkspaceRoot, handleNewThread, homeDir],
  );

  return { handleNewChat };
}
