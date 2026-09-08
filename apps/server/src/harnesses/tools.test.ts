import type { HarnessTool, HarnessToolId } from "@synara/contracts";
import { describe, expect, it, vi } from "vitest";
import { createHarnessToolsController } from "./tools";

function fixture() {
  const inspect = vi.fn(
    async (id: HarnessToolId): Promise<HarnessTool> => ({
      id,
      installed: false,
      currentVersion: null,
      latestVersion: "2.0.0",
      status: "unknown",
      canInstall: true,
      canUpdate: false,
    }),
  );
  const run = vi.fn(async () => undefined);
  const controller = createHarnessToolsController({ inspect, run });
  return { inspect, run, controller };
}

describe("provider tool maintenance", () => {
  it("exposes background update failures in the tool list", async () => {
    const { controller } = fixture();
    await expect(controller.maintain({ harness: "codex" })).rejects.toThrow("not detected");
    expect(
      (await controller.list()).tools.find((item) => item.id === "codex")?.maintenanceStatus,
    ).toBe("failed");
  });
  it("refuses maintenance while a chat or terminal is active", async () => {
    const { inspect, run } = fixture();
    const controller = createHarnessToolsController({ inspect, run, isIdle: async () => false });
    await expect(controller.maintain({ harness: "codex" })).rejects.toThrow("Finish running chats");
    expect(run).not.toHaveBeenCalled();
  });
  it("does not report success when an installer exits but the CLI is still missing", async () => {
    const { controller } = fixture();
    await expect(controller.maintain({ harness: "codex" })).rejects.toThrow("not detected");
  });
  it("verifies the installed version after the command", async () => {
    const { controller, inspect } = fixture();
    inspect.mockResolvedValueOnce(await inspect("codex")).mockResolvedValue({
      id: "codex",
      installed: true,
      currentVersion: "2.0.0",
      latestVersion: "2.0.0",
      status: "current",
      canInstall: false,
      canUpdate: true,
    });
    expect((await controller.maintain({ harness: "codex" })).currentVersion).toBe("2.0.0");
  });
  it("serializes mutations and releases the lock after a failure", async () => {
    const { controller, run } = fixture();
    let fail!: (error: Error) => void;
    run.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );
    const first = controller.maintain({ harness: "codex" });
    await vi.waitFor(() => expect(run).toHaveBeenCalled());
    await expect(controller.maintain({ harness: "opencode" })).rejects.toThrow("already running");
    fail(new Error("Installer failed"));
    await expect(first).rejects.toThrow("Installer failed");
    await expect(controller.maintain({ harness: "opencode" })).rejects.toThrow("not detected");
  });
  it("refuses unsupported/custom installations instead of changing another CLI", async () => {
    const { controller, inspect, run } = fixture();
    inspect.mockResolvedValue({
      id: "codex",
      installed: true,
      currentVersion: "1.0.0",
      latestVersion: "2.0.0",
      status: "behind_latest",
      canInstall: false,
      canUpdate: false,
    });
    await expect(controller.maintain({ harness: "codex" })).rejects.toThrow("setup guide");
    expect(run).not.toHaveBeenCalled();
  });
});

describe("OpenCode installation verification", () => {
  it("does not accept version-only success without a compatible protocol", async () => {
    const { controller, inspect } = fixture();
    inspect.mockResolvedValueOnce(await inspect("opencode")).mockResolvedValue({
      id: "opencode",
      installed: true,
      currentVersion: "1.18.29",
      latestVersion: "1.18.29",
      status: "current",
      canInstall: false,
      canUpdate: true,
      compatible: false,
      compatibilityMessage: "OpenCode protocol is incompatible.",
    });
    await expect(controller.maintain({ harness: "opencode" })).rejects.toThrow("incompatible");
  });
});
