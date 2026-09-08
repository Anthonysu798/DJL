import { describe, expect, it } from "vitest";
import { getComposerTraitSelection } from "./composerTraits";

describe("runtime composer thinking controls", () => {
  it("shows discovered Sol efforts and fast mode in either composer layout", () => {
    const selection = getComposerTraitSelection(
      "codex",
      "gpt-5.6-sol",
      "",
      { reasoningEffort: "ultra" },
      {
        slug: "gpt-5.6-sol",
        name: "GPT-5.6 Sol",
        supportedReasoningEfforts: [{ value: "high" }, { value: "ultra" }],
        defaultReasoningEffort: "high",
        supportsFastMode: true,
      },
    );
    expect(selection.effortLevels.map((level) => level.value)).toEqual(["high", "ultra"]);
    expect(selection.effort).toBe("ultra");
    expect(selection.caps.supportsFastMode).toBe(true);
  });
  it("does not erase known controls when discovery only supplies a name", () => {
    const selection = getComposerTraitSelection("codex", "gpt-6-astra", "", undefined, {
      slug: "gpt-6-astra",
      name: "GPT-6 Astra",
    });
    expect(selection.caps.supportsFastMode).toBe(true);
  });
  it("keeps Claude Ultracode alongside advertised API efforts", () => {
    const selection = getComposerTraitSelection(
      "claudeAgent",
      "claude-fable-5-1",
      "",
      { effort: "ultracode" },
      {
        slug: "claude-fable-5-1",
        name: "Fable",
        supportedReasoningEfforts: [{ value: "high" }, { value: "xhigh" }],
      },
    );
    expect(selection.effortLevels.map((level) => level.value)).toEqual([
      "high",
      "xhigh",
      "ultracode",
    ]);
    expect(selection.effort).toBe("ultracode");
  });
  it("honors an explicit unsupported effort list", () => {
    const selection = getComposerTraitSelection("codex", "gpt-6-astra", "", undefined, {
      slug: "gpt-6-astra",
      name: "GPT-6 Astra",
      supportedReasoningEfforts: [],
    });
    expect(selection.effortLevels).toEqual([]);
  });
});
