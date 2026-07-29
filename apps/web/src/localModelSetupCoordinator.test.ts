import type { ComposerThreadDraftState, QueuedComposerTurn } from "./composerDraftStore";
import { describe, expect, it } from "vitest";

import {
  isLocalModelAutoSelectEligible,
  localModelCatalogFingerprint,
} from "./localModelSetupCoordinator";

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
});
