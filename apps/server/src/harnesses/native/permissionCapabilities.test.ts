import { describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  version: "0.153.4",
  requirements: {} as Record<string, unknown>,
}));
vi.mock("../accounts", () => ({
  probe: async () => ({ code: 0, stdout: state.version, stderr: "" }),
}));
vi.mock("./claudeExecutable", () => ({ resolveClaudeExecutable: async (path: string) => path }));
vi.mock("./protocol", () => ({
  object: (value: unknown) => value,
  NativeRpc: class {
    request(method: string) {
      return Promise.resolve(
        method === "configRequirements/read" ? { requirements: state.requirements } : {},
      );
    }
    notify() {}
    close() {}
  },
}));
import { nativePermissionModes, recordPermissionRejection } from "./permissionCapabilities";

describe("native permission availability", () => {
  it("applies Codex organization policy without broadening another profile", async () => {
    state.version = "0.153.4";
    state.requirements = {
      allowedApprovalPolicies: ["on-request"],
      allowedSandboxModes: ["workspace-write"],
      allowedPermissionProfiles: { ":workspace": true },
    };
    const modes = await nativePermissionModes("codex", { codex: { binaryPath: "/policy/codex" } });
    expect(modes.find((m) => m.mode === "auto-approval")?.available).toBe(true);
    expect(modes.find((m) => m.mode === "full-access")?.available).toBe(false);
    expect(modes.find((m) => m.mode === "approval-required")?.available).toBe(false);
  });
  it("disables auto-review for older Codex binaries", async () => {
    state.version = "0.100.0";
    state.requirements = {};
    expect(
      (await nativePermissionModes("codex", { codex: { binaryPath: "/old/codex" } })).find(
        (m) => m.mode === "auto-approval",
      ),
    ).toMatchObject({ available: false, reason: expect.stringContaining("Update Codex") });
  });
  it("disables Claude Auto on an older CLI and reports runtime policy rejections", async () => {
    state.version = "2.1.82";
    expect(
      (
        await nativePermissionModes("claudeAgent", { claudeAgent: { binaryPath: "/old/claude" } })
      ).find((m) => m.mode === "auto-approval")?.available,
    ).toBe(false);
    state.version = "2.1.263";
    const options = { claudeAgent: { binaryPath: "/policy/claude" } };
    await nativePermissionModes("claudeAgent", options);
    recordPermissionRejection(
      "claudeAgent",
      "auto-approval",
      options,
      new Error("Auto mode is disabled by organization policy"),
    );
    expect(
      (await nativePermissionModes("claudeAgent", options)).find((m) => m.mode === "auto-approval"),
    ).toMatchObject({ available: false, reason: "Auto mode is disabled by organization policy" });
  });
});
