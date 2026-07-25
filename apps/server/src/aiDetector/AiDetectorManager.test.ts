import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { AiDetectorState } from "@synara/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const installer = vi.hoisted(() => {
  let abortDelayMs = 0;
  let installed = false;
  let verified = true;
  let progressBursts = 1;
  let finishRequested = false;
  let finish: (() => void) | undefined;

  return {
    reset() {
      abortDelayMs = 0;
      installed = false;
      verified = true;
      progressBursts = 1;
      finishRequested = false;
      finish = undefined;
    },
    delayAbort(ms: number) {
      abortDelayMs = ms;
    },
    finish() {
      installed = true;
      finishRequested = true;
      finish?.();
    },
    setInstalled() {
      installed = true;
    },
    corrupt() {
      installed = true;
      verified = false;
    },
    burstProgress(count: number) {
      progressBursts = count;
    },
    inspect: async () => installed,
    verify: async () => installed && verified,
    install: async (input: {
      readonly signal: AbortSignal;
      readonly onProgress: (progress: {
        readonly state: "downloading" | "verifying";
        readonly downloadedBytes: number;
        readonly totalBytes: number;
      }) => void;
    }) => {
      for (let index = 1; index <= progressBursts; index += 1) {
        input.onProgress({
          state: "downloading",
          downloadedBytes: index,
          totalBytes: progressBursts + 1,
        });
      }
      await new Promise<void>((resolve, reject) => {
        finish = resolve;
        if (finishRequested) resolve();
        input.signal.addEventListener(
          "abort",
          () => {
            setTimeout(() => reject(new DOMException("Aborted", "AbortError")), abortDelayMs);
          },
          { once: true },
        );
        if (input.signal.aborted) {
          setTimeout(() => reject(new DOMException("Aborted", "AbortError")), abortDelayMs);
        }
      });
    },
    remove: async () => {
      installed = false;
    },
  };
});

vi.mock("./modelInstaller", async (importOriginal) => {
  const original = await importOriginal<typeof import("./modelInstaller")>();
  return {
    ...original,
    inspectInstalledModel: installer.inspect,
    verifyInstalledModel: installer.verify,
    installDetectorModel: installer.install,
    removeDetectorModel: installer.remove,
  };
});

import { AiDetectorManager } from "./AiDetectorManager";
import { DetectorModelRuntime } from "./modelRuntime";

describe("AiDetectorManager model installation", () => {
  beforeEach(() => installer.reset());

  it("returns the downloading state before the model download completes", async () => {
    const stateDir = await mkdtemp(path.join(os.tmpdir(), "djl-ai-manager-"));
    const updates: AiDetectorState[] = [];
    const manager = new AiDetectorManager(stateDir, (state) => {
      updates.push(state);
    });

    const install = manager.installModel("en");
    const outcome = await Promise.race([
      install.then((state) => ({ kind: "resolved" as const, state })),
      new Promise<{ kind: "timed-out" }>((resolve) =>
        setTimeout(() => resolve({ kind: "timed-out" }), 100),
      ),
    ]);

    if (outcome.kind === "timed-out") {
      installer.finish();
      await install;
    }

    expect(outcome.kind).toBe("resolved");
    if (outcome.kind === "resolved") {
      expect(outcome.state.models.find((model) => model.language === "en")?.state).toBe(
        "downloading",
      );
    }

    installer.finish();
    await vi.waitFor(() => {
      expect(updates.at(-1)?.models.find((model) => model.language === "en")?.state).toBe("ready");
    });
  });

  it("waits for installer cleanup before reporting a cancelled installation", async () => {
    installer.delayAbort(50);
    const stateDir = await mkdtemp(path.join(os.tmpdir(), "djl-ai-manager-"));
    const manager = new AiDetectorManager(stateDir);

    await manager.installModel("en");
    const cancelled = await manager.cancelInstall("en");

    expect(cancelled.models.find((model) => model.language === "en")?.state).toBe("not-installed");
  });

  it("keeps the previous verified model ready when an update download is cancelled", async () => {
    installer.setInstalled();
    const stateDir = await mkdtemp(path.join(os.tmpdir(), "djl-ai-manager-"));
    const manager = new AiDetectorManager(stateDir);

    await manager.installModel("en");
    const cancelled = await manager.cancelInstall("en");

    expect(cancelled.models.find((model) => model.language === "en")?.state).toBe("ready");
  });

  it("does not report a same-size corrupted model as ready after startup", async () => {
    installer.corrupt();
    const stateDir = await mkdtemp(path.join(os.tmpdir(), "djl-ai-manager-"));
    const manager = new AiDetectorManager(stateDir);

    const state = await manager.getState();

    expect(state.models.find((model) => model.language === "en")?.state).toBe("error");
    expect(state.models.find((model) => model.language === "en")?.error).toMatch(/corrupt/i);
  });

  it("coalesces high-frequency download progress into bounded state updates", async () => {
    installer.burstProgress(250);
    const stateDir = await mkdtemp(path.join(os.tmpdir(), "djl-ai-manager-"));
    const updates: AiDetectorState[] = [];
    const manager = new AiDetectorManager(stateDir, (state) => {
      updates.push(state);
    });

    await manager.installModel("en");
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(updates.length).toBeLessThanOrEqual(3);
    installer.finish();
  });

  it("disposes a previously loaded runtime after replacing model files", async () => {
    const dispose = vi.spyOn(DetectorModelRuntime.prototype, "dispose");
    const stateDir = await mkdtemp(path.join(os.tmpdir(), "djl-ai-manager-"));
    const manager = new AiDetectorManager(stateDir);

    await manager.installModel("en");
    installer.finish();
    await vi.waitFor(() => expect(dispose).toHaveBeenCalledOnce());
  });
});
