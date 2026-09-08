import { EventId, TurnId, isToolLifecycleItemType } from "@synara/contracts";
import { expect, it } from "vitest";
import { deriveWorkLogEntries } from "../session-logic";

it("shows a native review decision and rationale without counting it as an executed tool", () => {
  const turnId = TurnId.makeUnsafe("review-turn");
  const entries = deriveWorkLogEntries(
    [
      {
        id: EventId.makeUnsafe("review-decision"),
        createdAt: "2026-09-07T00:00:00.000Z",
        turnId,
        kind: "approval.review.completed",
        tone: "approval",
        summary: "Codex automatic review: denied",
        payload: {
          itemType: "approval_review",
          status: "declined",
          detail: "Outside approved scope",
        },
      },
    ],
    turnId,
  );
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({
    label: "Codex automatic review: denied",
    detail: "Outside approved scope",
  });
  expect(isToolLifecycleItemType("approval_review")).toBe(false);
});
