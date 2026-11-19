import { afterEach, expect, it, vi } from "vitest";
import { mountStartupBackground } from "./background";

const graphics = vi.hoisted(() => {
  const pause = vi.fn();
  const destroy = vi.fn();
  return { pause, destroy, mount: vi.fn(() => ({ pause, destroy })) };
});
vi.mock("./MicroSlatsBackground", () => ({ mountMicroSlatsBackground: graphics.mount }));
afterEach(() => vi.clearAllMocks());

it("applies the current pause state when optional graphics finish loading", async () => {
  const container = { dataset: {} } as HTMLElement;
  const background = mountStartupBackground(container, true);
  background.pause(true);
  await vi.dynamicImportSettled();
  expect(graphics.mount).toHaveBeenCalledWith(container, true);
  expect(graphics.pause).toHaveBeenLastCalledWith(true);
  background.pause(false);
  expect(graphics.pause).toHaveBeenLastCalledWith(false);
  background.destroy();
  expect(graphics.destroy).toHaveBeenCalledTimes(1);
});

it("does not mount a late graphics import after startup has already finished", async () => {
  const background = mountStartupBackground({ dataset: {} } as HTMLElement, false);
  background.destroy();
  await vi.dynamicImportSettled();
  expect(graphics.mount).not.toHaveBeenCalled();
});
