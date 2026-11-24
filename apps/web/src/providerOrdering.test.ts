// FILE: providerOrdering.test.ts
// Purpose: Keeps provider ordering normalization covered for every exposed provider.
// Layer: Web settings tests
// Depends on: provider display metadata from contracts and providerOrdering helpers.

import { describe, expect, it } from "vitest";

import {
  DEFAULT_PROVIDER_ORDER,
  isProviderKind,
  normalizeHiddenProviders,
  normalizeProviderOrder,
} from "./providerOrdering";
import { PROVIDER_OPTIONS } from "./session-logic";

describe("providerOrdering", () => {
  it("exposes the active OpenCode runtime and newly built native harnesses", () => {
    expect(DEFAULT_PROVIDER_ORDER).toEqual([
      "djlCloud",
      "opencode",
      "codex",
      "claudeAgent",
      "gemini",
      "cursor",
      "grok",
      "kimi",
      "iflow",
      "qwen",
      "copilot",
      "codebuddy",
      "pi",
    ]);
  });

  it("drops historical providers from picker order and visibility settings", () => {
    expect(isProviderKind("gemini")).toBe(true);
    expect(DEFAULT_PROVIDER_ORDER.indexOf("gemini")).toBe(
      DEFAULT_PROVIDER_ORDER.indexOf("claudeAgent") + 1,
    );
    expect(isProviderKind("droid")).toBe(false);
    expect(isProviderKind("group")).toBe(false);
    expect(PROVIDER_OPTIONS.some((option) => option.value === "group")).toBe(false);
    expect(normalizeProviderOrder(["droid", "codex"])).toEqual([
      "codex",
      "djlCloud",
      "opencode",
      "claudeAgent",
      "gemini",
      "cursor",
      "grok",
      "kimi",
      "iflow",
      "qwen",
      "copilot",
      "codebuddy",
      "pi",
    ]);
    expect(normalizeHiddenProviders(["bogus", "droid", "droid"])).toEqual([]);
  });
});
