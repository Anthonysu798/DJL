import { Schema } from "effect";
import { PositiveInt, TrimmedNonEmptyString } from "./baseSchemas";
import { ComputerUseTarget } from "./computerUse";
import {
  ComputerActivityEvent,
  ComputerActivitySemanticSummary,
  ComputerActivitySummaryStatus,
  ComputerActivityObservationStatus,
} from "./computerActivitySemantics";
import { ComputerActivityTimestamp as Timestamp } from "./computerActivityScope";
export { ComputerActivityScope, decodeComputerActivityScope } from "./computerActivityScope";

const Id = TrimmedNonEmptyString.check(Schema.isMaxLength(128));
const Text = Schema.String.check(Schema.isMaxLength(512));
const Domain = Schema.String.check(Schema.isMaxLength(253)).check(
  Schema.isPattern(
    /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/,
  ),
);

// Static visible labels only: no editable values, key events, clipboard or image data.
export const ComputerActivitySnapshot = Schema.Struct({
  id: Id,
  capturedAt: Timestamp,
  target: Schema.suspend(() => ComputerUseTarget),
  appName: Text,
  windowTitle: Text,
  domain: Schema.optionalKey(Domain),
  webContext: Schema.optionalKey(Schema.Boolean),
  labels: Schema.Array(Schema.String.check(Schema.isMaxLength(256))).check(Schema.isMaxLength(32)),
});
export type ComputerActivitySnapshot = typeof ComputerActivitySnapshot.Type;

// Counts describe recorded observations, never elapsed activity or inferred intent.
export const ComputerActivitySummary = Schema.Struct({
  id: Id,
  periodSeconds: Schema.Literals([600, 21_600]),
  startedAt: Timestamp,
  endedAt: Timestamp,
  snapshotCount: PositiveInt.check(Schema.isLessThanOrEqualTo(5_000)),
  contexts: Schema.Array(
    Schema.Struct({
      bundleId: Schema.suspend(() => ComputerUseTarget.fields.bundleId),
      appName: Text,
      windowTitle: Text,
      count: PositiveInt.check(Schema.isLessThanOrEqualTo(5_000)),
    }),
  ).check(Schema.isMaxLength(200)),
});
export type ComputerActivitySummary = typeof ComputerActivitySummary.Type;

export const ComputerActivityPage = Schema.Struct({
  snapshots: Schema.Array(ComputerActivitySnapshot).check(Schema.isMaxLength(200)),
  summaries: Schema.Array(ComputerActivitySummary).check(Schema.isMaxLength(200)),
  nextCursor: Schema.optionalKey(Id),
  events: Schema.optionalKey(
    Schema.Array(Schema.suspend(() => ComputerActivityEvent)).check(Schema.isMaxLength(200)),
  ),
  semanticSummaries: Schema.optionalKey(
    Schema.Array(Schema.suspend(() => ComputerActivitySemanticSummary)).check(
      Schema.isMaxLength(200),
    ),
  ),
  semanticStatus: Schema.optionalKey(Schema.suspend(() => ComputerActivitySummaryStatus)),
  nextSemanticCursor: Schema.optionalKey(Id),
  countsTruncated: Schema.optionalKey(Schema.Literal(true)),
  interactionStatus: Schema.optionalKey(Schema.suspend(() => ComputerActivityObservationStatus)),
});
export type ComputerActivityPage = typeof ComputerActivityPage.Type;

export const decodeComputerActivitySnapshot = (input: unknown): ComputerActivitySnapshot =>
  Schema.decodeUnknownSync(ComputerActivitySnapshot)(input, { onExcessProperty: "error" });
export const decodeComputerActivitySummary = (input: unknown): ComputerActivitySummary =>
  Schema.decodeUnknownSync(ComputerActivitySummary)(input, { onExcessProperty: "error" });
export const decodeComputerActivityPage = (input: unknown): ComputerActivityPage =>
  Schema.decodeUnknownSync(ComputerActivityPage)(input, { onExcessProperty: "error" });
