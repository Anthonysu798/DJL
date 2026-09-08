import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SERVER_SETTINGS, type HarnessTool } from "@synara/contracts";
import { createAutomaticHarnessUpdater } from "./automaticUpdates";

const tool = (
  id: HarnessTool["id"],
  status: HarnessTool["status"] = "behind_latest",
): HarnessTool => ({
  id,
  installed: true,
  currentVersion: "1.0.0",
  latestVersion: "2.0.0",
  status,
  canInstall: false,
  canUpdate: true,
});
function fixture() {
  let now = 0;
  const settings = vi.fn(async () => ({
    ...DEFAULT_SERVER_SETTINGS,
    enableAutomaticProviderUpdates: true,
  }));
  const isIdle = vi.fn(async () => true);
  const list = vi.fn(async () => ({
    tools: [tool("codex"), tool("claudeAgent"), tool("opencode", "unknown")],
  }));
  const maintain = vi.fn(async () => tool("codex", "current"));
  const report = vi.fn();
  const updater = createAutomaticHarnessUpdater({
    settings,
    isIdle,
    list,
    maintain,
    report,
    now: () => now,
  });
  return {
    settings,
    isIdle,
    list,
    maintain,
    report,
    updater,
    advance: () => {
      now += 6 * 60 * 60 * 1000;
    },
  };
}

describe("automatic provider updates", () => {
  it("requires persisted opt-in and enabled version checks", async () => {
    const f = fixture();
    f.settings.mockResolvedValueOnce({
      ...DEFAULT_SERVER_SETTINGS,
      enableAutomaticProviderUpdates: false,
    });
    await f.updater.tick();
    f.settings.mockResolvedValueOnce({
      ...DEFAULT_SERVER_SETTINGS,
      enableAutomaticProviderUpdates: true,
      enableProviderUpdateChecks: false,
    });
    await f.updater.tick();
    expect(f.list).not.toHaveBeenCalled();
    expect(f.maintain).not.toHaveBeenCalled();
  });
  it("waits for idle, skips unknown versions and backs off between checks", async () => {
    const f = fixture();
    f.isIdle.mockResolvedValueOnce(false);
    await f.updater.tick();
    expect(f.list).not.toHaveBeenCalled();
    await f.updater.tick();
    expect(f.maintain.mock.calls).toEqual([[{ harness: "codex" }], [{ harness: "claudeAgent" }]]);
    await f.updater.tick();
    expect(f.list).toHaveBeenCalledTimes(1);
    f.advance();
    await f.updater.tick();
    expect(f.list).toHaveBeenCalledTimes(2);
  });
  it("rechecks work activity before each update and resumes when idle", async () => {
    const f = fixture();
    f.isIdle.mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await f.updater.tick();
    expect(f.maintain).toHaveBeenCalledTimes(1);
    f.list.mockResolvedValue({ tools: [tool("codex", "current"), tool("claudeAgent")] });
    await f.updater.tick();
    expect(f.maintain).toHaveBeenCalledTimes(2);
  });
  it("continues after a provider failure without running overlapping ticks", async () => {
    const f = fixture();
    let finish!: () => void;
    f.maintain.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      throw new Error("failed");
    });
    const pending = f.updater.tick();
    await vi.waitFor(() => expect(f.maintain).toHaveBeenCalledTimes(1));
    await f.updater.tick();
    expect(f.list).toHaveBeenCalledTimes(1);
    finish();
    await pending;
    expect(f.maintain).toHaveBeenCalledTimes(2);
    expect(f.report).toHaveBeenCalledWith("codex", false);
    expect(f.report).toHaveBeenCalledWith("claudeAgent", true);
  });
});
