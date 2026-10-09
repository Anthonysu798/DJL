// FILE: _chat.index.tsx
// Purpose: Starts a fresh home-chat draft whenever the app opens.
// Layer: Routing
// Depends on: the shared route surface and the home-chat new-chat handler.

import { ThreadId } from "@synara/contracts";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

import { RestoreOrCreateChatRoute } from "../components/RestoreOrCreateChatRoute";
import { useWorkspaceStore } from "../workspaceStore";
import { useStore } from "../store";
import { useComposerDraftStore } from "../composerDraftStore";
import { getStartupSeed, startupNavigationIsCurrent } from "../startup/session";
import { useHandleNewChat } from "../hooks/useHandleNewChat";

function ChatIndexRouteView() {
  const { handleNewChat } = useHandleNewChat();
  const homeDir = useWorkspaceStore((state) => state.homeDir);
  const hydrated = useStore((state) => state.threadsHydrated);
  const navigate = useNavigate();
  const createFreshChat = useCallback(async () => {
    const seed = getStartupSeed("home");
    if (
      seed &&
      (useStore.getState().threadShellById?.[ThreadId.makeUnsafe(seed)] ||
        useComposerDraftStore.getState().draftThreadsByThreadId[ThreadId.makeUnsafe(seed)])
    ) {
      if (startupNavigationIsCurrent("home"))
        await navigate({
          to: "/$threadId",
          params: { threadId: ThreadId.makeUnsafe(seed) },
          replace: true,
        });
      return { ok: true } as const;
    }
    return handleNewChat({
      fresh: true,
      ...(seed
        ? {
            startupDraftId: ThreadId.makeUnsafe(seed),
            shouldNavigate: () => startupNavigationIsCurrent("home"),
          }
        : {}),
    });
  }, [handleNewChat, navigate]);

  return (
    <RestoreOrCreateChatRoute
      mode="fresh"
      ready={Boolean(homeDir) && (!getStartupSeed("home") || hydrated)}
      resolveRestoreRoute={() => null}
      createFreshChat={createFreshChat}
    />
  );
}

export const Route = createFileRoute("/_chat/")({
  component: ChatIndexRouteView,
});
