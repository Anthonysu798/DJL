import "../../index.css";
import { expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { PLATFORM_LOGO_SITES, PlatformMark } from "./PlatformMark";

const mark = () => page.getByTestId("mark").element().querySelector(".mp-mark")!;

it("shows the platform's own logo, fetched from its main website", async () => {
  await render(
    <div data-testid="mark">
      <PlatformMark platformKey="youtube" name="YouTube" />
    </div>,
  );
  const logo = mark().querySelector("img")!;
  expect(logo).not.toBeNull();
  // The creator studio's address gives Google's logo, so the main site is used instead.
  expect(new URL(logo.src).searchParams.get("domain")).toBe("www.youtube.com");
  expect(logo.alt).toBe("");
  expect(mark().getAttribute("aria-hidden")).toBe("true");
});

it("knows a logo for every platform people can add, except the few that publish none", () => {
  const without = ["segmentfault", "kaidiwang", "dingduanhao", "webhook"];
  for (const key of without) expect(PLATFORM_LOGO_SITES[key]).toBeUndefined();
  expect(Object.keys(PLATFORM_LOGO_SITES)).toHaveLength(74);
  for (const site of Object.values(PLATFORM_LOGO_SITES))
    expect(site).toMatch(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/);
});

it("keeps the drawn symbol for webhooks and letters for platforms with no logo", async () => {
  await render(
    <div data-testid="mark">
      <PlatformMark platformKey="webhook" name="Webhook" />
    </div>,
  );
  expect(mark().querySelector("img")).toBeNull();
  expect(mark().querySelector("svg")).not.toBeNull();
  const screen = await render(
    <div data-testid="other">
      <PlatformMark platformKey="segmentfault" name="Segmentfault" />
    </div>,
  );
  expect(page.getByTestId("other").element().textContent).toBe("Se");
  await screen.unmount();
});

it("falls back to the drawn symbol when the logo cannot load, for example offline", async () => {
  await render(
    <div data-testid="mark">
      <PlatformMark platformKey="instagram" name="Instagram" />
    </div>,
  );
  mark().querySelector("img")!.dispatchEvent(new Event("error"));
  await expect.poll(() => mark().querySelector("img")).toBeNull();
  expect(mark().querySelector("svg")).not.toBeNull();
});
