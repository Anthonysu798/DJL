import type { LocalModelSetupJob } from "@synara/contracts";
import { ThreadId } from "@synara/contracts";
import type { ComposerDraftStoreState, ComposerThreadDraftState } from "./composerDraftStore";
import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useComposerDraftStore } from "./composerDraftStore";
import { isElectron } from "./env";
import { useFocusedChatContext } from "./focusedChatContext";
import { providerDiscoveryQueryKeys } from "./lib/providerDiscoveryReactQuery";
import { writeLocalModelsBrowserCache } from "./lib/localModelsBrowserCache";
import {
  type LocalModelSetupContinuation,
  localModelSetupContinuationStore,
} from "./localModelSetupContinuationStore";
import { ensureNativeApi } from "./nativeApi";

type AutoSelectThread = {
  readonly messages: ReadonlyArray<unknown>;
  readonly latestTurn: unknown | null;
  readonly session: { readonly activeTurnId?: unknown } | null;
};

export function localModelCatalogFingerprint(snapshot: {
  readonly runtimes: ReadonlyArray<{ readonly runtime: string; readonly state: string }>;
  readonly installedModels: ReadonlyArray<{
    readonly runtime: string;
    readonly modelId: string;
  }>;
}): string {
  return [
    ...snapshot.runtimes.map(({ runtime, state }) => `${runtime}:${state}`),
    ...snapshot.installedModels.map(({ runtime, modelId }) => `${runtime}:${modelId}`),
  ]
    .toSorted()
    .join("|");
}

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

export type LocalModelSetupCoordinatorState = {
  initialized: boolean;
  readonly seenReadyJobs: Set<string>;
  readonly processingContinuationJobs: Set<string>;
};

export function createLocalModelSetupCoordinatorState(): LocalModelSetupCoordinatorState {
  return {
    initialized: false,
    seenReadyJobs: new Set<string>(),
    processingContinuationJobs: new Set<string>(),
  };
}

type CoordinateReadyJobsInput = {
  readonly jobs: ReadonlyArray<LocalModelSetupJob>;
  readonly state: LocalModelSetupCoordinatorState;
  readonly continuation: LocalModelSetupContinuation | null;
  readonly focusedThreadId: ThreadId | null;
  readonly activeThread: AutoSelectThread | null;
  readonly draft: ComposerThreadDraftState | undefined;
  readonly refreshProviderDiscovery: () => Promise<void>;
  readonly setModelSelectionAndSticky: ComposerDraftStoreState["setModelSelectionAndSticky"];
  readonly markContinuationReady: (jobId: string, expectedModelSlug: string) => boolean;
};

export function coordinateReadyLocalModelSetupJobs(
  input: CoordinateReadyJobsInput,
): ReadonlyArray<Promise<void>> {
  const initialSnapshot = !input.state.initialized;
  input.state.initialized = true;
  const tasks: Promise<void>[] = [];

  for (const job of input.jobs) {
    if (job.state !== "ready") continue;

    const continuation = input.continuation;
    const matchesWaitingContinuation =
      continuation?.state === "waiting" && continuation.jobId === job.id;
    if (matchesWaitingContinuation) {
      if (input.state.processingContinuationJobs.has(job.id)) continue;
      input.state.seenReadyJobs.add(job.id);
      input.state.processingContinuationJobs.add(job.id);
      tasks.push(
        (async () => {
          try {
            await input.refreshProviderDiscovery();
            const readyModelSlug = `${job.runtime}/${job.modelId}`;
            input.setModelSelectionAndSticky(ThreadId.makeUnsafe(continuation.threadId), {
              provider: "opencode",
              model: readyModelSlug,
            });
            input.markContinuationReady(job.id, readyModelSlug);
          } finally {
            input.state.processingContinuationJobs.delete(job.id);
          }
        })(),
      );
      continue;
    }

    if (initialSnapshot) {
      input.state.seenReadyJobs.add(job.id);
      continue;
    }
    if (input.state.seenReadyJobs.has(job.id)) continue;
    input.state.seenReadyJobs.add(job.id);
    tasks.push(
      (async () => {
        await input.refreshProviderDiscovery();
        if (
          input.focusedThreadId &&
          isLocalModelAutoSelectEligible({ thread: input.activeThread, draft: input.draft })
        ) {
          input.setModelSelectionAndSticky(input.focusedThreadId, {
            provider: "opencode",
            model: `${job.runtime}/${job.modelId}`,
          });
        }
      })(),
    );
  }

  return tasks;
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
  const modelCatalogFingerprint = useRef("");
  const coordinatorState = useRef(createLocalModelSetupCoordinatorState());

  useEffect(() => {
    if (!isElectron) return;
    return ensureNativeApi().localModels.onEvent((event) => {
      writeLocalModelsBrowserCache(event.snapshot);
      queryClient.setQueryData(["local-models", "snapshot"], event.snapshot);
      const nextCatalogFingerprint = localModelCatalogFingerprint(event.snapshot);
      if (modelCatalogFingerprint.current !== nextCatalogFingerprint) {
        modelCatalogFingerprint.current = nextCatalogFingerprint;
        void queryClient.invalidateQueries({
          queryKey: ["provider-discovery", "models", "opencode"],
        });
      }
      const tasks = coordinateReadyLocalModelSetupJobs({
        jobs: event.snapshot.setupJobs,
        state: coordinatorState.current,
        continuation: localModelSetupContinuationStore.getSnapshot(),
        focusedThreadId,
        activeThread,
        draft,
        refreshProviderDiscovery: async () => {
          await queryClient.invalidateQueries({ queryKey: providerDiscoveryQueryKeys.all });
          await queryClient.refetchQueries({ queryKey: providerDiscoveryQueryKeys.all });
        },
        setModelSelectionAndSticky,
        markContinuationReady: (jobId, expectedModelSlug) =>
          localModelSetupContinuationStore.markReady(jobId, expectedModelSlug),
      });
      for (const task of tasks) {
        void task.catch(() => undefined);
      }
    });
  }, [activeThread, draft, focusedThreadId, queryClient, setModelSelectionAndSticky]);

  return null;
}
