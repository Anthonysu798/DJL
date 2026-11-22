import {
  BUILT_IN_PLUGINS,
  DJL_PLUGIN_MENTION_PREFIX,
  ThreadId,
  type PluginCatalogEntry,
} from "@djl/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { useComposerDraftStore } from "~/composerDraftStore";
import { useFocusedChatContext } from "~/focusedChatContext";
import { useHandleNewStudioChat } from "~/hooks/useHandleNewStudioChat";
import { useSyncServerWorkspacePathsFromConfig } from "~/hooks/useSyncServerWorkspacePathsFromConfig";
import { formatComposerMentionToken } from "~/lib/composerMentions";

/** Puts "@plugin prompt" into the focused chat's composer, or into a new chat if none is open. */
export function useTryPlugin() {
  useSyncServerWorkspacePathsFromConfig();
  const { handleNewStudioChat } = useHandleNewStudioChat();
  const { focusedThreadId } = useFocusedChatContext();
  const navigate = useNavigate();
  const [error, setError] = useState<string | undefined>();

  const tryPlugin = (plugin: PluginCatalogEntry, prompt: string) => {
    const targetThreadId = focusedThreadId ?? ThreadId.makeUnsafe(crypto.randomUUID());
    const draft = useComposerDraftStore.getState();
    const mention = BUILT_IN_PLUGINS.find((item) => item.plugin.id === plugin.id)?.mention ?? {
      name: plugin.name,
      path: `${DJL_PLUGIN_MENTION_PREFIX}${plugin.id}`,
    };
    const existing = draft.draftsByThreadId[targetThreadId];
    draft.setMentions(targetThreadId, [
      ...(existing?.mentions ?? []).filter((item) => item.path !== mention.path),
      mention,
    ]);
    draft.setPrompt(
      targetThreadId,
      `${existing?.prompt ? `${existing.prompt}\n\n` : ""}${formatComposerMentionToken(mention.name)} ${prompt}`,
    );
    if (focusedThreadId) {
      void navigate({ to: "/$threadId", params: { threadId: focusedThreadId } });
      return;
    }
    void handleNewStudioChat({ fresh: true, startupDraftId: targetThreadId })
      .then((result) => {
        if (!result.ok) setError(result.error.detail ?? result.error.summary);
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  };

  return { tryPlugin, error };
}
