import { describe, expect, it, vi } from "vitest";

import { ServerListeningDetector } from "./serverListeningDetector";

describe("ServerListeningDetector", () => {
  it("resolves when the backend logs its listening line", async () => {
    const detector = new ServerListeningDetector();

    detector.push("Listening on http://127.0.0.1:3773\n");

    await expect(detector.promise).resolves.toBeUndefined();
  });

  it("resolves when the listening line arrives across multiple chunks", async () => {
    const detector = new ServerListeningDetector();

    detector.push("Listening on ");
    detector.push("http://127.0.0.1:3773\n");

    await expect(detector.promise).resolves.toBeUndefined();
  });

  it("does not raise an unhandled rejection when nobody awaits a failed detector", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      new ServerListeningDetector().fail(new Error("backend exited"));
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("rejects when the detector is failed before readiness", async () => {
    const detector = new ServerListeningDetector();

    detector.fail(new Error("backend exited"));

    await expect(detector.promise).rejects.toThrow("backend exited");
  });
});
