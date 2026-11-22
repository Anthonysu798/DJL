import type {
  ClientOrchestrationCommand,
  ComputerActivitySemanticSummary,
  ProviderKind,
  ThreadId,
} from "@djl/contracts";
import {
  flushComposerDraftPersistence,
  resolvePreferredComposerModelSelection,
  useComposerDraftStore,
} from "../composerDraftStore";
import { readNativeApi } from "../nativeApi";
import { useStore } from "../store";
import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE } from "../types";
import { ensureStudioProject } from "./studioProjects";
import type { ServerWorkspacePaths } from "./serverWorkspacePaths";
import { promoteThreadCreate } from "./threadCreatePromotion";
import { newCommandId, newThreadId } from "./utils";

type CreateCommand = Extract<ClientOrchestrationCommand, { type: "thread.create" }>;
export type ReviewSuggestionResult =
  | { status: "opened" | "retained"; threadId: ThreadId }
  | { status: "cancelled" | "failed"; threadId?: ThreadId };
export interface HistorySuggestionDraftState {
  pending: boolean;
  result: ReviewSuggestionResult | null;
}
export interface HistorySuggestionNavigation {
  pathname: () => string;
  subscribe: (listener: (destination: string) => void) => () => void;
  open: (threadId: ThreadId) => Promise<void>;
}

// Keep generated evidence editable text in the ordinary composer. Escape only JSON string
// tokens so decoded values stay exact and structural arrays/objects remain valid JSON.
function quoteHistoryEvidence(value: unknown): string {
  return JSON.stringify(value, null, 2).replace(/"(?:\\.|[^"\\])*"/g, (token) =>
    token.replace(
      /[/@$.:\u005b\u005d\uFFFC]/g,
      (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
    ),
  );
}

export function buildHistorySuggestionPrompt(
  summary: ComputerActivitySemanticSummary,
  opening: string,
): string {
  return `${opening}\n\n${quoteHistoryEvidence(summary.content.suggestion)}\n\n${quoteHistoryEvidence(
    {
      summaryId: summary.id,
      startedAt: summary.startedAt,
      endedAt: summary.endedAt,
      sourceIds: summary.sourceIds,
      citations: summary.content.citations,
      sourceFingerprint: summary.sourceFingerprint,
      provider: summary.provider,
      model: summary.model,
    },
  )}`;
}

