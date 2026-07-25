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

describe("providerOrdering", () => {
  it("exposes only OpenCode in the runtime provider order", () => {
    expect(DEFAULT_PROVIDER_ORDER).toEqual(["opencode"]);
  });

  it("drops historical providers from picker order and visibility settings", () => {
    expect(isProviderKind("pi")).toBe(false);
    expect(normalizeProviderOrder(["pi", "codex"])).toEqual(["opencode"]);
    expect(normalizeHiddenProviders(["bogus", "pi", "pi"])).toEqual([]);
  });
});
