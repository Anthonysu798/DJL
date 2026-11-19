import { Schema } from "effect";
import { NonNegativeInt, PositiveInt, ThreadId, TrimmedNonEmptyString } from "./baseSchemas";
import { ComputerActivityPage, ComputerActivitySnapshot } from "./computerActivity";
import { ComputerActivityTimestamp, ComputerActivityScope } from "./computerActivityScope";

const Id = TrimmedNonEmptyString.check(Schema.isMaxLength(128));
const ShortText = Schema.String.check(Schema.isMaxLength(512));
const InputText = Schema.String.check(Schema.isMaxLength(16_384));
const Timestamp = Schema.String.check(Schema.isMaxLength(40)).check(Schema.isNonEmpty());
const Coordinate = Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 100_000 }));
const Dimension = Schema.Finite.check(Schema.isGreaterThan(0)).check(
  Schema.isLessThanOrEqualTo(100_000),
);
const ElementId = NonNegativeInt.check(Schema.isLessThanOrEqualTo(500));
const BundleId = TrimmedNonEmptyString.check(Schema.isMaxLength(256));

export const ComputerUsePermission = Schema.Literals([
  "granted",
  "denied",
  "not-determined",
  "unsupported",
]);
export type ComputerUsePermission = typeof ComputerUsePermission.Type;

export const ComputerUseActionType = Schema.Literals([
  "click",
  "drag",
  "type",
  "paste",
  "selectText",
  "pressKey",
  "scroll",
  "setValue",
  "performAction",
]);
export type ComputerUseActionType = typeof ComputerUseActionType.Type;

export const ComputerUseStatus = Schema.Struct({
  platform: Schema.Literals(["darwin", "win32", "linux", "unsupported"]),
  available: Schema.Boolean,
  permissions: Schema.Struct({
    accessibility: ComputerUsePermission,
    screenRecording: ComputerUsePermission,
  }),
  capabilities: Schema.Struct({
    observation: Schema.Boolean,
    screenshots: Schema.Boolean,
    backgroundActions: Schema.Array(ComputerUseActionType).check(
      Schema.isMaxLength(9),
      Schema.makeFilter((values) => new Set(values).size === values.length),
    ),
    virtualCursor: Schema.Boolean,
    passiveHistory: Schema.Boolean,
  }),
  message: Schema.optionalKey(ShortText),
});
export type ComputerUseStatus = typeof ComputerUseStatus.Type;

export const ComputerUseTarget = Schema.Struct({
  bundleId: BundleId,
  pid: PositiveInt.check(Schema.isLessThanOrEqualTo(2_147_483_647)),
  windowId: PositiveInt.check(Schema.isLessThanOrEqualTo(4_294_967_295)),
});
export type ComputerUseTarget = typeof ComputerUseTarget.Type;

// Bounds use screen points; negative origins are valid on secondary displays.
export const ComputerUseBounds = Schema.Struct({
  x: Schema.Finite.check(Schema.isBetween({ minimum: -100_000, maximum: 100_000 })),
  y: Schema.Finite.check(Schema.isBetween({ minimum: -100_000, maximum: 100_000 })),
  width: Dimension,
  height: Dimension,
});
export type ComputerUseBounds = typeof ComputerUseBounds.Type;

export const ComputerUseApp = Schema.Struct({
  bundleId: BundleId,
  pid: ComputerUseTarget.fields.pid,
  name: ShortText,
  windows: Schema.Array(
    Schema.Struct({
      windowId: ComputerUseTarget.fields.windowId,
      title: ShortText,
      bounds: ComputerUseBounds,
    }),
  ).check(Schema.isMaxLength(100)),
});
export type ComputerUseApp = typeof ComputerUseApp.Type;

// Thread identity comes from the authenticated host, never a model request.
// The manager must enforce ownership and reject expired process/window identities.
export const ComputerUseSession = Schema.Struct({
  sessionId: Id,
  threadId: ThreadId.check(Schema.isMaxLength(128)),
  target: ComputerUseTarget,
});
export type ComputerUseSession = typeof ComputerUseSession.Type;

