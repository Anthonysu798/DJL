import { describe, expect, it } from "vitest";

import { buildHuggingFaceDatasetMetadataUrl, selectBalancedHc3Fixtures } from "./hc3Sample";

const long = (prefix: string) => `${prefix} ${"substantive benchmark prose ".repeat(8)}`;

describe("HC3 benchmark sample selection", () => {
  it("preserves the owner/repository separator in Hugging Face API URLs", () => {
    expect(buildHuggingFaceDatasetMetadataUrl("Hello-SimpleAI/HC3")).toBe(
      "https://huggingface.co/api/datasets/Hello-SimpleAI/HC3",
    );
  });

  it("selects deterministic paired human and AI records and rejects short answers", () => {
    const fixtures = selectBalancedHc3Fixtures(
      [
        {
          dataset: "Example/HC3",
          revision: "a".repeat(40),
          config: "licensed",
          language: "en",
          license: "CC-BY-SA-4.0",
          rows: [
            {
              rowIndex: 3,
              humanAnswers: ["too short", long("human three")],
              aiAnswers: [long("ai three")],
            },
            {
              rowIndex: 4,
              humanAnswers: [long("human four")],
              aiAnswers: [long("ai four")],
            },
            {
              rowIndex: 5,
              humanAnswers: [long("human five")],
              aiAnswers: [long("ai five")],
            },
          ],
        },
      ],
      2,
    );

    expect(fixtures.map((fixture) => [fixture.id, fixture.label])).toEqual([
      ["hc3-en-licensed-3-human", "human"],
      ["hc3-en-licensed-3-ai", "ai"],
      ["hc3-en-licensed-4-human", "human"],
      ["hc3-en-licensed-4-ai", "ai"],
    ]);
    expect(fixtures.every((fixture) => fixture.provenance.includes("a".repeat(40)))).toBe(true);
  });

  it("fails instead of silently producing an undersized benchmark", () => {
    expect(() => selectBalancedHc3Fixtures([], 1)).toThrow(/paired rows, found 0/);
  });
});
