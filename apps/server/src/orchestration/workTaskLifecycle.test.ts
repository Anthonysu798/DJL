import { describe, expect, it } from "vitest";

import { createWorkTask, transitionWorkTask } from "./workTaskLifecycle.ts";

const at = (minute: number) => `2026-07-13T10:${String(minute).padStart(2, "0")}:00.000Z`;

describe("Work task lifecycle", () => {
  it("moves through planning, working, review, and explicit completion", () => {
    const planning = createWorkTask("thread-1", at(0), "create-1");
    expect(planning).toMatchObject({
      status: "planning",
      phase: "planning",
      condition: "active",
      progress: 0,
    });

    const working = transitionWorkTask(planning, {
      action: "start_work",
      commandId: "provider:item-1",
      occurredAt: at(1),
      reason: "Reading the source documents",
    });
    expect(working).toMatchObject({ status: "working", phase: "working", progress: 10 });

    const review = transitionWorkTask(working, {
      action: "submit_review",
      commandId: "provider:turn-1",
      occurredAt: at(2),
      reason: "Draft is ready to review",
    });
    expect(review).toMatchObject({ status: "needs_review", phase: "review", progress: 90 });

    const complete = transitionWorkTask(review, {
      action: "complete",
      commandId: "client:complete-1",
      occurredAt: at(3),
    });
    expect(complete).toMatchObject({
      status: "complete",
      phase: "complete",
      condition: "active",
      progress: 100,
      completedAt: at(3),
    });
  });

  it("preserves and restores the resumable phase around input", () => {
    const working = transitionWorkTask(createWorkTask("thread-1", at(0), "create-1"), {
      action: "start_work",
      commandId: "provider:item-1",
      occurredAt: at(1),
    });
    const blocked = transitionWorkTask(working, {
      action: "request_input",
      commandId: "provider:approval-1",
      occurredAt: at(2),
      reason: "Approval required",
    });
    expect(blocked).toMatchObject({
      status: "needs_input",
      phase: "working",
      resumePhase: "working",
      condition: "needs_input",
    });

    const resumed = transitionWorkTask(blocked, {
      action: "resolve_input",
      commandId: "client:approval-1",
      occurredAt: at(3),
    });
    expect(resumed).toMatchObject({ status: "working", phase: "working", condition: "active" });
  });

  it("is idempotent for a replayed deterministic command id", () => {
    const planning = createWorkTask("thread-1", at(0), "create-1");
    const once = transitionWorkTask(planning, {
      action: "start_work",
      commandId: "provider:item-1",
      occurredAt: at(1),
    });
    const replayed = transitionWorkTask(once, {
      action: "start_work",
      commandId: "provider:item-1",
      occurredAt: at(9),
    });
    expect(replayed).toBe(once);
  });

  it("rejects user completion before a task reaches review", () => {
    const planning = createWorkTask("thread-1", at(0), "create-1");
    expect(() =>
      transitionWorkTask(planning, {
        action: "complete",
        commandId: "client:complete-1",
        occurredAt: at(1),
      }),
    ).toThrow("must be ready for review");
  });

  it("returns requested changes and reopened tasks to planning", () => {
    const review = transitionWorkTask(
      transitionWorkTask(createWorkTask("thread-1", at(0), "create-1"), {
        action: "start_work",
        commandId: "provider:item-1",
        occurredAt: at(1),
      }),
      {
        action: "submit_review",
        commandId: "provider:turn-1",
        occurredAt: at(2),
      },
    );
    const changes = transitionWorkTask(review, {
      action: "request_changes",
      commandId: "client:changes-1",
      occurredAt: at(3),
    });
    expect(changes).toMatchObject({ status: "planning", progress: 0, completedAt: null });

    const completed = transitionWorkTask(review, {
      action: "complete",
      commandId: "client:complete-1",
      occurredAt: at(3),
    });
    const reopened = transitionWorkTask(completed, {
      action: "reopen",
      commandId: "client:reopen-1",
      occurredAt: at(4),
    });
    expect(reopened).toMatchObject({ status: "planning", phase: "planning", completedAt: null });
  });
});
