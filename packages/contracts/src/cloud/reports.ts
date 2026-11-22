/**
 * Reporting an offensive, harmful, or wrong AI answer from inside an app.
 * A "cloud" report names a DJL Cloud assistant message; the server snapshots
 * it so moderators can review it after deletion. A "desktop" report carries
 * the answer text from the user's own paired Mac, which DJL Cloud never saw.
 */
import { Schema } from "effect";

import { TrimmedNonEmptyString, TrimmedString } from "../baseSchemas";
import { CloudConversationId, CloudMessageId } from "./base";

export const CloudContentReportSource = Schema.Literals(["cloud", "desktop"]);
export type CloudContentReportSource = typeof CloudContentReportSource.Type;

export const CloudContentReportReason = Schema.Literals(["offensive", "harmful", "wrong", "other"]);
export type CloudContentReportReason = typeof CloudContentReportReason.Type;

/**
 * POST /v1/reports. Sign-in is optional, but "cloud" reports require it; an
 * invalid credential is a 401. Fields that do not fit the source are a 400.
 * Rate limited per user (else per IP): 10 per minute, 50 per day.
 */
export const CloudCreateContentReportInput = Schema.Struct({
  source: CloudContentReportSource,
  reason: CloudContentReportReason,
  note: Schema.optionalKey(TrimmedString.check(Schema.isMaxLength(1000))),
  /** source "cloud" only. */
  conversationId: Schema.optionalKey(CloudConversationId),
  /** source "cloud" only: an assistant message in that conversation. */
  messageId: Schema.optionalKey(CloudMessageId),
  /** source "desktop" only: the reported answer text. */
  text: Schema.optionalKey(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(20_000))),
  /** source "desktop" only: the agent's display name. */
  agent: Schema.optionalKey(TrimmedString.check(Schema.isMaxLength(80))),
});
export type CloudCreateContentReportInput = typeof CloudCreateContentReportInput.Type;

/** 201 for a new report; 200 with the existing one when this user already reported that message. */
export const CloudCreateContentReportResponse = Schema.Struct({
  report: Schema.Struct({ id: TrimmedNonEmptyString, createdAt: Schema.String }),
});
export type CloudCreateContentReportResponse = typeof CloudCreateContentReportResponse.Type;
