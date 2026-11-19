import { Schema } from "effect";
import { TrimmedNonEmptyString } from "./baseSchemas";

export const ComputerActivityTimestamp = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
).check(
  Schema.makeFilter(
    (value) =>
      Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value,
  ),
);

export const ComputerActivityScope = Schema.Struct({
  since: Schema.optionalKey(ComputerActivityTimestamp),
  until: Schema.optionalKey(ComputerActivityTimestamp),
  bundleId: Schema.optionalKey(TrimmedNonEmptyString.check(Schema.isMaxLength(256))),
}).check(Schema.makeFilter((scope) => !scope.since || !scope.until || scope.since <= scope.until));
export type ComputerActivityScope = typeof ComputerActivityScope.Type;
export const decodeComputerActivityScope = (input: unknown): ComputerActivityScope =>
  Schema.decodeUnknownSync(ComputerActivityScope)(input, { onExcessProperty: "error" });
