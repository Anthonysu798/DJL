// FILE: _chat.index.tsx
// Purpose: Starts a fresh home-chat draft whenever the app opens.
// Layer: Routing
// Depends on: the shared route surface and the home-chat new-chat handler.

import { createFileRoute } from "@tanstack/react-router";
import { useCallback } from "react";

import { RestoreOrCreateChatRoute } from "../components/RestoreOrCreateChatRoute";
import { useHandleNewChat } from "../hooks/useHandleNewChat";

function ChatIndexRouteView() {
  const { handleNewChat } = useHandleNewChat();
  const createFreshChat = useCallback(() => handleNewChat({ fresh: true }), [handleNewChat]);

  return (
    <RestoreOrCreateChatRoute
      mode="fresh"
      resolveRestoreRoute={() => null}
      createFreshChat={createFreshChat}
    />
  );
}

export const Route = createFileRoute("/_chat/")({
  component: ChatIndexRouteView,
});
