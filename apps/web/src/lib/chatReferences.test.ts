// FILE: chatReferences.test.ts
// Purpose: Guards reference formatting and selection line-range math for chat references.
// Layer: Web UI utility tests

import { describe, expect, it } from "vitest";

import {
  buildDiffSelectionReference,
  buildWhyChangedPrompt,
  buildWhyLinesPrompt,
  computeSelectionColumns,
  computeSelectionLineRange,
  formatChatFileReference,
} from "./chatReferences";

const t = ((key: string, values?: Record<string, unknown>) => {
  const messages: Record<string, string> = {
    "references.location.line": `line ${values?.number}`,
    "references.location.lines": `lines ${values?.start}-${values?.end}`,
    "references.location.lineColumns": `line ${values?.line}:${values?.columns}`,
    "references.location.lineColumnRange": `lines ${values?.startLine}:${values?.startColumn}-${values?.endLine}:${values?.endColumn}`,
    "references.prompts.whyChanged": `Why did we implement the changes in ${values?.reference}?`,
    "references.prompts.whyFile": `Why did we implement ${values?.reference} this way? Check the git history if needed and explain the reasoning.`,
    "references.prompts.whyLines": `Why were ${values?.location} in ${values?.reference} implemented this way? Check git blame/history for the relevant commits and explain the reasoning.`,
  };
  return messages[key] ?? key;
}) as Parameters<typeof buildWhyChangedPrompt>[1];

describe("formatChatFileReference", () => {
  it("formats a bare file reference as a mention token", () => {
    expect(formatChatFileReference({ path: "apps/web/src/main.tsx" }, t)).toBe(
      "@apps/web/src/main.tsx",
    );
  });

  it("quotes paths containing whitespace", () => {
    expect(formatChatFileReference({ path: "docs/release notes.md" }, t)).toBe(
      '@"docs/release notes.md"',
    );
  });

  it("appends a single-line suffix", () => {
    expect(formatChatFileReference({ path: "src/a.ts", startLine: 12 }, t)).toBe(
      "@src/a.ts (line 12)",
    );
  });

  it("appends a line-range suffix", () => {
    expect(formatChatFileReference({ path: "src/a.ts", startLine: 3, endLine: 9 }, t)).toBe(
      "@src/a.ts (lines 3-9)",
    );
  });

  it("appends a single-line column range", () => {
    expect(
      formatChatFileReference(
        {
          path: "src/a.ts",
          startLine: 22,
          endLine: 22,
          startColumn: 5,
          endColumn: 12,
        },
        t,
      ),
    ).toBe("@src/a.ts (line 22:5-12)");
  });

  it("collapses a single-character selection to one column", () => {
    expect(
      formatChatFileReference(
        {
          path: "src/a.ts",
          startLine: 22,
          endLine: 22,
          startColumn: 5,
          endColumn: 5,
        },
        t,
      ),
    ).toBe("@src/a.ts (line 22:5)");
  });

  it("appends a multi-line column range", () => {
    expect(
      formatChatFileReference(
        {
          path: "src/a.ts",
          startLine: 21,
          endLine: 23,
          startColumn: 5,
          endColumn: 8,
        },
        t,
      ),
    ).toBe("@src/a.ts (lines 21:5-23:8)");
  });

  it("falls back to the line label when columns are missing", () => {
    expect(formatChatFileReference({ path: "src/a.ts", startLine: 5 }, t)).toBe(
      "@src/a.ts (line 5)",
    );
  });

  it("quotes a snippet as a fenced block when there is no line info", () => {
    expect(formatChatFileReference({ path: "docs/notes.md", snippet: "First point" }, t)).toBe(
      "@docs/notes.md\n```\nFirst point\n```",
    );
  });

  it("prefers the line label over a snippet", () => {
    expect(
      formatChatFileReference({ path: "src/a.ts", startLine: 3, snippet: "const a = 1;" }, t),
    ).toBe("@src/a.ts (line 3)");
  });

  it("ignores whitespace-only snippets", () => {
    expect(formatChatFileReference({ path: "docs/notes.md", snippet: "  \n " }, t)).toBe(
      "@docs/notes.md",
    );
  });
});

