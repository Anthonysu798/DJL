import "../../index.css";

import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "vitest-browser-react";

import { ModelGuideCard } from "./ModelGuideCard";

describe("ModelGuideCard", () => {
  afterEach(cleanup);

  it("explains the tradeoff and starts guided API setup", async () => {
    const onConnect = vi.fn();
    const onContinue = vi.fn();
    await render(
      <ModelGuideCard
        anchor={null}
        currentModel="djl-qwen:7b"
        hasConnectedProvider={false}
        connectionPending={false}
        onConnect={onConnect}
        onChoose={vi.fn()}
        onContinue={onContinue}
      />,
    );

    await expect
      .element(page.getByRole("dialog", { name: "Choose the right model for DJL" }))
      .toBeVisible();
    await expect.element(page.getByText("Current · djl-qwen:7b")).toBeVisible();
    await expect.element(page.getByText("Private and works offline")).toBeVisible();
    await expect.element(page.getByText("Uses tools more reliably")).toBeVisible();
    await page.getByRole("button", { name: "Connect API model" }).click();
    expect(onConnect).toHaveBeenCalledOnce();
    await page.getByRole("button", { name: "Close" }).click();
    expect(onContinue).toHaveBeenCalledOnce();
  });

  it("offers model selection when a provider is connected and expands setup help", async () => {
    const onChoose = vi.fn();
    await render(
      <ModelGuideCard
        anchor={null}
        currentModel={null}
        hasConnectedProvider
        connectionPending={false}
        onConnect={vi.fn()}
        onChoose={onChoose}
        onContinue={vi.fn()}
      />,
    );

    await page.getByRole("button", { name: "How API setup works" }).click();
    await expect.element(page.getByText("Three simple steps")).toBeVisible();
    await expect
      .element(page.getByText("Paste the key into DJL and test the connection."))
      .toBeVisible();
    await expect.element(page.getByRole("button", { name: "Back" })).toBeVisible();
    await page.getByRole("button", { name: "Back" }).click();
    await expect.element(page.getByRole("button", { name: "How API setup works" })).toBeVisible();
    await page.getByRole("button", { name: "How API setup works" }).click();
    await page.getByRole("button", { name: "Choose API model" }).click();
    expect(onChoose).toHaveBeenCalledOnce();
  });
});
