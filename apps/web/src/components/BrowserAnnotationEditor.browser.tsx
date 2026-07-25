import "../index.css";

import type { BrowserAnnotationAdjustments, BrowserAnnotationSelection } from "@synara/contracts";
import { BrowserAnnotationAdjustments as BrowserAnnotationAdjustmentsSchema } from "@synara/contracts";
import { Schema } from "effect";
import { useState } from "react";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { BrowserAnnotationEditor } from "./BrowserAnnotationEditor";

const baseSelection = {
  id: "selection-1",
  page: { url: "https://example.test", title: "Fixture" },
  viewport: { width: 800, height: 600, deviceScaleFactor: 1, scrollX: 0, scrollY: 0 },
} as const;

const elementSelection: BrowserAnnotationSelection = {
  ...baseSelection,
  target: {
    kind: "element",
    rect: { x: 10, y: 20, width: 100, height: 40 },
    selector: "main > button",
    tagName: "button",
    textPreview: "Save",
    accessibleName: "Save changes",
  },
};

const areaSelection: BrowserAnnotationSelection = {
  ...baseSelection,
  target: { kind: "area", rect: { x: 10, y: 20, width: 100, height: 40 } },
};

async function mountEditor(selection: BrowserAnnotationSelection) {
  const onSave = vi.fn();
  const onCancel = vi.fn();
  const onAdjustmentsChange = vi.fn();
  function Harness() {
    const [comment, setComment] = useState("Change this element");
    const [adjustOpen, setAdjustOpen] = useState(false);
    const [adjustments, setAdjustments] = useState<BrowserAnnotationAdjustments>({});
    return (
      <BrowserAnnotationEditor
        selection={selection}
        comment={comment}
        adjustments={adjustments}
        adjustmentsValid={Schema.is(BrowserAnnotationAdjustmentsSchema)(adjustments)}
        adjustOpen={adjustOpen}
        saving={false}
        onCommentChange={setComment}
        onAdjustOpenChange={setAdjustOpen}
        onAdjustmentsChange={(next) => {
          onAdjustmentsChange(next);
          setAdjustments(next);
        }}
        onCancel={onCancel}
        onSave={onSave}
      />
    );
  }
  const host = document.createElement("div");
  document.body.append(host);
  const screen = await render(<Harness />, { container: host });
  return {
    onSave,
    onCancel,
    onAdjustmentsChange,
    async [Symbol.asyncDispose]() {
      await screen.unmount();
      host.remove();
    },
  };
}

describe("BrowserAnnotationEditor", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("edits, resets individual element adjustments, and resets all", async () => {
    await using mounted = await mountEditor(elementSelection);
    await page.getByRole("button", { name: "Adjust" }).click();
    await page.getByRole("textbox", { name: "Text content" }).fill("Publish");
    await page.getByRole("textbox", { name: "Text color" }).fill("#112233");
    await page.getByRole("spinbutton", { name: "Opacity" }).fill("0.5");
    expect(mounted.onAdjustmentsChange).toHaveBeenLastCalledWith({
      textContent: "Publish",
      color: "#112233",
      opacity: 0.5,
    });
    await page.getByRole("button", { name: "Reset Text color" }).click();
    expect(mounted.onAdjustmentsChange).toHaveBeenLastCalledWith({
      textContent: "Publish",
      opacity: 0.5,
    });
    await page.getByRole("button", { name: "Reset all" }).click();
    expect(mounted.onAdjustmentsChange).toHaveBeenLastCalledWith({});
  });

  it("keeps area annotations comment-only and exposes save/cancel actions", async () => {
    await using mounted = await mountEditor(areaSelection);
    await expect.element(page.getByRole("button", { name: "Adjust" })).not.toBeInTheDocument();
    await page.getByRole("button", { name: "Save" }).click();
    await page.getByRole("button", { name: "Cancel" }).click();
    expect(mounted.onSave).toHaveBeenCalledOnce();
    expect(mounted.onCancel).toHaveBeenCalledOnce();
  });

  it("keeps incremental adjustment input editable without enabling save", async () => {
    await using _ = await mountEditor(elementSelection);
    await page.getByRole("button", { name: "Adjust" }).click();
    const color = page.getByRole("textbox", { name: "Text color" });
    await color.fill("#");
    await expect.element(color).toHaveValue("#");
    await expect.element(page.getByRole("alert")).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Save" })).toBeDisabled();
    await color.fill("#123456");
    await expect.element(page.getByRole("alert")).not.toBeInTheDocument();
    await expect.element(page.getByRole("button", { name: "Save" })).toBeEnabled();
  });
});
