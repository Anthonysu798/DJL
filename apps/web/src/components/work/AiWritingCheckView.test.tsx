import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("AiWritingCheckView lifecycle", () => {
  it("cancels request-scoped local analysis when the view unmounts", () => {
    const source = readFileSync(new URL("./AiWritingCheckView.tsx", import.meta.url), "utf8");

    expect(source).toContain("return () => controllerRef.current?.abort();");
  });

  it("does not expose untranslated server exception text in the localized UI", () => {
    const source = readFileSync(new URL("./AiWritingCheckView.tsx", import.meta.url), "utf8");

    expect(source).not.toContain(
      "setError(cause instanceof Error ? cause.message : String(cause))",
    );
    expect(source).not.toContain("{model.error}");
  });
});