export const ComputerUseElementReference = Schema.Struct({
  kind: Schema.Literal("element"),
  snapshotId: Id,
  elementId: ElementId,
});
export type ComputerUseElementReference = typeof ComputerUseElementReference.Type;

// Action points are relative to the session's target window, in logical points.
// The runtime additionally checks them against the current window bounds.
export const ComputerUsePoint = Schema.Struct({
  kind: Schema.Literal("point"),
  x: Coordinate,
  y: Coordinate,
});
export type ComputerUsePoint = typeof ComputerUsePoint.Type;

export const ComputerUseActionTarget = Schema.Union([
  ComputerUsePoint,
  ComputerUseElementReference,
]);
export type ComputerUseActionTarget = typeof ComputerUseActionTarget.Type;

export const ComputerUseAccessibilityAction = Schema.Literals([
  "press",
  "confirm",
  "increment",
  "decrement",
  "showMenu",
  "raise",
  "pick",
  "cancel",
]);
export type ComputerUseAccessibilityAction = typeof ComputerUseAccessibilityAction.Type;

export const ComputerUseAction = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("click"),
    target: ComputerUseActionTarget,
    button: Schema.optionalKey(Schema.Literals(["left", "right", "middle"])),
    count: Schema.optionalKey(PositiveInt.check(Schema.isLessThanOrEqualTo(3))),
  }),
  Schema.Struct({
    type: Schema.Literal("drag"),
    from: ComputerUseActionTarget,
    to: ComputerUseActionTarget,
    durationMs: Schema.optionalKey(PositiveInt.check(Schema.isLessThanOrEqualTo(10_000))),
  }),
  Schema.Struct({
    type: Schema.Literal("type"),
    target: ComputerUseActionTarget,
    text: InputText.check(Schema.isNonEmpty()),
  }),
  Schema.Struct({
    type: Schema.Literal("paste"),
    target: ComputerUseElementReference,
    text: InputText.check(Schema.isNonEmpty()),
    format: Schema.Literals(["text", "md", "html"]),
  }),
  Schema.Struct({
    type: Schema.Literal("pressKey"),
    target: ComputerUseActionTarget,
    key: TrimmedNonEmptyString.check(Schema.isMaxLength(64)),
    modifiers: Schema.optionalKey(
      Schema.Array(Schema.Literals(["command", "control", "option", "shift"])).check(
        Schema.isMaxLength(4),
      ),
    ),
  }),
  Schema.Struct({
    type: Schema.Literal("selectText"),
    target: ComputerUseElementReference,
    text: InputText.check(Schema.isNonEmpty()),
    prefix: Schema.optionalKey(InputText),
    suffix: Schema.optionalKey(InputText),
    selection: Schema.optionalKey(Schema.Literals(["text", "cursor_before", "cursor_after"])),
  }),
  Schema.Struct({
    type: Schema.Literal("scroll"),
    target: ComputerUseActionTarget,
    deltaX: Schema.Finite.check(Schema.isBetween({ minimum: -10_000, maximum: 10_000 })),
    deltaY: Schema.Finite.check(Schema.isBetween({ minimum: -10_000, maximum: 10_000 })),
  }),
  Schema.Struct({
    type: Schema.Literal("setValue"),
    target: ComputerUseElementReference,
    value: InputText,
  }),
  Schema.Struct({
    type: Schema.Literal("performAction"),
    target: ComputerUseElementReference,
    action: ComputerUseAccessibilityAction,
  }),
]);
export type ComputerUseAction = typeof ComputerUseAction.Type;

// The helper must omit secure AX values and labels before constructing observations.
export const ComputerUseElement = Schema.Struct({
  elementId: ElementId,
  parentId: Schema.optionalKey(ElementId),
  role: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
  label: ShortText,
  value: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(1_024))),
  selectedTextRange: Schema.optionalKey(
    Schema.Struct({
      location: NonNegativeInt.check(Schema.isLessThanOrEqualTo(1_048_576)),
      length: NonNegativeInt.check(Schema.isLessThanOrEqualTo(1_048_576)),
    }).check(Schema.makeFilter((range) => range.location + range.length <= 1_048_576)),
  ),
  bounds: Schema.optionalKey(ComputerUseBounds),
  enabled: Schema.optionalKey(Schema.Boolean),
  actions: Schema.Array(ComputerUseAccessibilityAction).check(Schema.isMaxLength(8)),
});
export type ComputerUseElement = typeof ComputerUseElement.Type;

