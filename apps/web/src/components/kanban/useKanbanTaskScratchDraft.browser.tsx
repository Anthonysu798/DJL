// FILE: useKanbanTaskScratchDraft.browser.tsx
// Purpose: Verifies Kanban task drafts use app defaults rather than chat sticky state.

import { DEFAULT_MODEL_BY_PROVIDER, type ModelSlug } from "@synara/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";

import { useComposerDraftStore } from "../../composerDraftStore";
import { useKanbanTaskScratchDraft } from "./useKanbanTaskScratchDraft";

function KanbanDefaultSelectionHarness(props: { defaultModel?: ModelSlug | null }) {
  const { selectedModel, selectedProvider } = useKanbanTaskScratchDraft({
    defaultProvider: "codex",
    ...(props.defaultModel !== undefined ? { defaultModel: props.defaultModel } : {}),
  });
  return (
    <output data-testid="kanban-default-selection">
      {selectedProvider}:{selectedModel}
    </output>
  );
}

describe("useKanbanTaskScratchDraft", () => {
  afterEach(async () => {
    await cleanup();
    useComposerDraftStore.setState({
      draftsByThreadId: {},
      draftThreadsByThreadId: {},
      projectDraftThreadIdByProjectId: {},
      stickyModelSelectionByProvider: {},
      stickyActiveProvider: null,
    });
  });

  it("uses the app default instead of a remembered chat selection", async () => {
    useComposerDraftStore.setState({
      stickyActiveProvider: "opencode",
      stickyModelSelectionByProvider: {
        opencode: { provider: "opencode", model: "openai/gpt-5.4" },
      },
    });

    await render(<KanbanDefaultSelectionHarness />);

    await expect
      .element(page.getByTestId("kanban-default-selection"))
      .toHaveTextContent(`codex:${DEFAULT_MODEL_BY_PROVIDER.codex}`);
  });

  it("uses the configured provider default when one is supplied", async () => {
    await render(<KanbanDefaultSelectionHarness defaultModel="configured/default-model" />);

    await expect
      .element(page.getByTestId("kanban-default-selection"))
      .toHaveTextContent("codex:configured/default-model");
  });
});
