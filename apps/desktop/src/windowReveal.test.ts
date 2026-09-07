import { describe, expect, it, vi } from "vitest";
import { createWindowRevealGate } from "./windowReveal";

describe("window reveal", () => {
  it("does not expose the blank first Electron paint", () => {
    const reveal = vi.fn();
    const gate = createWindowRevealGate(reveal);
    gate.firstPaint();
    expect(reveal).not.toHaveBeenCalled();
    gate.shellReady();
    expect(reveal).toHaveBeenCalledTimes(1);
    gate.shellReady();
    expect(reveal).toHaveBeenCalledTimes(1);
  });

  it("handles a renderer signal arriving before Electron's paint event", () => {
    const reveal = vi.fn();
    const gate = createWindowRevealGate(reveal);
    gate.shellReady();
    expect(reveal).not.toHaveBeenCalled();
    gate.firstPaint();
    expect(reveal).toHaveBeenCalledTimes(1);
  });

  it("ignores late readiness after the window closes", () => {
    const reveal = vi.fn();
    const gate = createWindowRevealGate(reveal);
    gate.firstPaint();
    gate.cancel();
    gate.shellReady();
    expect(reveal).not.toHaveBeenCalled();
  });
});
