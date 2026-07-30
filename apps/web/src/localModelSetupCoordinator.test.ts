import type { LocalModelSetupJob } from "@synara/contracts";
import { ThreadId } from "@synara/contracts";
import type { ComposerThreadDraftState, QueuedComposerTurn } from "./composerDraftStore";
import { describe, expect, it, vi } from "vitest";

import {
  coordinateReadyLocalModelSetupJobs,
  createLocalModelSetupCoordinatorState,
  isLocalModelAutoSelectEligible,
  localModelCatalogFingerprint,
} from "./localModelSetupCoordinator";

const readyJob: LocalModelSetupJob = {
  id: "setup-1",
  runtime: "ollama",
  recommendationId: "gpt-oss-20b",
  modelId: "gpt-oss:20b",
  state: "ready",
  downloadedBytes: 13 * 1024 ** 3,
  totalBytes: 13 * 1024 ** 3,
  message: "Ready",
  startedAt: "2026-07-28T00:00:00.000Z",
  finishedAt: "2026-07-28T00:10:00.000Z",
};

function emptyDraft(): ComposerThreadDraftState {
  return {
    prompt: "",
    promptHistorySavedDraft: null,
    images: [],
    files: [],
    nonPersistedImageIds: [],
    persistedAttachments: [],
    browserFindings: [],
    assistantSelections: [],
    terminalContexts: [],
    fileComments: [],
    pastedTexts: [],
    skills: [],
    mentions: [],
    queuedTurns: [],
    modelSelectionByProvider: {},
    activeProvider: null,
    runtimeMode: null,
    interactionMode: null,
  };
}

