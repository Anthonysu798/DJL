import { describe, expect, it } from "vitest";
import { Schema } from "effect";

import {
  BrowserAnnotationCaptureInput,
  BrowserAnnotationAdjustments,
  BrowserAnnotationEvent,
  BrowserAnnotationTarget,
  BrowserAnnotationViewport,
} from "./browserAnnotations";

const decode = (schema: Parameters<typeof Schema.decodeUnknownSync>[0], input: unknown) =>
  Schema.decodeUnknownSync(schema)(input);

describe("browser annotation contracts", () => {
  it("accepts bounded element metadata", () => {
    expect(
      decode(BrowserAnnotationTarget, {
        kind: "element",
        rect: { x: 1, y: 2, width: 300, height: 40 },
        selector: "main > button:nth-of-type(1)",
        tagName: "button",
        textPreview: "Save",
        accessibleName: "Save changes",
      }),
    ).toMatchObject({ kind: "element" });
  });

  it("rejects oversized page-originated metadata and invalid marker numbers", () => {
    expect(() =>
      decode(BrowserAnnotationTarget, {
        kind: "element",
        rect: { x: 0, y: 0, width: 1, height: 1 },
        selector: "x".repeat(2_049),
        tagName: "div",
        textPreview: "",
        accessibleName: "",
      }),
    ).toThrow();
    expect(() =>
      decode(BrowserAnnotationCaptureInput, {
        threadId: "thread-1",
        tabId: "tab-1",
        selectionId: "selection-1",
        markerNumber: 21,
        adjustments: {},
      }),
    ).toThrow();
  });

  it("rejects unbounded or unknown event shapes", () => {
    expect(() =>
      decode(BrowserAnnotationEvent, {
        type: "selected",
        threadId: "thread-1",
        tabId: "tab-1",
        selection: { id: "x" },
      }),
    ).toThrow();
    expect(
      decode(BrowserAnnotationEvent, {
        type: "runtime-ready",
        threadId: "thread-1",
        tabId: "tab-1",
      }),
    ).toMatchObject({ type: "runtime-ready" });
  });

  it("constrains opacity and device scale factor", () => {
    expect(() => decode(BrowserAnnotationAdjustments, { opacity: 1.01 })).toThrow();
    expect(() => decode(BrowserAnnotationAdjustments, { opacity: -0.01 })).toThrow();
    expect(() =>
      decode(BrowserAnnotationViewport, {
        width: 800,
        height: 600,
        deviceScaleFactor: 0,
        scrollX: 0,
        scrollY: 0,
      }),
    ).toThrow();
  });

  it("rejects network-bearing and malformed style values", () => {
    expect(() =>
      decode(BrowserAnnotationAdjustments, { backgroundColor: "url(https://evil.test/x)" }),
    ).toThrow();
    expect(() => decode(BrowserAnnotationAdjustments, { textAlign: "fixed" })).toThrow();
    expect(() => decode(BrowserAnnotationAdjustments, { fontSize: "calc(1px + 2vw)" })).toThrow();
    expect(() => decode(BrowserAnnotationAdjustments, { fontSize: "16" })).toThrow();
    expect(() => decode(BrowserAnnotationAdjustments, { color: "notacolor" })).toThrow();
    expect(() => decode(BrowserAnnotationAdjustments, { margin: "8 12" })).toThrow();
    expect(() => decode(BrowserAnnotationAdjustments, { padding: "-8px" })).toThrow();
    expect(
      decode(BrowserAnnotationAdjustments, {
        color: "#aabbcc",
        padding: "8px 12px",
        lineHeight: "1.5",
        textAlign: "center",
      }),
    ).toMatchObject({ textAlign: "center" });
  });
});
