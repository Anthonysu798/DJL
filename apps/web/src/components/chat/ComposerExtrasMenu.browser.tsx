// FILE: ComposerExtrasMenu.browser.tsx
// Purpose: Verifies the composer `+` menu exposes image-only uploads and quick mode toggles.
// Layer: Browser UI test
// Depends on: vitest browser rendering helpers and the ComposerExtrasMenu component.

import "../../index.css";

import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { ComposerExtrasMenu } from "./ComposerExtrasMenu";

async function mountMenu(props?: {
  fastModeEnabled?: boolean;
  interactionMode?: "default" | "plan";
  supportsFastMode?: boolean;
}) {
  const onAddAttachments = vi.fn<(files: File[]) => void>();
  const onToggleFastMode = vi.fn();
  const onSetPlanMode = vi.fn();
  const host = document.createElement("div");
  document.body.append(host);
  const screen = await render(
    <ComposerExtrasMenu
      interactionMode={props?.interactionMode ?? "default"}
      supportsFastMode={props?.supportsFastMode ?? true}
      fastModeEnabled={props?.fastModeEnabled ?? false}
      onAddAttachments={onAddAttachments}
      onToggleFastMode={onToggleFastMode}
      onSetPlanMode={onSetPlanMode}
    />,
    { container: host },
  );

  const cleanup = async () => {
    await screen.unmount();
    host.remove();
  };

  return {
    [Symbol.asyncDispose]: cleanup,
    cleanup,
    onAddAttachments,
    onToggleFastMode,
    onSetPlanMode,
  };
}

describe("ComposerExtrasMenu", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("accepts Work documents and images from one file picker", async () => {
    await using menu = await mountMenu();

    const input = document.querySelector<HTMLInputElement>("[data-testid='composer-photo-input']");
    expect(input).not.toBeNull();
    expect(input?.accept).toContain("image/*");
    expect(input?.accept).toContain(".pdf");
    expect(input?.accept).toContain(".docx");
    expect(input?.accept).toContain(".xlsx");
    expect(input?.accept).toContain(".pptx");

    const files = new DataTransfer();
    files.items.add(new File(["photo"], "photo.png", { type: "image/png" }));
    files.items.add(
      new File(["docx"], "proposal.docx", {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    );
    Object.defineProperty(input, "files", {
      configurable: true,
      value: files.files,
    });
    input?.dispatchEvent(new Event("change", { bubbles: true }));

    expect(menu.onAddAttachments).toHaveBeenCalledTimes(1);
    expect(menu.onAddAttachments.mock.calls[0]?.[0]?.map((file) => file.name)).toEqual([
      "photo.png",
      "proposal.docx",
    ]);
  });

  it("shows the attachment action in the menu", async () => {
    await using _ = await mountMenu({ interactionMode: "plan", fastModeEnabled: true });

    await page.getByLabelText("Composer extras").click();

    await vi.waitFor(() => {
      const text = document.body.textContent ?? "";
      expect(text).toContain("Add files");
      expect(text).toContain("Plan mode");
      expect(text).toContain("Fast");
      expect(text).not.toContain("Plugins");
    });
  });

  it("wires the plan and speed controls", async () => {
    await using menu = await mountMenu();

    await page.getByLabelText("Composer extras").click();
    await page.getByText("Plan mode").click();
    await page.getByText("Fast").click();
    await page.getByRole("menuitemradio", { name: "Fast" }).click();

    expect(menu.onSetPlanMode).toHaveBeenCalledWith(true);
    expect(menu.onToggleFastMode).toHaveBeenCalledTimes(1);
  });
});
