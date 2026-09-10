import { describe, expect, it } from "vitest";
import { MessageId, ThreadId } from "@synara/contracts";
import { buildHandoffBootstrapText } from "./handoff";

const message = (text: string, index: number) => ({
  id: MessageId.makeUnsafe(`message-${index}`),
  role: "user" as const,
  text,
  source: "handoff-import" as const,
  streaming: false,
  createdAt: "2026-09-08T00:00:00.000Z",
  updatedAt: "2026-09-08T00:00:00.000Z",
  turnId: null,
});
const thread = (texts: string[]) => ({
  title: "Agent mode",
  branch: "main",
  worktreePath: null,
  handoff: {
    sourceThreadId: ThreadId.makeUnsafe("source"),
    sourceProvider: "codex" as const,
    importedAt: "2026-09-08T00:00:00.000Z",
    bootstrapStatus: "pending" as const,
  },
  messages: texts.map(message),
});

describe("Agent mode context", () => {
  it("keeps complete messages when the transcript fits the budget", () => {
    const original = "Requirement detail. ".repeat(200) + "CRITICAL FINAL CONSTRAINT";
    expect(buildHandoffBootstrapText(thread([original]), 10_000)).toContain(original);
  });

  it("keeps the latest instruction when earlier history exceeds the budget", () => {
    const history = Array.from({ length: 100 }, () => "Old context. ".repeat(100));
    const result = buildHandoffBootstrapText(thread([...history, "LATEST: fix the login"]), 2_000);
    expect(result!.length).toBeLessThanOrEqual(2_000);
    expect(result).toContain("LATEST: fix the login");
    expect(result).toContain("excerpt");
  });

  it("respects tiny and zero budgets", () => {
    for (const budget of [0, 1, 2, 10]) {
      expect(
        (buildHandoffBootstrapText(thread(["hello"]), budget) ?? "").length,
      ).toBeLessThanOrEqual(budget);
    }
  });
});
