import { describe, expect, test } from "bun:test";

import { prepareLocalSystem } from "../../src/session/llm/local-model-prompt";

describe("local model system prompt", () => {
  test("keeps project instructions but removes the large skill catalogue", () => {
    const result = prepareLocalSystem({
      agentPrompt: undefined,
      system: [
        "<env>Windows workspace</env>",
        "Follow AGENTS.md project rules.",
        "Skills provide specialized instructions.\n<available_skills>very large</available_skills>",
      ],
      userSystem: "Use Chinese.",
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toContain("DJL");
    expect(result[0]).toContain("After a tool result");
    expect(result[0]).toContain("Follow AGENTS.md project rules.");
    expect(result[0]).toContain("Use Chinese.");
    expect(result[0]).not.toContain("available_skills");
  });

  test("preserves a custom agent prompt", () => {
    const result = prepareLocalSystem({
      agentPrompt: "Custom agent behavior.",
      system: [],
      userSystem: undefined,
    });
    expect(result[0]).toContain("Custom agent behavior.");
  });
});
