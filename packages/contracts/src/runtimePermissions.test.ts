import { describe, expect, it } from "vitest";
import { effectiveRuntimeMode, permissionModesForProvider } from "./runtimePermissions";

describe("provider permission modes", () => {
  it("keeps legacy Claude full-access at Ask and distinguishes explicit bypass", () => {
    expect(effectiveRuntimeMode("claudeAgent", "full-access")).toBe("approval-required");
    expect(effectiveRuntimeMode("claudeAgent", "bypass-permissions")).toBe("bypass-permissions");
    expect(effectiveRuntimeMode("codex", "bypass-permissions")).toBe("approval-required");
    expect(
      effectiveRuntimeMode("claudeAgent", effectiveRuntimeMode("codex", "bypass-permissions")),
    ).toBe("approval-required");
    expect(permissionModesForProvider("claudeAgent")).toEqual([
      "approval-required",
      "accept-edits",
      "auto-approval",
      "bypass-permissions",
    ]);
  });
});
