import { EventId } from "@synara/contracts";
import { page } from "vitest/browser";
import { expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { ContextWindowMeter } from "./ContextWindowMeter";
import {
  deriveLatestContextWindowSnapshot,
  derivePendingContextWindowSnapshot,
} from "../../lib/contextWindow";

it("distinguishes unreported usage from real provider measurements", async () => {
  const screen = await render(
    <ContextWindowMeter usage={derivePendingContextWindowSnapshot(1000000)} />,
  );
  await page.getByRole("button", { name: "Context window: Usage not reported yet" }).click();
  await expect.element(page.getByText("Usage not reported yet", { exact: true })).toBeVisible();
  const usage = deriveLatestContextWindowSnapshot([
    {
      id: EventId.makeUnsafe("usage"),
      kind: "context-window.updated",
      summary: "Context window updated",
      tone: "info",
      turnId: null,
      createdAt: new Date().toISOString(),
      payload: { usedTokens: 35000, maxTokens: 1000000 },
    },
  ])!;
  await screen.rerender(<ContextWindowMeter usage={usage} />);
  await expect
    .element(page.getByRole("button", { name: /Context window.*3.5%/ }))
    .toBeInTheDocument();
  await expect.element(page.getByText("35k", { exact: true })).toBeVisible();
  await expect
    .element(page.getByText("Usage not reported yet", { exact: true }))
    .not.toBeInTheDocument();
  await screen.unmount();
});
