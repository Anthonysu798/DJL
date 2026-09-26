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
      expect(safeNext(value), String(value)).toBe("/account");
  });

  it("uses the given fallback", () => {
    expect(safeNext("//evil.example", "/chat")).toBe("/chat");
  });
});
