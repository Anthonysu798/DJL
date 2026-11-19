import { Schema } from "effect";
import { NonNegativeInt, PositiveInt, TrimmedNonEmptyString } from "./baseSchemas";
import { ComputerUseTarget } from "./computerUse";

const Id = TrimmedNonEmptyString.check(Schema.isMaxLength(128));
const BundleId = Schema.suspend(() => ComputerUseTarget.fields.bundleId).check(
  Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
);
const Timestamp = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
).check(
  Schema.makeFilter((value) => {
    const at = Date.parse(value);
    return Number.isFinite(at) && new Date(at).toISOString() === value;
  }),
);
const Line = TrimmedNonEmptyString.check(Schema.isPattern(/^[^\r\n]+$/));
const Point = Schema.Struct({
  x: Schema.Finite.check(Schema.isBetween({ minimum: -100_000, maximum: 100_000 })),
  y: Schema.Finite.check(Schema.isBetween({ minimum: -100_000, maximum: 100_000 })),
});
const Applications = Schema.Array(BundleId).check(
  Schema.isMaxLength(100),
  Schema.makeFilter((values) => new Set(values).size === values.length),
);
const Modifiers = Schema.Array(Schema.Literals(["command", "control", "option", "shift"])).check(
  Schema.isMaxLength(4),
);

// Wider contextual evidence requires its own explicit capture consent. This is
// never the content-free computer-action audit or the label-only snapshot.
export const ComputerActivityEvent = Schema.Struct({
  id: Id,
  capturedAt: Timestamp,
  target: Schema.suspend(() => ComputerUseTarget),
  appName: Schema.String.check(Schema.isMaxLength(512)),
  windowTitle: Schema.String.check(Schema.isMaxLength(512)),
  domain: Schema.optionalKey(
    Line.check(Schema.isMaxLength(253), Schema.isPattern(/^(?:[a-z0-9-]+\.)*[a-z0-9-]+$/)),
  ),
  webContext: Schema.optionalKey(Schema.Boolean),
  kind: Schema.Literals([
    "session-start",
    "session-end",
    "app-changed",
    "window-changed",
    "click",
    "context-menu",
    "drag",
    "scroll",
    "text-input",
    "submit",
    "shortcut",
    "selection-changed",
    "accessibility",
  ]),
  text: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(4096))),
  keyEquivalent: Schema.optionalKey(Line.check(Schema.isMaxLength(64))),
  modifiers: Schema.optionalKey(Modifiers),
  mouse: Schema.optionalKey(
    Schema.Struct({
      button: Schema.optionalKey(Schema.Literals(["left", "right", "middle", "other"])),
      clickCount: Schema.optionalKey(PositiveInt.check(Schema.isLessThanOrEqualTo(16))),
      origin: Schema.optionalKey(Point),
      destination: Schema.optionalKey(Point),
      deltaX: Schema.optionalKey(
        Schema.Finite.check(Schema.isBetween({ minimum: -100_000, maximum: 100_000 })),
      ),
      deltaY: Schema.optionalKey(
        Schema.Finite.check(Schema.isBetween({ minimum: -100_000, maximum: 100_000 })),
      ),
    }),
  ),
  selection: Schema.optionalKey(
    Schema.Struct({
      text: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(4096))),
      location: Schema.optionalKey(NonNegativeInt.check(Schema.isLessThanOrEqualTo(1_000_000))),
      length: Schema.optionalKey(NonNegativeInt.check(Schema.isLessThanOrEqualTo(1_000_000))),
    }),
  ),
  ax: Schema.optionalKey(
    Schema.Struct({
      mode: Schema.Literals(["full", "diff"]),
      text: Schema.String.check(Schema.isMaxLength(16_384)),
    }),
  ),
});
export type ComputerActivityEvent = typeof ComputerActivityEvent.Type;

const ObservationFailure = Schema.Literals([
  "permission-denied",
  "secure-state-unavailable",
  "transport-unavailable",
  "capture-failed",
]);
const observationReasonMatchesState = (value: { state: string; reason?: string }) =>
  value.state === "unavailable" || value.reason === undefined;
