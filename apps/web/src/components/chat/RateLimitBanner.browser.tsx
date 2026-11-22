import "../../index.css";

import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";

import { RateLimitBanner } from "./RateLimitBanner";

afterEach(() => {
  cleanup();
});

describe("RateLimitBanner", () => {
  it("renders nothing without a status or a notice", async () => {
    render(<RateLimitBanner rateLimitStatus={null} />);
    expect(document.querySelector("[role=alert]")).toBeNull();
  });

  it("shows a low-limit notice with a switch action and a dismiss control", async () => {
    const onSwitch = vi.fn();
    const onDismiss = vi.fn();
    render(
      <RateLimitBanner
        rateLimitStatus={null}
        notice="Codex has 6% left on its 5h limit."
        switchAction={{ label: "Continue with Claude", onClick: onSwitch }}
        onDismiss={onDismiss}
      />,
    );

    await expect.element(page.getByText("Codex has 6% left on its 5h limit.")).toBeVisible();
    await page.getByRole("button", { name: "Continue with Claude" }).click();
    expect(onSwitch).toHaveBeenCalledTimes(1);
    await page.getByRole("button", { name: "Dismiss rate limit status" }).click();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("keeps the provider's own rate-limit message and adds the switch action", async () => {
    render(
      <RateLimitBanner
        rateLimitStatus={{ status: "rejected" }}
        notice="ignored while the provider reports a status"
        switchAction={{ label: "Continue with Codex", onClick: () => {}, disabled: true }}
      />,
    );

    await expect.element(page.getByText("Rate limit reached.")).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Continue with Codex" })).toBeDisabled();
    expect(document.body.textContent).not.toContain("ignored while");
  });
});
