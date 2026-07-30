import { describe, expect, it, vi } from "vitest";

import {
  assertBenchmarkRunSplitRole,
  parseBenchmarkInput,
  readBenchmarkInput,
} from "./benchmarkInput";

describe("AI detector benchmark input", () => {
  it("reads a streamed corpus from stdin when the input path is '-'", async () => {
    const readStdin = vi.fn(async () => '{"id":"streamed"}\n');

    await expect(readBenchmarkInput("-", readStdin)).resolves.toBe('{"id":"streamed"}\n');
    expect(readStdin).toHaveBeenCalledOnce();
  });

  it("does not read stdin for a file input", async () => {
    const readStdin = vi.fn(async () => "not used");

    await expect(
      readBenchmarkInput(
        new URL("./fixtures/smoke.jsonl", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"),
        readStdin,
      ),
    ).resolves.toContain('"id"');
    expect(readStdin).not.toHaveBeenCalled();
  });

  it("accepts benchmark split and audit metadata", () => {
    const fixture = {
      id: "document-1",
      language: "en",
      label: "ai",
      text: "Eligible prose.",
      provenance: "licensed-corpus row=1",
      license: "MIT",
      splitRole: "locked",
      sourceGroupId: "source-1",
      authorId: "author-1",
      promptFamily: "matched-topic-1",
      nativeLanguageCohort: "l2-english",
      scenario: "humanized",
      domain: "academic",
      generator: "example-generator",
      attackEditing: "paraphrase",
    };

    expect(parseBenchmarkInput(`${JSON.stringify(fixture)}\n`)).toEqual([fixture]);
  });

  it("canonicalizes optional audit identifiers before leakage checks", () => {
    const fixture = {
      id: "document-1",
      language: "en",
      label: "ai",
      text: "Eligible prose.",
      provenance: "licensed-corpus row=1",
      license: "MIT",
      splitRole: "development",
      sourceGroupId: "  ｓｏｕｒｃｅ－１  ",
      authorId: " author-1 ",
      promptFamily: " matched-topic-1 ",
      domain: " academic ",
    };

    expect(parseBenchmarkInput(`${JSON.stringify(fixture)}\n`)).toMatchObject([
      {
        sourceGroupId: "source-1",
        authorId: "author-1",
        promptFamily: "matched-topic-1",
        domain: "academic",
      },
    ]);
  });

  it("rejects ambiguous split roles and empty optional metadata", () => {
    const required = {
      id: "document-1",
      language: "en",
      label: "human",
      text: "Eligible prose.",
      provenance: "licensed-corpus row=1",
      license: "MIT",
    };

    expect(() =>
      parseBenchmarkInput(`${JSON.stringify({ ...required, splitRole: "test" })}\n`),
    ).toThrow(/unsupported splitRole 'test'/);
    expect(() =>
      parseBenchmarkInput(`${JSON.stringify({ ...required, sourceGroupId: " " })}\n`),
    ).toThrow(/invalid optional metadata 'sourceGroupId'/);
  });

  it("reports the input line for malformed JSON", () => {
    expect(() => parseBenchmarkInput("\nnot-json\n")).toThrow(/line 2/);
    expect(() => parseBenchmarkInput("\n")).toThrow(/input is empty/);
  });

  it("rejects duplicate fixture ids and group leakage across split roles", () => {
    const base = {
      language: "en",
      label: "human",
      text: "Eligible prose.",
      provenance: "licensed-corpus",
      license: "MIT",
    };
    expect(() =>
      parseBenchmarkInput(
        [JSON.stringify({ ...base, id: "same" }), JSON.stringify({ ...base, id: "same" })].join(
          "\n",
        ),
      ),
    ).toThrow(/duplicate fixture ids/);

    expect(() =>
      parseBenchmarkInput(
        [
          JSON.stringify({
            ...base,
            id: "development-record",
            splitRole: "development",
            sourceGroupId: "Shared   Source",
          }),
          JSON.stringify({
            ...base,
            id: "locked-record",
            splitRole: "locked",
            sourceGroupId: " shared source ",
          }),
        ].join("\n"),
      ),
    ).toThrow(/sourceGroupId 'shared source'.*multiple split roles/);
  });

  it("rejects canonically identical text across split roles", () => {
    const base = {
      language: "en",
      label: "human",
      provenance: "licensed-corpus",
      license: "MIT",
    };

    expect(() =>
      parseBenchmarkInput(
        [
          JSON.stringify({
            ...base,
            id: "development-record",
            text: "The same\u00a0prose.",
            splitRole: "development",
            sourceGroupId: "development-source",
          }),
          JSON.stringify({
            ...base,
            id: "locked-record",
            text: "the  same prose.",
            splitRole: "locked",
            sourceGroupId: "locked-source",
          }),
        ].join("\n"),
      ),
    ).toThrow(/canonical text.*multiple split roles/);
  });

  it("requires an explicit exact role assertion for locked or formal split runs", () => {
    const locked = parseBenchmarkInput(
      `${JSON.stringify({
        id: "locked-record",
        language: "en",
        label: "human",
        text: "Long enough prose for a benchmark role check.",
        provenance: "licensed-corpus",
        license: "MIT",
        splitRole: "locked",
      })}\n`,
    );

    expect(() => assertBenchmarkRunSplitRole(locked, null)).toThrow(/explicit --split-role locked/);
    expect(() => assertBenchmarkRunSplitRole(locked, "validation")).toThrow(
      /must explicitly declare splitRole 'validation'/,
    );
    expect(() => assertBenchmarkRunSplitRole(locked, "locked")).not.toThrow();
  });
});
