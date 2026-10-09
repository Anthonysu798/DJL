import "../../../index.css";
import "./remoteSettings.css";
import { afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { RemoteHero } from "./RemoteHero";
import RemoteMotionPlayer from "./RemoteMotionPlayer";

afterEach(() => vi.restoreAllMocks());

it("autoplays and loops from the device scene back to the logo", async () => {
  await page.viewport(900, 600);
  const screen = await render(
    <div className="remote-settings">
      <RemoteHero />
    </div>,
  );
  await expect.element(screen.getByRole("button", { name: "Pause animation" })).toBeVisible();
  await expect
    .poll(
      () => document.querySelector('[data-testid="remote-scene"]')?.getAttribute("data-phase"),
      { timeout: 8000 },
    )
    .toBe("devices");
  await expect
    .poll(
      () => document.querySelector('[data-testid="remote-scene"]')?.getAttribute("data-phase"),
      { timeout: 10000 },
    )
    .toBe("logo");
  await expect.element(screen.getByRole("button", { name: "Pause animation" })).toBeVisible();
});

it("pauses offscreen and keeps an explicit user pause when it becomes visible again", async () => {
  const screen = await render(<RemoteMotionPlayer visible />);
  await expect.element(screen.getByRole("button", { name: "Pause animation" })).toBeVisible();
  await screen.rerender(<RemoteMotionPlayer visible={false} />);
  await expect.element(screen.getByRole("button", { name: "Play animation" })).toBeVisible();
  await screen.rerender(<RemoteMotionPlayer visible />);
  await screen.getByRole("button", { name: "Pause animation" }).click();
  await screen.rerender(<RemoteMotionPlayer visible={false} />);
  await screen.rerender(<RemoteMotionPlayer visible />);
  await expect.element(screen.getByRole("button", { name: "Play animation" })).toBeVisible();
});

it("uses a static illustration for reduced motion and fits a narrow viewport", async () => {
  await page.viewport(390, 844);
  vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
    matches: query === "(prefers-reduced-motion: reduce)",
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: () => true,
  }));
  const screen = await render(
    <div className="remote-settings">
      <RemoteHero />
    </div>,
  );
  await expect.element(screen.getByRole("heading", { name: "Your work. Anywhere." })).toBeVisible();
  await expect.element(screen.getByRole("button")).not.toBeInTheDocument();
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
  expect(
    document.querySelectorAll('[data-testid="remote-motion-stage"] svg').length,
  ).toBeGreaterThan(0);
});
