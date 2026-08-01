import type { OrchestrationProjectShell, OrchestrationThread } from "@synara/contracts";
import { describe, expect, it } from "vitest";

import { recordInputFromCompletedWorkThread } from "./MemoryReactor.ts";

const project = {
  id: "project-a",
  kind: "studio",
  title: "Launch",
  workspaceRoot: "/tmp/work",
  defaultModelSelection: null,
  scripts: [],
  isPinned: false,
  createdAt: "2026-07-13T09:00:00.000Z",
  updatedAt: "2026-07-13T10:00:00.000Z",
} as unknown as OrchestrationProjectShell;

const thread = {
  id: "thread-a",
  projectId: "project-a",
  title: "Launch date",
  latestTurn: {
    turnId: "turn-a",
    state: "completed",
    requestedAt: "2026-07-13T10:00:00.000Z",
    startedAt: "2026-07-13T10:00:01.000Z",
    completedAt: "2026-07-13T10:01:00.000Z",
    assistantMessageId: "assistant-a",
  },
  workTask: {
    threadId: "thread-a",
    phase: "review",
    condition: "active",
    status: "needs_review",
    resumePhase: "review",
    progress: 90,
    statusReason: "Ready",
    lastTransitionCommandId: "work:event:submit_review",
    createdAt: "2026-07-13T10:00:00.000Z",
    updatedAt: "2026-07-13T10:01:00.000Z",
    completedAt: null,
  },
  messages: [
    {
      id: "user-a",
      role: "user",
      text: "Choose the date",
      turnId: "turn-a",
      streaming: false,
      source: "native",
      createdAt: "2026-07-13T10:00:00.000Z",
      updatedAt: "2026-07-13T10:00:00.000Z",
    },
    {
      id: "assistant-a",
      role: "assistant",
      text: "Decision: September 9",
      turnId: "turn-a",
      streaming: false,
      source: "native",
      createdAt: "2026-07-13T10:00:30.000Z",
      updatedAt: "2026-07-13T10:01:00.000Z",
    },
  ],
} as unknown as OrchestrationThread;

describe("recordInputFromCompletedWorkThread", () => {
  it("does not automatically promote completed Work answers into project memory", () => {
    expect(recordInputFromCompletedWorkThread(project, thread)).toBeNull();
  });

  it("does not save streaming, failed, or non-Work output", () => {
    expect(recordInputFromCompletedWorkThread(project, { ...thread, workTask: null })).toBeNull();
    expect(
      recordInputFromCompletedWorkThread(project, {
        ...thread,
        latestTurn: { ...thread.latestTurn!, state: "interrupted" },
      }),
    ).toBeNull();
    expect(
      recordInputFromCompletedWorkThread(project, {
        ...thread,
        messages: thread.messages.map((message) =>
          message.role === "assistant" ? { ...message, streaming: true } : message,
        ),
      }),
    ).toBeNull();
  });

  it("does not automatically save folder-backed Work answers", () => {
    expect(
      recordInputFromCompletedWorkThread(project, {
        ...thread,
        worktreePath: "/Clients/Acme",
      }),
    ).toBeNull();
  });
});
