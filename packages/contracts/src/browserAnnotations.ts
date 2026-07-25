import { Schema } from "effect";

import { ThreadId } from "./baseSchemas";

const BoundedString = (maxLength: number) => Schema.String.check(Schema.isMaxLength(maxLength));
const FiniteNumber = Schema.Finite;
const NonNegativeFiniteNumber = FiniteNumber.check(Schema.isGreaterThanOrEqualTo(0));
const PositiveFiniteNumber = FiniteNumber.check(Schema.isGreaterThan(0));
const SafeCssString = (maxLength: number) =>
  BoundedString(maxLength).check(
    Schema.makeFilter((value: string) =>
      /url\s*\(|@import|expression\s*\(|[;{}<>]/i.test(value)
        ? { path: [], message: "unsafe CSS value" }
        : undefined,
    ),
  );
const CssColor = SafeCssString(64).check(
  Schema.isPattern(/^(?:#[0-9a-f]{3,8}|(?:rgb|hsl)a?\([0-9.,%\s+-]+\)|transparent|currentcolor)$/i),
);
const CssFontSize = SafeCssString(64).check(
  Schema.isPattern(/^(?:0|(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em|%|vh|vw))$/i),
);
const CssLineHeight = SafeCssString(64).check(
  Schema.isPattern(/^(?:normal|(?:\d+(?:\.\d+)?|\.\d+)(?:(?:px|rem|em|%|vh|vw))?)$/i),
);
const CssLetterSpacing = SafeCssString(64).check(
  Schema.isPattern(/^(?:normal|0|-?(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em|%|vh|vw))$/i),
);
const CssSignedBox = SafeCssString(128).check(
  Schema.isPattern(
    /^(?:0|-?(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em|%|vh|vw))(?:\s+(?:0|-?(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em|%|vh|vw))){0,3}$/i,
  ),
);
const CssNonNegativeBox = SafeCssString(128).check(
  Schema.isPattern(
    /^(?:0|(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em|%|vh|vw))(?:\s+(?:0|(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em|%|vh|vw))){0,3}$/i,
  ),
);

export const BrowserAnnotationRect = Schema.Struct({
  x: FiniteNumber,
  y: FiniteNumber,
  width: NonNegativeFiniteNumber,
  height: NonNegativeFiniteNumber,
});
export type BrowserAnnotationRect = typeof BrowserAnnotationRect.Type;

export const BrowserAnnotationViewport = Schema.Struct({
  width: NonNegativeFiniteNumber,
  height: NonNegativeFiniteNumber,
  deviceScaleFactor: PositiveFiniteNumber,
  scrollX: FiniteNumber,
  scrollY: FiniteNumber,
});
export type BrowserAnnotationViewport = typeof BrowserAnnotationViewport.Type;

export const BrowserAnnotationPage = Schema.Struct({
  url: BoundedString(8_192),
  title: BoundedString(512),
});
export type BrowserAnnotationPage = typeof BrowserAnnotationPage.Type;

const BrowserElementAnnotationTarget = Schema.Struct({
  kind: Schema.Literal("element"),
  rect: BrowserAnnotationRect,
  selector: BoundedString(2_048),
  tagName: BoundedString(64),
  textPreview: BoundedString(500),
  accessibleName: BoundedString(500),
});

const BrowserAreaAnnotationTarget = Schema.Struct({
  kind: Schema.Literal("area"),
  rect: BrowserAnnotationRect,
});

export const BrowserAnnotationTarget = Schema.Union([
  BrowserElementAnnotationTarget,
  BrowserAreaAnnotationTarget,
]);
export type BrowserAnnotationTarget = typeof BrowserAnnotationTarget.Type;

export const BrowserAnnotationAdjustments = Schema.Struct({
  textContent: Schema.optionalKey(BoundedString(10_000)),
  color: Schema.optionalKey(CssColor),
  backgroundColor: Schema.optionalKey(CssColor),
  opacity: Schema.optionalKey(
    FiniteNumber.check(Schema.isGreaterThanOrEqualTo(0)).check(Schema.isLessThanOrEqualTo(1)),
  ),
  fontFamily: Schema.optionalKey(SafeCssString(256).check(Schema.isPattern(/^[\w\s,'"-]+$/))),
  fontSize: Schema.optionalKey(CssFontSize),
  fontWeight: Schema.optionalKey(
    SafeCssString(64).check(Schema.isPattern(/^(?:[1-9]00|normal|bold|bolder|lighter)$/)),
  ),
  lineHeight: Schema.optionalKey(CssLineHeight),
  letterSpacing: Schema.optionalKey(CssLetterSpacing),
  textAlign: Schema.optionalKey(
    Schema.Literals(["left", "right", "center", "justify", "start", "end"]),
  ),
  margin: Schema.optionalKey(CssSignedBox),
  padding: Schema.optionalKey(CssNonNegativeBox),
  gap: Schema.optionalKey(CssNonNegativeBox),
  borderRadius: Schema.optionalKey(CssNonNegativeBox),
});
export type BrowserAnnotationAdjustments = typeof BrowserAnnotationAdjustments.Type;

export const BrowserAnnotationSelection = Schema.Struct({
  id: BoundedString(128),
  target: BrowserAnnotationTarget,
  page: BrowserAnnotationPage,
  viewport: BrowserAnnotationViewport,
});
export type BrowserAnnotationSelection = typeof BrowserAnnotationSelection.Type;

export const BrowserAnnotationEvent = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("selected"),
    threadId: ThreadId,
    tabId: BoundedString(128),
    selection: BrowserAnnotationSelection,
  }),
  Schema.Struct({
    type: Schema.Literal("cancelled"),
    threadId: ThreadId,
    tabId: BoundedString(128),
  }),
  Schema.Struct({
    type: Schema.Literal("runtime-ready"),
    threadId: ThreadId,
    tabId: BoundedString(128),
  }),
  Schema.Struct({
    type: Schema.Literal("runtime-error"),
    threadId: ThreadId,
    tabId: BoundedString(128),
    message: BoundedString(500),
  }),
]);
export type BrowserAnnotationEvent = typeof BrowserAnnotationEvent.Type;

export const BrowserAnnotationCommandInput = Schema.Struct({
  threadId: ThreadId,
  tabId: BoundedString(128),
  command: Schema.Union([
    Schema.Struct({ type: Schema.Literal("enable") }),
    Schema.Struct({ type: Schema.Literal("disable") }),
    Schema.Struct({ type: Schema.Literal("cancel-selection") }),
    Schema.Struct({ type: Schema.Literal("select-area") }),
    Schema.Struct({
      type: Schema.Literal("preview"),
      selectionId: BoundedString(128),
      adjustments: BrowserAnnotationAdjustments,
    }),
  ]),
});
export type BrowserAnnotationCommandInput = typeof BrowserAnnotationCommandInput.Type;

export const BrowserAnnotationCaptureInput = Schema.Struct({
  threadId: ThreadId,
  tabId: BoundedString(128),
  selectionId: BoundedString(128),
  markerNumber: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 20 })),
  adjustments: BrowserAnnotationAdjustments,
});
export type BrowserAnnotationCaptureInput = typeof BrowserAnnotationCaptureInput.Type;

export const BrowserAnnotationCaptureMetadata = Schema.Struct({
  target: BrowserAnnotationTarget,
  page: BrowserAnnotationPage,
  viewport: BrowserAnnotationViewport,
});
export type BrowserAnnotationCaptureMetadata = typeof BrowserAnnotationCaptureMetadata.Type;

export const BrowserFindingDraft = Schema.Struct({
  version: Schema.Literal(1),
  id: BoundedString(128),
  imageId: BoundedString(128),
  screenshotName: BoundedString(512),
  markerNumber: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 20 })),
  comment: BoundedString(10_000),
  target: BrowserAnnotationTarget,
  page: BrowserAnnotationPage,
  viewport: BrowserAnnotationViewport,
  adjustments: BrowserAnnotationAdjustments,
  createdAt: BoundedString(64),
});
export type BrowserFindingDraft = typeof BrowserFindingDraft.Type;

// Prompt/transcript metadata deliberately omits the renderer-local image id. The stable
// screenshot name associates each entry with its ordinary PNG attachment.
export const BrowserFindingPromptEntry = Schema.Struct({
  version: Schema.Literal(1),
  id: BoundedString(128),
  screenshotName: BoundedString(512),
  markerNumber: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 20 })),
  comment: BoundedString(10_000),
  target: BrowserAnnotationTarget,
  page: BrowserAnnotationPage,
  viewport: BrowserAnnotationViewport,
  adjustments: BrowserAnnotationAdjustments,
  createdAt: BoundedString(64),
});
export type BrowserFindingPromptEntry = typeof BrowserFindingPromptEntry.Type;

export const BrowserFindingsPromptPayload = Schema.Struct({
  version: Schema.Literal(1),
  findings: Schema.Array(BrowserFindingPromptEntry).check(Schema.isMaxLength(20)),
});
export type BrowserFindingsPromptPayload = typeof BrowserFindingsPromptPayload.Type;
