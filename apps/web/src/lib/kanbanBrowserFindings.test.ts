import { describe, expect, it } from "vitest";
import type { BrowserFindingDraft } from "@synara/contracts";
import { parseBrowserFindingsBlock } from "@synara/shared/browserFindings";

import { buildKanbanBrowserFindingDispatch } from "./kanbanBrowserFindings";

const finding: BrowserFindingDraft = {
  version: 1,
  id: "finding-1",
  imageId: "image-1",
  screenshotName: "annotation-1.png",
  markerNumber: 1,
  comment: "Keep the primary action aligned.",
  target: {
    kind: "element",
    rect: { x: 10, y: 20, width: 120, height: 40 },
    selector: "main > button",
    tagName: "button",
    textPreview: "Publish changes",
    accessibleName: "",
  },
  page: { url: "https://example.test/", title: "Fixture" },
  viewport: {
    width: 800,
    height: 600,
    deviceScaleFactor: 2,
    scrollX: 0,
    scrollY: 0,
  },
  adjustments: {},
  createdAt: "2026-07-13T12:00:00.000Z",
};

describe("buildKanbanBrowserFindingDispatch", () => {
  it("serializes a findings-only draft and supplies its title seed", () => {
    const result = buildKanbanBrowserFindingDispatch({
      prompt: "",
      messageText: "",
      findings: [finding],
    });

    expect(result.titleSeed).toBe("Browser finding");
    expect(result.messageText.match(/<browser_findings>/g)).toHaveLength(1);
    expect(parseBrowserFindingsBlock(result.messageText).findings).toEqual([
      expect.objectContaining({
        screenshotName: "annotation-1.png",
        markerNumber: 1,
        comment: "Keep the primary action aligned.",
      }),
    ]);
  });

  it("keeps prompt title precedence while appending multiple findings", () => {
    const result = buildKanbanBrowserFindingDispatch({
      prompt: "Polish this page",
      messageText: "Polish this page",
      findings: [finding, { ...finding, id: "finding-2", markerNumber: 2 }],
    });

    expect(result.titleSeed).toBe("Polish this page");
    expect(parseBrowserFindingsBlock(result.messageText).findings).toHaveLength(2);
  });
});