describe("computeSelectionColumns", () => {
  it("starts at column 1 with an empty prefix", () => {
    expect(computeSelectionColumns("", "hello")).toEqual({ startColumn: 1, endColumn: 5 });
  });

  it("offsets the start column by characters before the selection on the line", () => {
    expect(computeSelectionColumns("a\nabc", "de")).toEqual({ startColumn: 4, endColumn: 5 });
  });

  it("ends on the final line for multi-line selections", () => {
    expect(computeSelectionColumns("x\nabc", "de\nfg")).toEqual({ startColumn: 4, endColumn: 2 });
  });

  it("ignores a trailing newline when computing the end column", () => {
    expect(computeSelectionColumns("", "hello\n")).toEqual({ startColumn: 1, endColumn: 5 });
  });
});

describe("buildWhyChangedPrompt", () => {
  it("uses localized canned prompt copy while preserving the exact mention token", () => {
    const t = (key: string, values?: Record<string, unknown>) =>
      `localized:${key}:${values?.reference}`;
    expect((buildWhyChangedPrompt as Function)("src/exact file.ts", t)).toBe(
      'localized:references.prompts.whyChanged:@"src/exact file.ts"',
    );
  });

  it("mentions the file inside the question", () => {
    expect(buildWhyChangedPrompt("src/a.ts", t)).toBe(
      "Why did we implement the changes in @src/a.ts?",
    );
  });
});

describe("buildWhyLinesPrompt", () => {
  it("asks about the whole file without a line range", () => {
    expect(buildWhyLinesPrompt({ path: "src/a.ts" }, t)).toContain("@src/a.ts");
    expect(buildWhyLinesPrompt({ path: "src/a.ts" }, t)).not.toContain("lines");
  });

  it("asks about the selected line range", () => {
    const prompt = buildWhyLinesPrompt({ path: "src/a.ts", startLine: 3, endLine: 9 }, t);
    expect(prompt).toContain("lines 3-9");
    expect(prompt).toContain("@src/a.ts");
    expect(prompt).toContain("git blame");
  });
});

describe("buildDiffSelectionReference", () => {
  it("wraps the snippet in a fenced block after the mention", () => {
    expect(buildDiffSelectionReference("src/a.ts", "const a = 1;\nconst b = 2;", t)).toBe(
      "@src/a.ts\n```\nconst a = 1;\nconst b = 2;\n```",
    );
  });

  it("normalizes CRLF and trims surrounding blank lines", () => {
    expect(buildDiffSelectionReference("src/a.ts", "\r\nfoo\r\nbar\r\n", t)).toBe(
      "@src/a.ts\n```\nfoo\nbar\n```",
    );
  });

  it("truncates very long snippets", () => {
    const longSnippet = "x".repeat(10_000);
    const result = buildDiffSelectionReference("src/a.ts", longSnippet, t);
    expect(result.length).toBeLessThan(5_000);
  });

  it("extends the fence when the snippet contains backtick fences", () => {
    expect(buildDiffSelectionReference("docs/a.md", "```ts\nconst a = 1;\n```", t)).toBe(
      "@docs/a.md\n````\n```ts\nconst a = 1;\n```\n````",
    );
  });
});

describe("computeSelectionLineRange", () => {
  it("starts at line 1 with an empty prefix", () => {
    expect(computeSelectionLineRange("", "const x = 1;")).toEqual({ startLine: 1, endLine: 1 });
  });

  it("offsets the start line by prefix newlines", () => {
    expect(computeSelectionLineRange("a\nb\nc\n", "selected")).toEqual({
      startLine: 4,
      endLine: 4,
    });
  });

  it("spans multi-line selections", () => {
    expect(computeSelectionLineRange("a\n", "line one\nline two\nline three")).toEqual({
      startLine: 2,
      endLine: 4,
    });
  });

  it("ignores trailing newlines in the selection", () => {
    expect(computeSelectionLineRange("", "line one\nline two\n")).toEqual({
      startLine: 1,
      endLine: 2,
    });
  });
});
