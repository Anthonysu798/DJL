import "../../index.css";

import type { BrowserFindingDraft, BrowserFindingPromptEntry } from "@synara/contracts";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { BrowserFindingsSummaryChip } from "./BrowserFindingsSummaryChip";

const finding: BrowserFindingDraft = {
  version: 1,
  id: "finding-1",
  imageId: "image-1",
  screenshotName: "annotated-1.png",
  markerNumber: 1,
  comment: "Tighten this spacing",
  target: { kind: "area", rect: { x: 1, y: 2, width: 30, height: 40 } },
  page: { url: "https://example.test", title: "Fixture" },
  viewport: { width: 800, height: 600, deviceScaleFactor: 1, scrollX: 0, scrollY: 0 },
  adjustments: {},
  createdAt: "2026-07-13T00:00:00.000Z",
};

async function mountChip(input: {
  promptFinding?: BrowserFindingPromptEntry;
  onEditComment?: (findingId: string, comment: string) => void;
  onRemove?: (findingId: string) => void;
  nonPersistedImageIds?: ReadonlySet<string>;
}) {
  const onExpandImage = vi.fn();
  const host = document.createElement("div");
  document.body.append(host);
  const screen = await render(
    <BrowserFindingsSummaryChip
      findings={[input.promptFinding ?? finding]}
      images={[
        {
          id: "image-1",
          name: "annotated-1.png",
          previewUrl: "data:image/png;base64,iVBORw0KGgo=",
        },
      ]}
      {...(input.nonPersistedImageIds
        ? { nonPersistedImageIdSet: input.nonPersistedImageIds }
        : {})}
      {...(input.onEditComment ? { onEditComment: input.onEditComment } : {})}
      {...(input.onRemove ? { onRemove: input.onRemove } : {})}
      onExpandImage={onExpandImage}
    />,
    { container: host },
  );
  return {
    onExpandImage,
    async [Symbol.asyncDispose]() {
      await screen.unmount();
      host.remove();
    },
  };
}

describe("BrowserFindingsSummaryChip", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("opens, previews the named screenshot, and returns focus on Escape", async () => {
    await using mounted = await mountChip({});
    const trigger = page.getByRole("button", { name: "1 browser finding" });
    await trigger.click();
    const preview = page.getByRole("button", { name: "Preview browser finding 1" });
    await expect.element(preview).toBeVisible();
    await preview.click();
    expect(mounted.onExpandImage).toHaveBeenCalledWith({
      images: [{ src: "data:image/png;base64,iVBORw0KGgo=", name: "annotated-1.png" }],
      index: 0,
    });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await expect.element(trigger).toHaveFocus();
    await expect.element(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("reverts empty edits and exposes an atomic remove action", async () => {
    const onEditComment = vi.fn();
    const onRemove = vi.fn();
    await using _ = await mountChip({ onEditComment, onRemove });
    await page.getByRole("button", { name: "1 browser finding" }).click();
    const input = page.getByLabelText("Edit browser finding 1");
    await input.fill("   ");
    document.querySelector<HTMLInputElement>('[aria-label="Edit browser finding 1"]')?.blur();
    await expect.element(input).toHaveValue("Tighten this spacing");
    expect(onEditComment).not.toHaveBeenCalled();
    await page.getByRole("button", { name: "Remove browser finding 1" }).click();
    expect(onRemove).toHaveBeenCalledWith("finding-1");
  });

  it("associates transcript prompt metadata to a screenshot by name", async () => {
    const { imageId: _, ...promptFinding } = finding;
    await using _mounted = await mountChip({ promptFinding });
    await page.getByRole("button", { name: "1 browser finding" }).click();
    await expect
      .element(page.getByRole("button", { name: "Preview browser finding 1" }))
      .toBeVisible();
    await expect.element(page.getByText("Tighten this spacing")).toBeVisible();
    await expect.element(page.getByText(/browser_findings/u)).not.toBeInTheDocument();
  });

  it("surfaces persistence failure for a linked finding screenshot", async () => {
    await using _mounted = await mountChip({
      nonPersistedImageIds: new Set(["image-1"]),
    });
    await page.getByRole("button", { name: "1 browser finding" }).click();
    await expect
      .element(page.getByRole("img", { name: "Draft attachment may not persist" }))
      .toBeVisible();
  });
});