export const ComputerActivityObservationStatus = Schema.Struct({
  state: Schema.Literals(["inactive", "starting", "observing", "unavailable"]),
  droppedRecords: NonNegativeInt.check(Schema.isLessThanOrEqualTo(1_000_000_000)),
  reason: Schema.optionalKey(ObservationFailure),
}).check(Schema.makeFilter(observationReasonMatchesState));
export type ComputerActivityObservationStatus = typeof ComputerActivityObservationStatus.Type;

// Private activity-pipe envelopes, separate from stdout input-control traffic.
export const ComputerActivityNativeEvent = Schema.Struct({
  event: Schema.Union([
    Schema.Struct({
      type: Schema.Literal("activity-record"),
      epoch: Id,
      record: ComputerActivityEvent,
    }),
    Schema.Struct({
      ...ComputerActivityObservationStatus.fields,
      type: Schema.Literal("activity-observer-status"),
      epoch: Id,
      state: Schema.Literals(["inactive", "observing", "unavailable"]),
    }).check(Schema.makeFilter(observationReasonMatchesState)),
  ]),
});
export type ComputerActivityNativeEvent = typeof ComputerActivityNativeEvent.Type;
export const decodeComputerActivityNativeEvent = (input: unknown): ComputerActivityNativeEvent =>
  Schema.decodeUnknownSync(ComputerActivityNativeEvent)(input, { onExcessProperty: "error" });

export const ComputerActivitySuggestion = Schema.Struct({
  type: Schema.Literals(["skill", "automation"]),
  name: Line.check(Schema.isMaxLength(120)),
  description: Line.check(Schema.isMaxLength(1024)),
});
export type ComputerActivitySuggestion = typeof ComputerActivitySuggestion.Type;

// The model supplies content only. Host-owned times, IDs and provenance are not
// accepted from a generated answer and are validated separately at commit.
export const ComputerActivitySemanticContent = Schema.Struct({
  title: Line.check(Schema.isMaxLength(160)),
  description: Line.check(Schema.isMaxLength(2048)),
  applications: Applications,
  memory: TrimmedNonEmptyString.check(Schema.isMaxLength(8192)),
  recording: TrimmedNonEmptyString.check(Schema.isMaxLength(8192)),
  citations: Schema.Array(Id).check(Schema.isMinLength(1), Schema.isMaxLength(512)),
  suggestion: Schema.optionalKey(ComputerActivitySuggestion),
});
export type ComputerActivitySemanticContent = typeof ComputerActivitySemanticContent.Type;

const Fingerprint = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));
const SourceIds = Schema.Array(Id).check(
  Schema.isMinLength(1),
  Schema.isMaxLength(512),
  Schema.makeFilter((values) => new Set(values).size === values.length),
);
const intervalMatches = (value: { startedAt: string; endedAt: string; periodSeconds: number }) =>
  Date.parse(value.endedAt) - Date.parse(value.startedAt) === value.periodSeconds * 1000;
const leaseAfterWindow = (value: { expiresAt: string; endedAt: string }) =>
  Date.parse(value.expiresAt) > Date.parse(value.endedAt);

export const ComputerActivitySemanticSummary = Schema.Struct({
  id: Id,
  periodSeconds: Schema.Literals([600, 21_600]),
  startedAt: Timestamp,
  endedAt: Timestamp,
  generatedAt: Timestamp,
  sourceIds: SourceIds,
  sourceFingerprint: Fingerprint,
  provider: Line.check(Schema.isMaxLength(64)),
  model: Line.check(Schema.isMaxLength(256)),
  content: ComputerActivitySemanticContent,
}).check(
  Schema.makeFilter(intervalMatches),
  Schema.makeFilter(
    (value) =>
      Date.parse(value.generatedAt) >= Date.parse(value.endedAt) &&
      value.content.citations.every((id) => value.sourceIds.includes(id)),
  ),
);
export type ComputerActivitySemanticSummary = typeof ComputerActivitySemanticSummary.Type;