// One controller belongs to one router, and survives settings-panel remounts. Its retained
// command is session-only: persistence stores composer text, never a mutation to replay.
export function createHistorySuggestionDraftController(navigation: HistorySuggestionNavigation) {
  let state: HistorySuggestionDraftState = { pending: false, result: null };
  const listeners = new Set<() => void>();
  let inFlight: Promise<ReviewSuggestionResult> | null = null;
  let retained: { command: CreateCommand } | null = null;
  const publish = (next: HistorySuggestionDraftState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const matches = (command: CreateCommand) =>
    useStore.getState().sidebarThreadSummaryById[command.threadId]?.projectId === command.projectId;

  const start = (
    prepare: (current: () => boolean) => Promise<{ command: CreateCommand } | null>,
  ): Promise<ReviewSuggestionResult> => {
    if (inFlight) return inFlight;
    // Set the guard before preparation, including prompt creation and every await.
    state = { pending: true, result: state.result };
    let current = true;
    let settled = false;
    let ownDestination: string | null = null;
    let ownNavigationSeen = false;
    let stopSync: (() => void) | undefined;
    let stopWaiting: (() => void) | undefined;
    const unsubscribeNavigation = navigation.subscribe((destination) => {
      if (ownDestination === destination && !ownNavigationSeen) {
        ownNavigationSeen = true;
        return;
      }
      current = false;
      stopWaiting?.();
    });
    inFlight = Promise.resolve()
      .then(async (): Promise<ReviewSuggestionResult> => {
        let operation = retained;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let unsubscribeStore: (() => void) | undefined;
        try {
          const stopped = new Promise<false>((resolve) => {
            stopWaiting = () => resolve(false);
            timer = setTimeout(() => resolve(false), 10_000);
          });
          operation ??= await Promise.race([
            prepare(() => current && !settled),
            stopped.then(() => null),
          ]);
          if (!operation) return { status: current ? "failed" : "cancelled" };
          retained = operation;
          const { command } = operation;
          if (!current) return { status: "retained", threadId: command.threadId };
          // Preparation, dispatch, synchronization and navigation share one wall-clock bound.
          // Timing out cannot cancel an already dispatched command.
          const isActive = () => current && !settled;
          const work = (async (): Promise<boolean> => {
            if (!matches(command)) {
              const result = await promoteThreadCreate(command);
              if (!isActive() || result === "unavailable") return false;
            }
            if (!matches(command)) {
              const synced = new Promise<boolean>((resolve) => {
                stopSync = () => resolve(false);
                const check = () => {
                  if (matches(command)) resolve(true);
                };
                unsubscribeStore = useStore.subscribe(check);
                check(); // Close the subscribe/read race.
              });
              const api = readNativeApi();
              if (api) {
                void api.orchestration.getShellSnapshot().then(
                  (snapshot) => {
                    if (
                      isActive() &&
                      snapshot.threads.some(
                        (row) => row.id === command.threadId && row.projectId === command.projectId,
                      )
                    ) {
                      useStore.getState().syncServerShellSnapshot(snapshot);
                    }
                  },
                  () => {},
                );
              }
              if (!(await synced)) return false;
            }
            if (!isActive() || !matches(command)) return false;
            ownDestination = `/${command.threadId}`;
            await navigation.open(command.threadId);
            return isActive() && navigation.pathname() === ownDestination;
          })();
          const opened = await Promise.race([work, stopped]);
          if (opened) {
            retained = null;
            return { status: "opened", threadId: command.threadId };
          }
          return { status: "retained", threadId: command.threadId };
        } catch {
          // A lost acknowledgement is uncertain. Keep the original ID, command and user's edits.
          return operation
            ? { status: "retained", threadId: operation.command.threadId }
            : { status: current ? "failed" : "cancelled" };
        } finally {
          settled = true;
          if (timer !== undefined) clearTimeout(timer);
          unsubscribeStore?.();
          stopSync?.();
          unsubscribeNavigation();
        }
      })
      .then((result) => {
        inFlight = null;
        publish({ pending: false, result });
        return result;
      });
    for (const listener of listeners) listener();
    return inFlight;
  };

  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    review: (input: {
      summary: ComputerActivitySemanticSummary;
      paths: ServerWorkspacePaths;
      defaultProvider: ProviderKind;
      title: string;
      opening: string;
    }) =>
      start(async (current) => {
        if (!input.summary.content.suggestion) return null;
        const projectId = await ensureStudioProject(input.paths);
        if (!current() || !projectId) return null;
        const project = useStore.getState().projects.find((row) => row.id === projectId);
        if (!project) return null;
        const threadId = newThreadId();
        const composer = useComposerDraftStore.getState();
        if (
          useStore.getState().sidebarThreadSummaryById[threadId] ||
          composer.draftsByThreadId[threadId] ||
          composer.draftThreadsByThreadId[threadId]
        ) {
          return null;
        }
        composer.applyStickyState(threadId);
        const modelSelection = resolvePreferredComposerModelSelection({
          draft: useComposerDraftStore.getState().draftsByThreadId[threadId],
          threadModelSelection: null,
          projectModelSelection: project.defaultModelSelection,
          defaultProvider: input.defaultProvider,
        });
        composer.setModelSelection(threadId, modelSelection);
        composer.setPrompt(threadId, buildHistorySuggestionPrompt(input.summary, input.opening));
        flushComposerDraftPersistence();
        return {
          command: {
            type: "thread.create",
            commandId: newCommandId(),
            threadId,
            projectId,
            title: input.title,
            modelSelection,
            runtimeMode: DEFAULT_RUNTIME_MODE,
            interactionMode: DEFAULT_INTERACTION_MODE,
            envMode: "local",
            branch: null,
            worktreePath: null,
            lastKnownPr: null,
            createdAt: new Date().toISOString(),
          },
        };
      }),
    recover: () => start(async () => null),
  };
}
