import { describe, expect, it } from "vitest";

import {
  assertHc3SplitRole,
  buildHuggingFaceDatasetMetadataUrl,
  buildPinnedHuggingFaceDatasetFileUrl,
  decodePinnedHc3JsonlRows,
  expectedHc3SplitRole,
  selectBalancedHc3Fixtures,
} from "./hc3Sample";

const long = (prefix: string) => `${prefix} ${"substantive benchmark prose ".repeat(8)}`;

describe("HC3 benchmark sample selection", () => {
  it("preserves the owner/repository separator in Hugging Face API URLs", () => {
    expect(buildHuggingFaceDatasetMetadataUrl("Hello-SimpleAI/HC3")).toBe(
      "https://huggingface.co/api/datasets/Hello-SimpleAI/HC3",
    );
    expect(
      buildPinnedHuggingFaceDatasetFileUrl("Hello-SimpleAI/HC3", "a".repeat(40), "wiki_csai"),
    ).toBe(
      `https://huggingface.co/datasets/Hello-SimpleAI/HC3/resolve/${"a".repeat(40)}/wiki_csai.jsonl`,
    );
  });

  it("decodes a bounded window from revision-pinned HC3 JSONL", () => {
    const raw = [
      { human_answers: ["human zero"], chatgpt_answers: ["ai zero"] },
      { human_answers: ["human one"], chatgpt_answers: ["ai one"] },
    ]
      .map((row) => JSON.stringify(row))
      .join("\n");

    expect(decodePinnedHc3JsonlRows(raw, 1, 1)).toEqual([
      {
        rowIndex: 1,
        humanAnswers: ["human one"],
        aiAnswers: ["ai one"],
      },
    ]);
  });

  it("fails when the pinned HC3 source cannot fill the requested window", () => {
    const raw = JSON.stringify({
      human_answers: ["human zero"],
      chatgpt_answers: ["ai zero"],
    });

    expect(() => decodePinnedHc3JsonlRows(raw, 0, 2)).toThrow(/ended before the required 2 rows/);
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
      "development",
    );

    expect(fixtures.map((fixture) => [fixture.id, fixture.label])).toEqual([
      ["hc3-en-licensed-3-human", "human"],
      ["hc3-en-licensed-3-ai", "ai"],
      ["hc3-en-licensed-4-human", "human"],
      ["hc3-en-licensed-4-ai", "ai"],
    ]);
    expect(fixtures.every((fixture) => fixture.provenance.includes("a".repeat(40)))).toBe(true);
    expect(fixtures.every((fixture) => fixture.splitRole === "development")).toBe(true);
    expect(fixtures[0]?.sourceGroupId).toBe(fixtures[1]?.sourceGroupId);
    expect(fixtures[0]?.promptFamily).toBe(fixtures[1]?.promptFamily);
  });

  it("fails instead of silently producing an undersized benchmark", () => {
    expect(() => selectBalancedHc3Fixtures([], 1, "development")).toThrow(/paired rows, found 0/);
  });

  it("round-robins eligible pairs across source configurations", () => {
    const source = (config: string, rowOffset: number) => ({
      dataset: "Example/HC3",
      revision: "a".repeat(40),
      config,
      language: "zh-Hans" as const,
      license: "MIT",
      rows: [0, 1].map((index) => ({
        rowIndex: rowOffset + index,
        humanAnswers: [long(`human ${config} ${index}`)],
        aiAnswers: [long(`ai ${config} ${index}`)],
      })),
    });

    const fixtures = selectBalancedHc3Fixtures(
      [source("open_qa", 0), source("psychology", 100)],
      4,
      "validation",
    );
    const configs = fixtures
      .filter((fixture) => fixture.label === "human")
      .map((fixture) => fixture.sourceGroupId.split(":")[1]);
    expect(configs).toEqual(["open_qa", "psychology", "open_qa", "psychology"]);
  });

  it("reserves non-overlapping 100-row windows for one declared role", () => {
    expect(expectedHc3SplitRole(0)).toBe("development");
    expect(expectedHc3SplitRole(100)).toBe("validation");
    expect(expectedHc3SplitRole(400)).toBe("validation");
    expect(expectedHc3SplitRole(600)).toBe("validation");
    expect(expectedHc3SplitRole(700)).toBe("locked");
    expect(() => expectedHc3SplitRole(650)).toThrow(/multiple of 100/);
    expect(() => assertHc3SplitRole(100, "locked")).toThrow(/reserved.*validation/);
  });
});
