import { describe, expect, it } from "vitest";

import { workDraftRuntimeMode } from "./workDraftRuntimeMode";

const modes = (available: boolean) => [
  { mode: "approval-required" as const, available: true },
  { mode: "auto-approval" as const, available },
];

describe("workDraftRuntimeMode", () => {
  it.each(["claudeAgent", "codex"] as const)(
    "starts a new Work chat on %s in its automatic mode when the agent offers it",
    (provider) => {
      expect(
        workDraftRuntimeMode({ provider, permissionModes: modes(true), supportsAutoMode: true }),
      ).toBe("auto-approval");
    },
  );

  it("asks instead whenever the automatic mode is not known to be available", () => {
    const ask = "approval-required";
    // Capabilities not loaded yet, mode unavailable for the account, or model without Auto.
    expect(
      workDraftRuntimeMode({
        provider: "claudeAgent",
        permissionModes: undefined,
        supportsAutoMode: true,
      }),
    ).toBe(ask);
    expect(
      workDraftRuntimeMode({
        provider: "claudeAgent",
        permissionModes: modes(false),
        supportsAutoMode: true,
      }),
    ).toBe(ask);
    expect(
      workDraftRuntimeMode({
        provider: "claudeAgent",
        permissionModes: modes(true),
        supportsAutoMode: false,
      }),
    ).toBe(ask);
    // An agent with no sandboxed or reviewed automatic mode never defaults to full access.
    expect(
      workDraftRuntimeMode({
        provider: "gemini",
        permissionModes: modes(true),
        supportsAutoMode: undefined,
      }),
    ).toBe(ask);
    expect(
      workDraftRuntimeMode({
        provider: "opencode",
        permissionModes: modes(true),
        supportsAutoMode: undefined,
      }),
    ).toBe(ask);
  });
});