export const ComputerUseScreenshot = Schema.Struct({
  mimeType: Schema.Literals(["image/png", "image/jpeg"]),
  width: PositiveInt.check(Schema.isLessThanOrEqualTo(8_192)),
  height: PositiveInt.check(Schema.isLessThanOrEqualTo(8_192)),
  payload: Schema.Union([
    Schema.Struct({ kind: Schema.Literal("reference"), id: Id }),
    Schema.Struct({
      kind: Schema.Literal("data"),
      base64: Schema.String.check(Schema.isNonEmpty())
        .check(Schema.isMaxLength(4_000_000))
        .check(Schema.isPattern(/^[A-Za-z0-9+/]*={0,2}$/)),
    }),
  ]),
});
export type ComputerUseScreenshot = typeof ComputerUseScreenshot.Type;

export const ComputerUseObservation = Schema.Struct({
  sessionId: Id,
  snapshotId: Id,
  target: ComputerUseTarget,
  capturedAt: Timestamp,
  bounds: ComputerUseBounds,
  elements: Schema.Array(ComputerUseElement).check(Schema.isMaxLength(500)),
  truncated: Schema.Boolean,
  screenshot: Schema.optionalKey(ComputerUseScreenshot),
});
export type ComputerUseObservation = typeof ComputerUseObservation.Type;

export const ComputerUseAcknowledgement = Schema.Literals(["dispatched", "rejected", "cancelled"]);
export type ComputerUseAcknowledgement = typeof ComputerUseAcknowledgement.Type;
export const ComputerUseEffect = Schema.Literals([
  "unverified",
  "observed-change",
  "observed-no-change",
]);
export type ComputerUseEffect = typeof ComputerUseEffect.Type;

// Dispatch success is not evidence of target effect. Observe again to verify.
export const ComputerUseActionResult = Schema.Union([
  Schema.Struct({
    acknowledgement: ComputerUseAcknowledgement,
    effect: Schema.Literal("unverified"),
    message: Schema.optionalKey(ShortText),
  }),
  Schema.Struct({
    acknowledgement: Schema.Literal("dispatched"),
    effect: Schema.Literals(["observed-change", "observed-no-change"]),
    observation: ComputerUseObservation,
    message: Schema.optionalKey(ShortText),
  }),
]);
export type ComputerUseActionResult = typeof ComputerUseActionResult.Type;

export const ComputerUseHistorySettings = Schema.Struct({
  enabled: Schema.Boolean,
  paused: Schema.Boolean,
  interactionCaptureEnabled: Schema.optionalKey(Schema.Boolean),
  semanticSummariesEnabled: Schema.optionalKey(Schema.Boolean),
  retentionDays: PositiveInt.check(Schema.isLessThanOrEqualTo(365)),
  intervalSeconds: PositiveInt.check(Schema.isBetween({ minimum: 5, maximum: 3_600 })),
  includedBundleIds: Schema.optionalKey(Schema.Array(BundleId).check(Schema.isMaxLength(100))),
  includedDomains: Schema.optionalKey(
    Schema.Array(TrimmedNonEmptyString.check(Schema.isMaxLength(253))).check(
      Schema.isMaxLength(100),
    ),
  ),
  excludedBundleIds: Schema.Array(BundleId).check(Schema.isMaxLength(100)),
  excludedDomains: Schema.Array(TrimmedNonEmptyString.check(Schema.isMaxLength(253))).check(
    Schema.isMaxLength(100),
  ),
});
export type ComputerUseHistorySettings = typeof ComputerUseHistorySettings.Type;

// Host-only readback metadata must never become native capture policy or input.
export const ComputerUseHistoryState = Schema.Struct({
  ...ComputerUseHistorySettings.fields,
  pauseResumeAt: Schema.optionalKey(ComputerActivityTimestamp),
  pauseResumeError: Schema.optionalKey(Schema.Literal("resume-failed")),
})
  .check(Schema.makeFilter((state) => !state.pauseResumeAt || (state.enabled && state.paused)))
  .check(Schema.makeFilter((state) => !state.pauseResumeError || state.paused));
