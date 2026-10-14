import { Schema } from "effect";
import { CloudConversationId, CloudRunId } from "./base";
import { NonNegativeInt, TrimmedNonEmptyString } from "../baseSchemas";

export const CloudNotification = Schema.Struct({
  id: CloudRunId,
  conversationId: CloudConversationId,
  conversationTitle: Schema.NullOr(Schema.String),
  status: Schema.Literals(["succeeded", "failed"]),
  finishedAt: Schema.String,
  readAt: Schema.NullOr(Schema.String),
});
export const CloudNotificationsResponse = Schema.Struct({
  notifications: Schema.Array(CloudNotification),
  nextCursor: Schema.NullOr(TrimmedNonEmptyString),
  unreadCount: NonNegativeInt,
});
export const CloudNotificationsQuery = Schema.Struct({
  cursor: Schema.optionalKey(TrimmedNonEmptyString),
});
export const CloudReadNotificationsInput = Schema.Struct({
  ids: Schema.Array(
    Schema.String.check(
      Schema.isPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
    ),
  ).check(Schema.isMinLength(1), Schema.isMaxLength(30)),
});
export type CloudNotification = typeof CloudNotification.Type;
export type CloudNotificationsResponse = typeof CloudNotificationsResponse.Type;