const JobFields = {
  id: Id,
  leaseId: Id,
  generation: Id,
  expiresAt: Timestamp,
  startedAt: Timestamp,
  endedAt: Timestamp,
  sourceIds: SourceIds,
  applications: Applications,
  sourceFingerprint: Fingerprint,
  omittedRecordCount: NonNegativeInt.check(Schema.isLessThanOrEqualTo(100_000)),
};
export const ComputerActivitySummaryJob = Schema.Union([
  Schema.Struct({
    ...JobFields,
    periodSeconds: Schema.Literal(600),
    material: TrimmedNonEmptyString.check(Schema.isMaxLength(131_072)),
    previousSummaries: Schema.Array(ComputerActivitySemanticSummary).check(Schema.isMaxLength(12)),
  }).check(Schema.makeFilter(intervalMatches), Schema.makeFilter(leaseAfterWindow)),
  Schema.Struct({
    ...JobFields,
    periodSeconds: Schema.Literal(21_600),
    children: Schema.Array(
      ComputerActivitySemanticSummary.check(
        Schema.makeFilter((value) => value.periodSeconds === 600),
      ),
    ).check(Schema.isMinLength(1), Schema.isMaxLength(36)),
  }).check(
    Schema.makeFilter(intervalMatches),
    Schema.makeFilter(leaseAfterWindow),
    Schema.makeFilter((value) => {
      const childIds = new Set(value.children.map((child) => child.id));
      const applications = new Set(value.children.flatMap((child) => child.content.applications));
      return (
        childIds.size === value.children.length &&
        value.sourceIds.length === childIds.size &&
        value.sourceIds.every((id) => childIds.has(id)) &&
        value.applications.length === applications.size &&
        value.applications.every((id) => applications.has(id)) &&
        value.children.every(
          (child) => child.startedAt >= value.startedAt && child.endedAt <= value.endedAt,
        )
      );
    }),
  ),
]);
export type ComputerActivitySummaryJob = typeof ComputerActivitySummaryJob.Type;

const SummaryFailure = Schema.Literals([
  "provider-unavailable",
  "authentication",
  "invalid-output",
  "timeout",
  "generation-failed",
]);
export const ComputerActivitySummaryStatus = Schema.Struct({
  enabled: Schema.Boolean,
  pending: NonNegativeInt.check(Schema.isLessThanOrEqualTo(10_000)),
  running: Schema.Boolean,
  lastFailure: Schema.optionalKey(SummaryFailure),
});
export type ComputerActivitySummaryStatus = typeof ComputerActivitySummaryStatus.Type;

// Private authenticated host-worker protocol, deliberately absent from the
// renderer/agent ComputerUseRequest union and MCP tool registration.
export const ComputerActivitySummaryCommand = Schema.Union([
  Schema.Struct({ operation: Schema.Literal("claim") }),
  Schema.Struct({ operation: Schema.Literal("valid"), leaseId: Id }),
  Schema.Struct({
    operation: Schema.Literal("complete"),
    leaseId: Id,
    content: ComputerActivitySemanticContent,
    provider: Line.check(Schema.isMaxLength(64)),
    model: Line.check(Schema.isMaxLength(256)),
  }),
  Schema.Struct({ operation: Schema.Literal("fail"), leaseId: Id, code: SummaryFailure }),
]);
export type ComputerActivitySummaryCommand = typeof ComputerActivitySummaryCommand.Type;
export const decodeComputerActivitySummaryCommand = (
  input: unknown,
): ComputerActivitySummaryCommand =>
  Schema.decodeUnknownSync(ComputerActivitySummaryCommand)(input, { onExcessProperty: "error" });

export const decodeComputerActivityEvent = (input: unknown): ComputerActivityEvent =>
  Schema.decodeUnknownSync(ComputerActivityEvent)(input, { onExcessProperty: "error" });
export const decodeComputerActivitySemanticContent = (
  input: unknown,
): ComputerActivitySemanticContent =>
  Schema.decodeUnknownSync(ComputerActivitySemanticContent)(input, { onExcessProperty: "error" });
export const decodeComputerActivitySemanticSummary = (
  input: unknown,
): ComputerActivitySemanticSummary =>
  Schema.decodeUnknownSync(ComputerActivitySemanticSummary)(input, { onExcessProperty: "error" });
export const decodeComputerActivitySummaryJob = (input: unknown): ComputerActivitySummaryJob =>
  Schema.decodeUnknownSync(ComputerActivitySummaryJob)(input, { onExcessProperty: "error" });
