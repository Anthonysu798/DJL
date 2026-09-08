import { describe, expect, it } from "vitest";
import { MODEL_OPTIONS_BY_PROVIDER } from "./model";

describe("current native model fallback catalog", () => {
  it("includes Astra and Fable 5.1 without removing older selections", () => {
    expect(MODEL_OPTIONS_BY_PROVIDER.codex.map((model) => model.slug)).toContain("gpt-6-astra");
    expect(MODEL_OPTIONS_BY_PROVIDER.claudeAgent.map((model) => model.slug)).toContain(
      "claude-fable-5-1",
    );
    expect(MODEL_OPTIONS_BY_PROVIDER.claudeAgent.map((model) => model.slug)).toContain(
      "claude-fable-5",
    );
  });
});
