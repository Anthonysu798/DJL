import type { ComposerThreadDraftState } from "./composerDraftStore";
import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useComposerDraftStore } from "./composerDraftStore";
import { isElectron } from "./env";
import { useFocusedChatContext } from "./focusedChatContext";
import { providerDiscoveryQueryKeys } from "./lib/providerDiscoveryReactQuery";
import { writeLocalModelsBrowserCache } from "./lib/localModelsBrowserCache";
import { ensureNativeApi } from "./nativeApi";

type AutoSelectThread = {
  readonly messages: ReadonlyArray<unknown>;
  readonly latestTurn: unknown | null;
  readonly session: { readonly activeTurnId?: unknown } | null;
};

export function isLocalModelAutoSelectEligible(input: {
  readonly thread: AutoSelectThread | null;
  readonly draft: ComposerThreadDraftState | undefined;
}): boolean {
  if (
    input.thread &&
    (input.thread.messages.length > 0 ||
      input.thread.latestTurn !== null ||
      input.thread.session?.activeTurnId !== undefined)
  ) {
    return false;
  }
  const draft = input.draft;
  if (!draft) return true;
  return (
    draft.prompt.trim().length === 0 &&
    draft.promptHistorySavedDraft === null &&
    draft.images.length === 0 &&
    draft.files.length === 0 &&
    draft.nonPersistedImageIds.length === 0 &&
    draft.persistedAttachments.length === 0 &&
    draft.browserFindings.length === 0 &&
    draft.assistantSelections.length === 0 &&
    draft.terminalContexts.length === 0 &&
    draft.fileComments.length === 0 &&
    draft.pastedTexts.length === 0 &&
    draft.skills.length === 0 &&
    draft.mentions.length === 0 &&
    draft.queuedTurns.length === 0 &&
    !draft.restoredSourceProposedPlan
  );
}

export function LocalModelSetupCoordinator() {
  const queryClient = useQueryClient();
  const { focusedThreadId, activeThread } = useFocusedChatContext();
  const draft = useComposerDraftStore((state) =>
    focusedThreadId ? state.draftsByThreadId[focusedThreadId] : undefined,
  );
  const setModelSelectionAndSticky = useComposerDraftStore(
    (state) => state.setModelSelectionAndSticky,
  );
  const initialized = useRef(false);
  const seenReadyJobs = useRef(new Set<string>());

  useEffect(() => {
    if (!isElectron) return;
    return ensureNativeApi().localModels.onEvent((event) => {
      writeLocalModelsBrowserCache(event.snapshot);
      queryClient.setQueryData(["local-models", "snapshot"], event.snapshot);
      const readyJobs = event.snapshot.setupJobs.filter(({ state }) => state === "ready");
      if (!initialized.current) {
        initialized.current = true;
        for (const job of readyJobs) seenReadyJobs.current.add(job.id);
        return;
      }
      for (const job of readyJobs) {
        if (seenReadyJobs.current.has(job.id)) continue;
        seenReadyJobs.current.add(job.id);
        void (async () => {
          await queryClient.invalidateQueries({ queryKey: providerDiscoveryQueryKeys.all });
          await queryClient.refetchQueries({ queryKey: providerDiscoveryQueryKeys.all });
          if (focusedThreadId && isLocalModelAutoSelectEligible({ thread: activeThread, draft })) {
            setModelSelectionAndSticky(focusedThreadId, {
              provider: "opencode",
              model: `${job.runtime}/${job.modelId}`,
            });
          }
        })();
      }
    });
  }, [activeThread, draft, focusedThreadId, queryClient, setModelSelectionAndSticky]);

  return null;
}
