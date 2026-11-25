import { describe, expect, it } from "vitest";

import { classifyProviderFailure } from "./providerFailurePresentation";

describe("classifyProviderFailure", () => {
  it.each([
    ["401 unauthorized: invalid API key", "authentication"],
    ["spawn codex ENOENT", "commandMissing"],
    [
      "Working folder is unavailable: /tmp/deleted. Choose an existing project folder before retrying.",
      "workspaceMissing",
    ],
    ["EACCES: permission denied", "permission"],
    ["429 too many requests", "rateLimit"],
    ["You've hit your usage limit. Try again at 3:40 PM.", "rateLimit"],
    ["socket connection timed out", "connection"],
    ["All fibers interrupted without error", "connection"],
    ["Transport disposed", "connection"],
    ["provider exited with code 1", "generic"],
  ] as const)("classifies %s", (detail, expected) => {
    expect(classifyProviderFailure(detail)).toBe(expected);
  });
});