export type ComputerUseHistoryState = typeof ComputerUseHistoryState.Type;

// Deliberately excludes input text, values, key sequences, AX content and screenshots.
// Persist sanitized metadata only; passive summaries require a separate capture policy.
export const ComputerUseHistoryEvent = Schema.Struct({
  id: Id,
  source: Schema.Literals(["agent", "passive"]),
  type: Schema.Literals([
    "session-opened",
    "action",
    "session-closed",
    "stopped",
    "passive-observation",
  ]),
  at: Timestamp,
  sessionId: Schema.optionalKey(Id),
  target: ComputerUseTarget,
  actionType: Schema.optionalKey(ComputerUseActionType),
  acknowledgement: Schema.optionalKey(ComputerUseAcknowledgement),
  effect: Schema.optionalKey(ComputerUseEffect),
});
export type ComputerUseHistoryEvent = typeof ComputerUseHistoryEvent.Type;

export const ComputerUseHistoryPage = Schema.Struct({
  events: Schema.Array(ComputerUseHistoryEvent).check(Schema.isMaxLength(200)),
  nextCursor: Schema.optionalKey(Id),
});
export type ComputerUseHistoryPage = typeof ComputerUseHistoryPage.Type;

export const ComputerUseError = Schema.Struct({
  code: Schema.Literals([
    "unsupported",
    "permission-denied",
    "invalid-request",
    "unauthorized-session",
    "target-unavailable",
    "stale-snapshot",
    "element-unavailable",
    "clipboard-conflict",
    "clipboard-restore-failed",
    "cancelled",
    "timeout",
    "helper-unavailable",
    "internal",
  ]),
  message: ShortText,
});
export type ComputerUseError = typeof ComputerUseError.Type;

export const ComputerUseRequest = Schema.Union([
  Schema.Struct({ method: Schema.Literal("status") }),
  Schema.Struct({
    method: Schema.Literal("permissions.request"),
    permission: Schema.Literals(["accessibility", "screenRecording"]),
  }),
  Schema.Struct({ method: Schema.Literal("apps.list") }),
  Schema.Struct({ method: Schema.Literal("session.open"), target: ComputerUseTarget }),
  Schema.Struct({
    method: Schema.Literal("session.observe"),
    sessionId: Id,
    screenshot: Schema.optionalKey(Schema.Boolean),
    maxElements: Schema.optionalKey(PositiveInt.check(Schema.isLessThanOrEqualTo(500))),
  }),
  Schema.Struct({
    method: Schema.Literal("session.perform"),
    sessionId: Id,
    action: ComputerUseAction,
  }),
  Schema.Struct({ method: Schema.Literal("session.close"), sessionId: Id }),
  // No sessionId stops all work owned by the authenticated caller, not other threads.
  Schema.Struct({ method: Schema.Literal("stop"), sessionId: Schema.optionalKey(Id) }),
  Schema.Struct({
    method: Schema.Literal("history.list"),
    cursor: Schema.optionalKey(Id),
    limit: Schema.optionalKey(PositiveInt.check(Schema.isLessThanOrEqualTo(200))),
    source: Schema.optionalKey(Schema.Literals(["agent", "passive"])),
  }),
  Schema.Struct({ method: Schema.Literal("history.settings") }),
  Schema.Struct({
    method: Schema.Literal("history.pause"),
    action: Schema.Literals(["30m", "1h", "tomorrow09", "indefinite", "resume"]),
  }),
  Schema.Struct({
    method: Schema.Literal("history.clear"),
    source: Schema.optionalKey(Schema.Literals(["agent", "passive"])),
  }),
  Schema.Struct({
    method: Schema.Literal("history.configure"),
    settings: ComputerUseHistorySettings,
  }),
  Schema.Struct({
    method: Schema.Literal("activity.list"),
    ...ComputerActivityScope.fields,
    cursor: Schema.optionalKey(Id),
    limit: Schema.optionalKey(PositiveInt.check(Schema.isLessThanOrEqualTo(200))),
    semanticCursor: Schema.optionalKey(Id),
  }).check(
    Schema.makeFilter((scope) => !scope.since || !scope.until || scope.since <= scope.until),
  ),
  Schema.Struct({
    method: Schema.Literal("activity.clear"),
    ...ComputerActivityScope.fields,
  }).check(
    Schema.makeFilter((scope) => !scope.since || !scope.until || scope.since <= scope.until),
  ),
  // Only the host recorder sends this operation to the native helper. The
  // manager rejects it from both renderer and model request entry points.
  Schema.Struct({
    method: Schema.Literal("activity.capture"),
    settings: ComputerUseHistorySettings,
  }),
  Schema.Struct({
    method: Schema.Literal("activity.observe"),
    epoch: Id,
    settings: ComputerUseHistorySettings,
  }),
]);
export type ComputerUseRequest = typeof ComputerUseRequest.Type;

