import { describe, expect, it } from "vitest";

import { classifyProviderFailure } from "./providerFailurePresentation";

describe("classifyProviderFailure", () => {
  it.each([
    ["401 unauthorized: invalid API key", "authentication"],
    ["spawn codex ENOENT", "commandMissing"],
    ["EACCES: permission denied", "permission"],
    ["429 too many requests", "rateLimit"],
    ["socket connection timed out", "connection"],
    ["provider exited with code 1", "generic"],
  ] as const)("classifies %s", (detail, expected) => {
    expect(classifyProviderFailure(detail)).toBe(expected);
  });
});
