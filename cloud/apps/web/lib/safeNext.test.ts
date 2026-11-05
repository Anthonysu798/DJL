import { describe, expect, it } from "vitest";

import { safeNext } from "./safeNext";

describe("safeNext", () => {
  it("keeps same-origin relative paths with their query and hash", () => {
    expect(safeNext("/chat")).toBe("/chat");
    expect(safeNext("/authorize?client_id=djl-desktop&state=abc#x")).toBe(
      "/authorize?client_id=djl-desktop&state=abc#x",
    );
  });

  it("falls back for anything that could leave the site", () => {
    for (const value of [
      null,
      "",
      "chat",
      "//evil.example",
      "///evil.example",
      "/\\evil.example",
      "\\\\evil.example",
      "/chat\\..\\//evil.example",
      "https://evil.example/",
      "HTTPS://evil.example",
      "javascript:alert(1)",
      " javascript:alert(1)",
      "/\t/evil.example",
      "@evil.example",
      "data:text/html,hi",
    ])
      expect(safeNext(value), String(value)).toBe("/chat");
  });

  it.each(["/..//outside.invalid", "/%2e%2e//outside.invalid"])(
    "rejects a local-looking path that normalizes to a network-path reference: %s",
    (value) => {
      expect(safeNext(value)).toBe("/chat");
      expect(safeNext(value, "")).toBe("");
    },
  );
  it("uses the given fallback", () => {
    expect(safeNext("//evil.example", "/chat")).toBe("/chat");
  });
});