export const ComputerUseResponse = Schema.Union([
  Schema.Struct({ method: Schema.Literal("status"), result: ComputerUseStatus }),
  Schema.Struct({ method: Schema.Literal("permissions.request"), result: ComputerUseStatus }),
  Schema.Struct({
    method: Schema.Literal("apps.list"),
    result: Schema.Array(ComputerUseApp).check(Schema.isMaxLength(200)),
  }),
  Schema.Struct({ method: Schema.Literal("session.open"), result: ComputerUseSession }),
  Schema.Struct({ method: Schema.Literal("session.observe"), result: ComputerUseObservation }),
  Schema.Struct({ method: Schema.Literal("session.perform"), result: ComputerUseActionResult }),
  Schema.Struct({
    method: Schema.Literal("session.close"),
    result: Schema.Struct({ closed: Schema.Boolean }),
  }),
  Schema.Struct({
    method: Schema.Literal("stop"),
    result: Schema.Struct({ stoppedSessionIds: Schema.Array(Id).check(Schema.isMaxLength(100)) }),
  }),
  Schema.Struct({ method: Schema.Literal("history.list"), result: ComputerUseHistoryPage }),
  Schema.Struct({ method: Schema.Literal("history.pause"), result: ComputerUseHistoryState }),
  Schema.Struct({ method: Schema.Literal("history.settings"), result: ComputerUseHistoryState }),
  Schema.Struct({
    method: Schema.Literal("history.clear"),
    result: Schema.Struct({
      deletedCount: NonNegativeInt.check(Schema.isLessThanOrEqualTo(1_000_000_000)),
    }),
  }),
  Schema.Struct({
    method: Schema.Literal("history.configure"),
    result: ComputerUseHistoryState,
  }),
  Schema.Struct({
    method: Schema.Literal("activity.list"),
    result: Schema.suspend(() => ComputerActivityPage),
  }),
  Schema.Struct({
    method: Schema.Literal("activity.clear"),
    result: Schema.Struct({ deletedCount: NonNegativeInt }),
  }),
  Schema.Struct({
    method: Schema.Literal("activity.capture"),
    result: Schema.NullOr(Schema.suspend(() => ComputerActivitySnapshot)),
  }),
  Schema.Struct({
    method: Schema.Literal("activity.observe"),
    result: Schema.Struct({ epoch: Id, observing: Schema.Boolean }),
  }),
  Schema.Struct({
    method: ComputerUseRequest.mapMembers((members) =>
      members.map((member) => member.fields.method),
    ),
    error: ComputerUseError,
  }),
]);
export type ComputerUseResponse = typeof ComputerUseResponse.Type;

// Integrations must reject unknown fields rather than silently discarding caller scope
// or accepting ambiguous success/error and point/element payloads.
export const decodeComputerUseRequest = (input: unknown): ComputerUseRequest =>
  Schema.decodeUnknownSync(ComputerUseRequest)(input, { onExcessProperty: "error" });

export const decodeComputerUseResponse = (input: unknown): ComputerUseResponse =>
  Schema.decodeUnknownSync(ComputerUseResponse)(input, { onExcessProperty: "error" });