describe("local model setup coordinator", () => {
  it("auto-selects only when the focused conversation and composer are empty", () => {
    expect(
      isLocalModelAutoSelectEligible({
        thread: { messages: [], latestTurn: null, session: null },
        draft: emptyDraft(),
      }),
    ).toBe(true);
    expect(
      isLocalModelAutoSelectEligible({
        thread: { messages: [{}], latestTurn: null, session: null },
        draft: emptyDraft(),
      }),
    ).toBe(false);
    expect(
      isLocalModelAutoSelectEligible({
        thread: null,
        draft: { ...emptyDraft(), prompt: "keep DeepSeek selected" },
      }),
    ).toBe(false);
    expect(
      isLocalModelAutoSelectEligible({
        thread: null,
        draft: { ...emptyDraft(), queuedTurns: [{} as unknown as QueuedComposerTurn] },
      }),
    ).toBe(false);
  });

  it("changes its catalog fingerprint when a runtime stops", () => {
    const snapshot = {
      runtimes: [
        { runtime: "ollama", state: "running" },
        { runtime: "lmstudio", state: "running" },
      ],
      installedModels: [
        { runtime: "ollama", modelId: "qwen2.5:3b" },
        { runtime: "lmstudio", modelId: "ibm/granite-4.1-3b" },
      ],
    };

    expect(localModelCatalogFingerprint(snapshot)).not.toBe(
      localModelCatalogFingerprint({
        ...snapshot,
        runtimes: [snapshot.runtimes[0]!, { ...snapshot.runtimes[1]!, state: "stopped" }],
      }),
    );
  });

  it("finishes a matching continuation on the first snapshot without requiring an empty draft", async () => {
    const state = createLocalModelSetupCoordinatorState();
    const refreshProviderDiscovery = vi.fn(async () => undefined);
    const setModelSelectionAndSticky = vi.fn();
    const markContinuationReady = vi.fn(() => true);

    const tasks = coordinateReadyLocalModelSetupJobs({
      jobs: [readyJob],
      state,
      continuation: {
        threadId: "thread-target",
        jobId: readyJob.id,
        expectedModelSlug: "ollama/qwen3-coder:30b",
        draftFingerprint: "draft-a",
        state: "waiting",
        createdAt: 1,
      },
      focusedThreadId: ThreadId.makeUnsafe("thread-other"),
      activeThread: { messages: [{}], latestTurn: {}, session: { activeTurnId: "turn-1" } },
      draft: { ...emptyDraft(), prompt: "Preserve and send this task" },
      refreshProviderDiscovery,
      setModelSelectionAndSticky,
      markContinuationReady,
    });
    await Promise.all(tasks);

    expect(refreshProviderDiscovery).toHaveBeenCalledOnce();
    expect(setModelSelectionAndSticky).toHaveBeenCalledWith(ThreadId.makeUnsafe("thread-target"), {
      provider: "opencode",
      model: "ollama/gpt-oss:20b",
    });
    expect(markContinuationReady).toHaveBeenCalledWith(readyJob.id, "ollama/gpt-oss:20b");
    expect(state.initialized).toBe(true);
    expect(state.seenReadyJobs.has(readyJob.id)).toBe(true);
  });

  it("keeps unrelated first-snapshot jobs seen without selecting a model", async () => {
    const state = createLocalModelSetupCoordinatorState();
    const refreshProviderDiscovery = vi.fn(async () => undefined);
    const setModelSelectionAndSticky = vi.fn();
    const markContinuationReady = vi.fn(() => true);

    const tasks = coordinateReadyLocalModelSetupJobs({
      jobs: [readyJob],
      state,
      continuation: {
        threadId: "thread-target",
        jobId: "setup-other",
        expectedModelSlug: "ollama/granite4.1:3b",
        draftFingerprint: "draft-a",
        state: "waiting",
        createdAt: 1,
      },
      focusedThreadId: ThreadId.makeUnsafe("thread-target"),
      activeThread: { messages: [], latestTurn: null, session: null },
      draft: emptyDraft(),
      refreshProviderDiscovery,
      setModelSelectionAndSticky,
      markContinuationReady,
    });
    await Promise.all(tasks);

    expect(tasks).toHaveLength(0);
    expect(refreshProviderDiscovery).not.toHaveBeenCalled();
    expect(setModelSelectionAndSticky).not.toHaveBeenCalled();
    expect(markContinuationReady).not.toHaveBeenCalled();
    expect(state.seenReadyJobs.has(readyJob.id)).toBe(true);
  });

  it("preserves the original empty-draft guard for unrelated later jobs", async () => {
    const state = createLocalModelSetupCoordinatorState();
    state.initialized = true;
    const refreshProviderDiscovery = vi.fn(async () => undefined);
    const setModelSelectionAndSticky = vi.fn();

    const tasks = coordinateReadyLocalModelSetupJobs({
      jobs: [readyJob],
      state,
      continuation: null,
      focusedThreadId: ThreadId.makeUnsafe("thread-focused"),
      activeThread: { messages: [], latestTurn: null, session: null },
      draft: { ...emptyDraft(), prompt: "Do not replace my selected model" },
      refreshProviderDiscovery,
      setModelSelectionAndSticky,
      markContinuationReady: vi.fn(() => true),
    });
    await Promise.all(tasks);

    expect(refreshProviderDiscovery).toHaveBeenCalledOnce();
    expect(setModelSelectionAndSticky).not.toHaveBeenCalled();
  });

  it("ignores matching failed and cancelled jobs", async () => {
    const state = createLocalModelSetupCoordinatorState();
    const refreshProviderDiscovery = vi.fn(async () => undefined);
    const setModelSelectionAndSticky = vi.fn();
    const markContinuationReady = vi.fn(() => true);
    const continuation = {
      threadId: "thread-target",
      jobId: readyJob.id,
      expectedModelSlug: "ollama/gpt-oss:20b",
      draftFingerprint: "draft-a",
      state: "waiting" as const,
      createdAt: 1,
    };

    const tasks = coordinateReadyLocalModelSetupJobs({
      jobs: [
        { ...readyJob, state: "failed", message: "Failed" },
        { ...readyJob, id: "setup-2", state: "cancelled", message: "Cancelled" },
      ],
      state,
      continuation,
      focusedThreadId: ThreadId.makeUnsafe("thread-target"),
      activeThread: { messages: [], latestTurn: null, session: null },
      draft: { ...emptyDraft(), prompt: "Keep this task" },
      refreshProviderDiscovery,
      setModelSelectionAndSticky,
      markContinuationReady,
    });
    await Promise.all(tasks);

    expect(tasks).toHaveLength(0);
    expect(refreshProviderDiscovery).not.toHaveBeenCalled();
    expect(setModelSelectionAndSticky).not.toHaveBeenCalled();
    expect(markContinuationReady).not.toHaveBeenCalled();
  });
});
