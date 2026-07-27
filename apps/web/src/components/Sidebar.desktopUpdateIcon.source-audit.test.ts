import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sidebarSource = readFileSync(new URL("./Sidebar.tsx", import.meta.url), "utf8");

describe("Sidebar desktop update icon integration", () => {
  it("renders the compact update icon instead of the former text pill", () => {
    expect(sidebarSource).toContain("<DesktopUpdateSidebarButton");
    expect(sidebarSource).not.toContain("desktopUpdateRowButtonClasses");
    expect(sidebarSource).not.toContain("desktopUpdateButtonPresentation");
  });
});
