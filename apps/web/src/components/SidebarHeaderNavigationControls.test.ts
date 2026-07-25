// FILE: SidebarHeaderNavigationControls.test.ts
// Purpose: Prevents the removed soccer playground shortcut from returning to sidebar chrome.
// Layer: Web component source audit

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

describe("sidebar header navigation controls", () => {
  it("does not include the World Cup soccer shortcut", () => {
    const source = readFileSync(
      fileURLToPath(new URL("./SidebarHeaderNavigationControls.tsx", import.meta.url)),
      "utf8",
    );

    expect(source).not.toContain("WorldCupButton");
    expect(source).not.toContain("World Cup 2026");
    expect(source).not.toContain("FaFutbol");
  });
});
