// FILE: WorkTaskPanel.browser.tsx
// Purpose: Ensures Work deliverables use the shared in-app file opener.

import "../../index.css";

import type { OrchestrationThreadActivity, WorkTask } from "@synara/contracts";
import { EventId } from "@synara/contracts";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "vitest-browser-react";

import { WorkspaceFileOpenerContext } from "~/lib/workspaceFileOpener";
import { WorkTaskPanel } from "./WorkTaskPanel";

const mocks = vi.hoisted(() => ({
  resolveArtifactPath: vi.fn(),
}));

vi.mock("~/nativeApi", () => ({
  ensureNativeApi: () => ({
    work: { resolveArtifactPath: mocks.resolveArtifactPath },
  }),
  readNativeApi: () => ({
    work: { resolveArtifactPath: mocks.resolveArtifactPath },
  }),
}));

const task = {
  threadId: "thread-1",
  phase: "review",
  condition: "active",
  status: "needs_review",
  resumePhase: "review",
  progress: 90,
  statusReason: "Work is ready for review",
  lastTransitionCommandId: "provider:turn-1",
  createdAt: "2026-07-13T10:00:00.000Z",
  updatedAt: "2026-07-13T10:02:00.000Z",
  completedAt: null,
} as WorkTask;

const activities = [
  {
    id: EventId.makeUnsafe("activity-output"),
    tone: "tool",
    kind: "studio.outputs.captured",
    summary: "Captured output",
    payload: { data: { files: [{ path: "Deliverables/essay-v1.docx" }] } },
    turnId: null,
    createdAt: "2026-07-13T10:02:00.000Z",
  },
] satisfies ReadonlyArray<OrchestrationThreadActivity>;

describe("WorkTaskPanel deliverables", () => {
  afterEach(async () => {
    await cleanup();
    mocks.resolveArtifactPath.mockReset();
  });

  it("opens a deliverable in the right-side workspace pane", async () => {
    const openFile = vi.fn(() => true);
    await render(
      <WorkspaceFileOpenerContext.Provider value={{ openFile }}>
        <WorkTaskPanel
          task={task}
          activities={activities}
          timestampFormat="locale"
          busy={false}
          onComplete={() => undefined}
          onRequestChanges={() => undefined}
          onRetry={() => undefined}
          onReopen={() => undefined}
          onCancel={() => undefined}
          onProvideInput={() => undefined}
        />
      </WorkspaceFileOpenerContext.Provider>,
    );

    await page.getByRole("button", { name: "Deliverables/essay-v1.docx" }).click();

    expect(openFile).toHaveBeenCalledWith("Deliverables/essay-v1.docx");
    expect(mocks.resolveArtifactPath).not.toHaveBeenCalled();
  });
});
