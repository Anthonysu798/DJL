import { EventId, ThreadId, type ProviderRuntimeEvent } from "@synara/contracts";
import { describe, expect, it } from "vitest";

import { deriveWorkTaskTransition, workTaskProviderCommandId } from "./workTaskReactor.ts";

const base = {
  eventId: EventId.makeUnsafe("provider-event-7"),
  provider: "opencode" as const,
  threadId: ThreadId.makeUnsafe("thread-1"),
  createdAt: "2026-07-13T10:00:00.000Z",
};

describe("WorkTaskReactor provider mapping", () => {
  it("keeps planning until the first meaningful tool starts", () => {
    expect(
      deriveWorkTaskTransition({
        ...base,
        type: "turn.started",
        payload: {},
      } as ProviderRuntimeEvent),
    ).toBeNull();
    expect(
      deriveWorkTaskTransition({
        ...base,
        type: "item.started",
        itemId: "tool-1",
        payload: { itemType: "file_change", title: "Write report" },
      } as ProviderRuntimeEvent),
    ).toMatchObject({ action: "start_work", reason: "Write report" });
  });

  it("maps input, success, failure, and cancellation deterministically", () => {
    const cases: ReadonlyArray<[ProviderRuntimeEvent, string]> = [
      [
        {
          ...base,
          type: "user-input.requested",
          requestId: "request-1",
          payload: {
            questions: [
              {
                id: "choice",
                header: "Choice",
                question: "Continue?",
                options: [{ label: "Yes", description: "Continue the task" }],
              },
            ],
          },
        } as unknown as ProviderRuntimeEvent,
        "request_input",
      ],
      [
        {
          ...base,
          type: "user-input.resolved",
          requestId: "request-1",
          payload: { answers: {} },
        } as ProviderRuntimeEvent,
        "resolve_input",
      ],
      [
        {
          ...base,
          type: "turn.completed",
          payload: { state: "completed" },
        } as ProviderRuntimeEvent,
        "submit_review",
      ],
      [
        {
          ...base,
          type: "turn.completed",
          payload: { state: "failed", errorMessage: "Model failed" },
        } as ProviderRuntimeEvent,
        "fail",
      ],
      [
        { ...base, type: "turn.aborted", payload: { reason: "Stopped" } } as ProviderRuntimeEvent,
        "cancel",
      ],
    ];
    for (const [event, action] of cases) {
      expect(deriveWorkTaskTransition(event)?.action).toBe(action);
    }
  });

  it("derives replay-safe command ids without randomness", () => {
    const event = {
      ...base,
      type: "turn.completed",
      payload: { state: "completed" },
    } as ProviderRuntimeEvent;
    expect(workTaskProviderCommandId(event, "submit_review")).toBe(
      "work:provider-event-7:submit_review",
    );
    expect(workTaskProviderCommandId(event, "submit_review")).toBe(
      workTaskProviderCommandId(event, "submit_review"),
    );
  });
});
