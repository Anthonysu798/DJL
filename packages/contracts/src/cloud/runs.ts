/**
 * Runs: every assistant turn, chat or background task, is a run. Its progress
 * is an ordered event log; `seq` starts at 1 and increases by one per event,
 * so any device can resume with GET /v1/runs/{id}/events?after=<last seq>.
 *
 * With `Accept: text/event-stream` the same endpoint streams SSE:
 * - first `retry: 3000`;
 * - one message per event: `id: <seq>`, `event: <type>`, `data: <CloudRunEvent JSON>`;
 * - a `: heartbeat` comment every CLOUD_RUN_STREAM_HEARTBEAT_SECONDS while the run is quiet;
 * - the stream closes after the terminal `status` event (at once for a finished run).
 * Resume with `after=<seq>`; without it, a `Last-Event-ID` header is honored.
 * Closing the stream never stops the run.
 */
import { Schema } from "effect";

import { NonNegativeInt, PositiveInt, TrimmedNonEmptyString } from "../baseSchemas";
import { CloudConversationId, CloudMessageId, CloudRunId } from "./base";
import { CloudMessage, CloudMessagePart, CloudRunMode } from "./chat";
import { CloudUsageTrailer } from "./usage";

export const CloudRunStatus = Schema.Literals([
  "queued",
  "running",
  /** Out of credits or over a usage window; resumes after a top-up or reset. */
  "blocked_on_usage",
  "succeeded",
  "failed",
  "cancelled",
]);
export type CloudRunStatus = typeof CloudRunStatus.Type;

export const CloudRunError = Schema.Struct({ code: TrimmedNonEmptyString, message: Schema.String });
export type CloudRunError = typeof CloudRunError.Type;

export const CLOUD_RUN_STREAM_HEARTBEAT_SECONDS = 15;

export const CloudRun = Schema.Struct({
  id: CloudRunId,
  conversationId: CloudConversationId,
  /** The assistant message this run writes into. */
  messageId: CloudMessageId,
  mode: CloudRunMode,
  status: CloudRunStatus,
  model: TrimmedNonEmptyString,
  error: Schema.NullOr(CloudRunError),
  /** Highest event seq written so far; 0 before the first event. */
  lastSeq: NonNegativeInt,
  createdAt: Schema.String,
  finishedAt: Schema.NullOr(Schema.String),
});
export type CloudRun = typeof CloudRun.Type;

const event = <Type extends string, Payload extends Schema.Top>(type: Type, payload: Payload) =>
  Schema.Struct({
    runId: CloudRunId,
    seq: PositiveInt,
    type: Schema.Literal(type),
    payload,
    createdAt: Schema.String,
  });

/** Text appended to the run's assistant message. */
export const CloudRunTextDeltaEvent = event(
  "text.delta",
  Schema.Struct({ messageId: CloudMessageId, text: Schema.String }),
);
/** A finished non-text part (tool call, tool result, image) appended to the message. */
export const CloudRunPartEvent = event(
  "message.part",
  Schema.Struct({ messageId: CloudMessageId, part: CloudMessagePart }),
);
/** A task step started (one model call plus its tool calls). */
export const CloudRunStepEvent = event(
  "step.started",
  Schema.Struct({ step: PositiveInt, maxSteps: PositiveInt }),
);
/** Settled cost of one model call, the same trailer the gateway streams. */
export const CloudRunUsageEvent = event("usage", CloudUsageTrailer);
/** Status change; terminal statuses end the log. */
export const CloudRunStatusEvent = event(
  "status",
  Schema.Struct({ status: CloudRunStatus, error: Schema.NullOr(CloudRunError) }),
);

export const CloudRunEvent = Schema.Union([
  CloudRunTextDeltaEvent,
  CloudRunPartEvent,
  CloudRunStepEvent,
  CloudRunUsageEvent,
  CloudRunStatusEvent,
]);
export type CloudRunEvent = typeof CloudRunEvent.Type;
export type CloudRunEventType = CloudRunEvent["type"];

// POST /v1/conversations/{id}/messages
export const CloudSendMessageResponse = Schema.Struct({
  message: CloudMessage,
  /** Assistant message the run is writing into, created empty. */
  reply: CloudMessage,
  run: CloudRun,
});
export type CloudSendMessageResponse = typeof CloudSendMessageResponse.Type;

// POST /v1/conversations/{id}/messages/{messageId}/regenerate: `message` is the
// user message being answered again, `reply` the new sibling reply.
export const CloudRegenerateResponse = CloudSendMessageResponse;
export type CloudRegenerateResponse = typeof CloudRegenerateResponse.Type;

// GET /v1/runs/{id}
export const CloudRunResponse = Schema.Struct({ run: CloudRun });
export type CloudRunResponse = typeof CloudRunResponse.Type;

// GET /v1/runs/{id}/events?after=<seq> (JSON when not requested as text/event-stream)
export const CloudRunEventsQuery = Schema.Struct({
  after: Schema.optionalKey(
    Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  ),
});
export type CloudRunEventsQuery = typeof CloudRunEventsQuery.Type;

export const CloudRunEventsResponse = Schema.Struct({
  run: CloudRun,
  events: Schema.Array(CloudRunEvent),
});
export type CloudRunEventsResponse = typeof CloudRunEventsResponse.Type;

// POST /v1/runs/{id}/cancel → CloudRunResponse (idempotent; cancelling a finished run is a no-op)
