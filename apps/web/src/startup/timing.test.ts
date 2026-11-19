import { afterEach, expect, it, vi } from "vitest";
import { remainingSplashDuration } from "./timing";

afterEach(() => vi.restoreAllMocks());
it("counts the intro from mount and adds no extra wait after slow loading", () => {
  const now = vi.spyOn(performance, "now");
  now.mockReturnValue(1_000);
  expect(remainingSplashDuration(1_000)).toBe(7_000);
  now.mockReturnValue(4_000);
  expect(remainingSplashDuration(1_000)).toBe(4_000);
  now.mockReturnValue(11_000);
  expect(remainingSplashDuration(1_000)).toBe(0);
});
