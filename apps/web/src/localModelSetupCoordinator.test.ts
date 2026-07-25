import type { ComposerThreadDraftState, QueuedComposerTurn } from "./composerDraftStore";
import { describe, expect, it } from "vitest";

import { isLocalModelAutoSelectEligible } from "./localModelSetupCoordinator";

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
});
