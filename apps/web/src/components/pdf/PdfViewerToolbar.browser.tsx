import "../../index.css";

import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "vitest-browser-react";

import { PdfViewerToolbar } from "./PdfViewerToolbar";

describe("PdfViewerToolbar document actions", () => {
  afterEach(async () => cleanup());

  it("exposes search, print, and fullscreen controls", async () => {
    const onSearchQueryChange = vi.fn();
    const onPrint = vi.fn();
    const onToggleFullscreen = vi.fn();

    await render(
      <PdfViewerToolbar
        fileName="essay.docx"
        currentPage={1}
        numPages={2}
        onJumpToPage={() => undefined}
        zoomMode={{ type: "custom", scale: 1 }}
        scale={1}
        onZoomIn={() => undefined}
        onZoomOut={() => undefined}
        onSetScale={() => undefined}
        onFitWidth={() => undefined}
        onFitPage={() => undefined}
        openInTarget={null}
        documentType="DOCX"
        controlsOnly
        searchQuery=""
        searchMatchIndex={-1}
        searchMatchCount={0}
        searchPending={false}
        onSearchQueryChange={onSearchQueryChange}
        onSearchPrevious={() => undefined}
        onSearchNext={() => undefined}
        onPrint={onPrint}
        onToggleFullscreen={onToggleFullscreen}
        isFullscreen={false}
      />,
    );

    await page.getByRole("button", { name: "Search document" }).click();
    const input = page.getByRole("textbox", { name: "Search document" });
    await expect.element(input).toBeVisible();
    await input.fill("frontier");
    expect(onSearchQueryChange).toHaveBeenCalledWith("frontier");

    await page.getByRole("button", { name: "Print document" }).click();
    await page.getByRole("button", { name: "Enter fullscreen" }).click();
    expect(onPrint).toHaveBeenCalledOnce();
    expect(onToggleFullscreen).toHaveBeenCalledOnce();
  });
});
