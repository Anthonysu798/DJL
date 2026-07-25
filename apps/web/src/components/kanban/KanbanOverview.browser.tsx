// FILE: KanbanOverview.browser.tsx
// Purpose: Browser coverage for command-center priority lanes, navigation, and failure details.

import "../../index.css";

import { ProjectId, ThreadId } from "@synara/contracts";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "vitest-browser-react";

import englishCatalog from "~/i18n/locales/en.json";
import type { SidebarThreadSummary } from "~/types";
import { KanbanOverview } from "./KanbanOverview";
import type { KanbanBoard, KanbanCard } from "./kanban.logic";

function makeFailedCard(): KanbanCard {
  const threadId = ThreadId.makeUnsafe("thread-failed");
  const projectId = ProjectId.makeUnsafe("project-alpha");
  const timestamp = "2026-07-20T12:00:00.000Z";
  const thread = {
    id: threadId,
    projectId,
    title: "Fix provider startup",
    modelSelection: { provider: "codex", model: "gpt-5.6" },
    interactionMode: "default",
    branch: "codex/command-center",
    worktreePath: null,
    session: {
      provider: "codex",
      status: "error",
      orchestrationStatus: "error",
      createdAt: timestamp,
      updatedAt: timestamp,
      lastError: "spawn codex ENOENT at /tmp/provider-runtime",
    },
    createdAt: timestamp,
    updatedAt: timestamp,
    latestTurn: {
      turnId: "turn-failed",
      state: "error",
      requestedAt: timestamp,
      startedAt: timestamp,
      completedAt: timestamp,
      assistantMessageId: null,
    },
    latestUserMessageAt: timestamp,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    hasLiveTailWork: false,
  } as SidebarThreadSummary;
  return {
    cardId: `thread:${threadId}`,
    threadId,
    projectId,
    column: "done",
    title: thread.title,
    provider: "codex",
    isTerminal: false,
    branch: thread.branch,
    envMode: null,
    worktreePath: null,
    thread,
    draftPrompt: "",
    draftHasAttachments: false,
    sortTimestamp: Date.parse(timestamp),
    timestamp,
    activeWorkStartedAt: null,
    isOptimisticDispatch: false,
  };
}

describe("Kanban command center", () => {
  afterEach(async () => {
    await cleanup();
  });

  it("shows all priority lanes and reveals provider diagnostics on demand", async () => {
    const failedCard = makeFailedCard();
    const board: KanbanBoard = {
      totalCount: 1,
      projects: [
        {
          projectId: failedCard.projectId,
          projectName: "Alpha",
          projectKind: "project",
          draft: [],
          inProgress: [],
          done: [failedCard],
          totalCount: 1,
        },
      ],
    };
    const i18n = createInstance();
    await i18n.use(initReactI18next).init({
      defaultNS: "common",
      fallbackLng: "en",
      lng: "en",
      resources: { en: englishCatalog },
    });
    const onOpenCard = vi.fn();
    const onOpenProject = vi.fn();

    await render(
      <I18nextProvider i18n={i18n}>
        <KanbanOverview
          board={board}
          onOpenCard={onOpenCard}
          onOpenProject={onOpenProject}
          onNewTask={() => undefined}
        />
      </I18nextProvider>,
    );

    for (const name of ["Waiting for you", "Failed", "Running", "Review ready", "Done"]) {
      await expect.element(page.getByRole("heading", { name })).toBeVisible();
    }
    // Command-center cards keep only their navigation affordance; the thread's
    // provider logo is intentionally absent from Kanban.
    expect(
      document.querySelectorAll('button[aria-label="Open task Fix provider startup"] svg'),
    ).toHaveLength(1);
    const detailToggle = page.getByRole("button", { name: "Show technical details" });
    await expect.element(detailToggle).toHaveAttribute("aria-expanded", "false");
    expect(
      document.querySelector("pre")?.closest('[aria-hidden="true"]')?.getAttribute("aria-hidden"),
    ).toBe("true");
    await detailToggle.click();
    await expect
      .element(page.getByText("spawn codex ENOENT at /tmp/provider-runtime"))
      .toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Hide technical details" }))
      .toHaveAttribute("aria-expanded", "true");

    await page.getByRole("button", { name: "Open task Fix provider startup" }).click();
    expect(onOpenCard).toHaveBeenCalledWith(failedCard);
    await page.getByRole("button", { name: "Alpha" }).click();
    expect(onOpenProject).toHaveBeenCalledWith(failedCard.projectId);
  });
});
