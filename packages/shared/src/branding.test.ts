// FILE: branding.test.ts
// Purpose: Locks the user-facing DJL name independently from compatibility identifiers.
// Layer: Shared runtime utility tests

import { describe, expect, it } from "vitest";

import { APP_BASE_NAME, resolveAppDisplayName } from "./branding";

describe("application branding", () => {
  it("uses DJL as the production display name", () => {
    expect(APP_BASE_NAME).toBe("DJL");
    expect(resolveAppDisplayName(false)).toBe("DJL");
  });

  it("marks development builds without changing the base brand", () => {
    expect(resolveAppDisplayName(true)).toBe("DJL (Dev)");
  });
});
