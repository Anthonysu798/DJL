import { describe, expect, it } from "vitest";

import type { BrowserFindingDraft } from "@synara/contracts";
import {
  appendBrowserFindingsBlock,
  BROWSER_ADJUSTMENT_STYLE_PROPERTIES,
  clampAnnotationRect,
  parseBrowserFindingsBlock,
} from "./browserFindings";

const finding: BrowserFindingDraft = {
  version: 1,
  id: "finding-1",
  imageId: "image-1",
  screenshotName: "example.png",
  markerNumber: 1,
  comment: "Make this <strong> & clearer",
  target: {
    kind: "area",
    rect: { x: 10, y: 20, width: 30, height: 40 },
  },
  page: { url: "https://example.com", title: "Example" },
  viewport: { width: 800, height: 600, deviceScaleFactor: 2, scrollX: 0, scrollY: 100 },
  adjustments: {},
  createdAt: "2026-07-13T00:00:00.000Z",
};

describe("browser findings", () => {
  it("serializes an escaped versioned block and hides it when parsed", () => {
    const serialized = appendBrowserFindingsBlock("Fix this", [finding]);
    expect(serialized).toContain("<browser_findings>");
    expect(serialized).not.toContain("<strong>");
    const parsed = parseBrowserFindingsBlock(serialized);
    expect(parsed.visibleText).toBe("Fix this");
    expect(parsed.findings[0]?.comment).toBe(finding.comment);
  });

  it("does not hide malformed or unsupported blocks", () => {
    const malformed = "hello <browser_findings>{oops}</browser_findings>";
    expect(parseBrowserFindingsBlock(malformed)).toEqual({ visibleText: malformed, findings: [] });
  });

  it("only strips a valid trailing block", () => {
    const embedded = `${appendBrowserFindingsBlock("prefix", [finding])}\nvisible suffix`;
    expect(parseBrowserFindingsBlock(embedded)).toEqual({ visibleText: embedded, findings: [] });
  });

  it("round-trips visible text containing a literal opening tag before the final block", () => {
    const visible = "Keep this literal <browser_findings> text visible";
    const serialized = appendBrowserFindingsBlock(visible, [finding]);
    expect(parseBrowserFindingsBlock(serialized)).toMatchObject({
      visibleText: visible,
      findings: [{ id: finding.id, comment: finding.comment }],
    });
  });

  it("rejects transcript metadata that exceeds contract bounds", () => {
    const block = appendBrowserFindingsBlock("prefix", [finding]).replace(
      "example.png",
      "x".repeat(513),
    );
    expect(parseBrowserFindingsBlock(block)).toEqual({ visibleText: block, findings: [] });
  });

  it("clamps drag geometry to the viewport", () => {
    expect(
      clampAnnotationRect({ x: -10, y: 90, width: 200, height: 50 }, { width: 100, height: 100 }),
    ).toEqual({ x: 0, y: 90, width: 100, height: 10 });
  });

  it("exposes only the explicit style whitelist", () => {
    expect(Object.keys(BROWSER_ADJUSTMENT_STYLE_PROPERTIES)).toEqual([
      "color",
      "backgroundColor",
      "opacity",
      "fontFamily",
      "fontSize",
      "fontWeight",
      "lineHeight",
      "letterSpacing",
      "textAlign",
      "margin",
      "padding",
      "gap",
      "borderRadius",
    ]);
    expect(BROWSER_ADJUSTMENT_STYLE_PROPERTIES).not.toHaveProperty("position");
  });
});
