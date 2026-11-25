import type { HarnessAccount } from "@djl/contracts";
import { describe, expect, it } from "vitest";

import {
  canCreate,
  defaultGroupName,
  fillTemplate,
  memberChoices,
  templateDefaultRecipient,
} from "./GroupSetupDialog.logic";

const account = (id: HarnessAccount["id"], status: HarnessAccount["status"]): HarnessAccount => ({
  id,
  installed: status !== "missing",
  enabled: true,
  status,
});

describe("group setup", () => {
  it("lists every member kind and marks readiness", () => {
    const choices = memberChoices([account("codex", "ready"), account("qwen", "missing")]);
    expect(choices).toHaveLength(10);
    expect(choices.find((choice) => choice.provider === "codex")?.ready).toBe(true);
    expect(choices.find((choice) => choice.provider === "qwen")?.ready).toBe(false);
    expect(choices.find((choice) => choice.provider === "gemini")?.ready).toBe(false);
  });

  it("lists ready agents first", () => {
    const choices = memberChoices([account("pi", "ready")]);
    expect(choices[0]?.provider).toBe("pi");
  });

  it("needs at least one ready member", () => {
    expect(canCreate([], [])).toBe(false);
    expect(canCreate(["codex"], [account("codex", "ready")])).toBe(true);
    expect(canCreate(["codex"], [account("codex", "required")])).toBe(false);
  });

  it("lets any agent be picked when the account check failed", () => {
    const choices = memberChoices([], { checkFailed: true });
    expect(choices.every((choice) => choice.ready === null)).toBe(true);
    expect(canCreate(["gemini"], [], { checkFailed: true })).toBe(true);
    expect(canCreate([], [], { checkFailed: true })).toBe(false);
  });

  it("suggests a name from the picked agents", () => {
    expect(defaultGroupName(["claudeAgent", "codex"])).toBe("Claude, Codex");
    expect(defaultGroupName(["claudeAgent", "codex", "gemini", "qwen"])).toBe(
      "Claude, Codex, Gemini +1",
    );
  });
});

describe("group templates", () => {
  it("gives each job a different ready agent, best suited first", () => {
    expect(fillTemplate("buildReview", ["claudeAgent", "codex", "gemini"])).toEqual([
      { provider: "codex", role: "builder" },
      { provider: "claudeAgent", role: "reviewer", reviewer: true },
    ]);
    expect(fillTemplate("planBuildReview", ["claudeAgent", "codex", "gemini"])).toEqual([
      { provider: "claudeAgent", role: "planner", lead: true },
      { provider: "codex", role: "builder" },
      { provider: "gemini", role: "reviewer", reviewer: true },
    ]);
  });

  it("reuses an agent when too few are ready, except for second opinions", () => {
    expect(fillTemplate("buildReview", ["claudeAgent"])).toEqual([
      { provider: "claudeAgent", role: "builder" },
      { provider: "claudeAgent", role: "reviewer", reviewer: true },
    ]);
    expect(fillTemplate("secondOpinions", ["kimi", "qwen"])).toEqual([
      { provider: "kimi" },
      { provider: "qwen" },
    ]);
    expect(fillTemplate("researchWrite", [])).toEqual([]);
  });

  it("sends second opinions to everyone by default", () => {
    expect(templateDefaultRecipient("secondOpinions")).toBe("all");
    expect(templateDefaultRecipient("buildReview")).toBeUndefined();
  });
});
