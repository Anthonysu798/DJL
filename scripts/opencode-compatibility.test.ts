import { describe, expect, it } from "vitest";
import { evaluateOpenCodeWorkCompatibility } from "./lib/opencode-compatibility";

describe("installed OpenCode Work compatibility gate", () => {
  const compatible = {
    requestCount: 2,
    tools: ["read"],
    toolChoice: "required",
    inheritedInstructions: false,
    recoveredToolCompleted: true,
  };

  it("accepts the observed Work guarantees together", () => {
    expect(evaluateOpenCodeWorkCompatibility(compatible)).toEqual([]);
  });

  it("rejects the official 1.17.18 direct-cutover observation", () => {
    expect(
      evaluateOpenCodeWorkCompatibility({
        requestCount: 1,
        tools: ["bash", "read", "write"],
        toolChoice: "auto",
        inheritedInstructions: true,
        recoveredToolCompleted: false,
      }),
    ).toEqual([
      "tool-visibility",
      "required-local-tool-choice",
      "instruction-isolation",
      "text-tool-call-recovery",
    ]);
  });

  it("does not mistake a missing model request or tool list for compatibility", () => {
    expect(
      evaluateOpenCodeWorkCompatibility({ ...compatible, requestCount: 0, tools: [] }),
    ).toEqual(["model-request", "tool-visibility"]);
  });

  it("keeps the other gates closed when native permissions fix visibility", () => {
    expect(
      evaluateOpenCodeWorkCompatibility({
        ...compatible,
        toolChoice: "auto",
        inheritedInstructions: true,
        recoveredToolCompleted: false,
      }),
    ).toEqual(["required-local-tool-choice", "instruction-isolation", "text-tool-call-recovery"]);
  });
});

it("preserves remote automatic choice while still requiring completed tool evidence", () => {
  const observation = {
    requestCount: 2,
    tools: ["read"],
    toolChoice: "auto",
    inheritedInstructions: false,
    recoveredToolCompleted: true,
  };
  expect(evaluateOpenCodeWorkCompatibility(observation, false)).toEqual([]);
  expect(
    evaluateOpenCodeWorkCompatibility({ ...observation, toolChoice: "required" }, false),
  ).toEqual(["remote-tool-choice-forced"]);
});
