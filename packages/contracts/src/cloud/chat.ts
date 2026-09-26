/**
 * Cloud chat history: conversations and their message trees.
 *
 * Messages form a tree through `parentId`, so editing a user message or
 * regenerating a reply adds a sibling instead of rewriting history. Clients
 * render one branch by following the newest child unless the user picks another.
 */
import { Schema } from "effect";

import { TrimmedNonEmptyString } from "../baseSchemas";
import { CloudConversationId, CloudFileId, CloudMessageId, CloudRunId } from "./base";

export const CloudMessageRole = Schema.Literals(["user", "assistant"]);
export type CloudMessageRole = typeof CloudMessageRole.Type;

export const CloudTextPart = Schema.Struct({ type: Schema.Literal("text"), text: Schema.String });
export type CloudTextPart = typeof CloudTextPart.Type;

/** An uploaded document; the bytes are fetched through GET /v1/files/{id}/download. */
export const CloudFileRefPart = Schema.Struct({
  type: Schema.Literal("file_ref"),
  fileId: CloudFileId,
  name: TrimmedNonEmptyString,
  mimeType: TrimmedNonEmptyString,
  size: Schema.Int,
});
export type CloudFileRefPart = typeof CloudFileRefPart.Type;

/** An uploaded or generated image, stored as a file. Never inline base64. */
export const CloudImageRefPart = Schema.Struct({
  type: Schema.Literal("image_ref"),
  fileId: CloudFileId,
  mimeType: TrimmedNonEmptyString,
  width: Schema.NullOr(Schema.Int),
  height: Schema.NullOr(Schema.Int),
});
export type CloudImageRefPart = typeof CloudImageRefPart.Type;

export const CloudToolCallPart = Schema.Struct({
  type: Schema.Literal("tool_call"),
  toolCallId: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  /** JSON-encoded arguments exactly as the model produced them. */
  arguments: Schema.String,
});
export type CloudToolCallPart = typeof CloudToolCallPart.Type;

export const CloudToolResultPart = Schema.Struct({
  type: Schema.Literal("tool_result"),
  toolCallId: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  /** Short human-readable summary; large outputs are saved as files and referenced. */
  content: Schema.String,
  isError: Schema.Boolean,
});
export type CloudToolResultPart = typeof CloudToolResultPart.Type;

export const CloudMessagePart = Schema.Union([
  CloudTextPart,
  CloudFileRefPart,
  CloudImageRefPart,
  CloudToolCallPart,
  CloudToolResultPart,
]);
export type CloudMessagePart = typeof CloudMessagePart.Type;

/** Parts a user may send. Tool parts are only ever produced by the server. */
export const CloudUserMessagePart = Schema.Union([
  CloudTextPart,
  CloudFileRefPart,
  CloudImageRefPart,
]);
export type CloudUserMessagePart = typeof CloudUserMessagePart.Type;

export const CloudMessage = Schema.Struct({
  id: CloudMessageId,
  conversationId: CloudConversationId,
  parentId: Schema.NullOr(CloudMessageId),
  role: CloudMessageRole,
  parts: Schema.Array(CloudMessagePart),
  /** Model that produced an assistant message; null for user messages. */
  model: Schema.NullOr(TrimmedNonEmptyString),
  /** The run that produced an assistant message; null for user messages. */
  runId: Schema.NullOr(CloudRunId),
  createdAt: Schema.String,
});
export type CloudMessage = typeof CloudMessage.Type;

export const CloudConversation = Schema.Struct({
  id: CloudConversationId,
  title: Schema.NullOr(Schema.String),
  pinned: Schema.Boolean,
  archived: Schema.Boolean,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type CloudConversation = typeof CloudConversation.Type;

// ---------------------------------------------------------------------------
// GET/POST /v1/conversations, GET/PATCH/DELETE /v1/conversations/{id}
// ---------------------------------------------------------------------------

export const CloudConversationListResponse = Schema.Struct({
  conversations: Schema.Array(CloudConversation),
  nextCursor: Schema.NullOr(TrimmedNonEmptyString),
});
export type CloudConversationListResponse = typeof CloudConversationListResponse.Type;

export const CloudCreateConversationInput = Schema.Struct({
  title: Schema.optionalKey(TrimmedNonEmptyString.check(Schema.isMaxLength(200))),
});
export type CloudCreateConversationInput = typeof CloudCreateConversationInput.Type;

export const CloudUpdateConversationInput = Schema.Struct({
  title: Schema.optionalKey(TrimmedNonEmptyString.check(Schema.isMaxLength(200))),
  pinned: Schema.optionalKey(Schema.Boolean),
  archived: Schema.optionalKey(Schema.Boolean),
});
export type CloudUpdateConversationInput = typeof CloudUpdateConversationInput.Type;

/** The whole tree; clients choose the branch to show. */
export const CloudConversationDetailResponse = Schema.Struct({
  conversation: CloudConversation,
  messages: Schema.Array(CloudMessage),
});
export type CloudConversationDetailResponse = typeof CloudConversationDetailResponse.Type;

// ---------------------------------------------------------------------------
// GET /v1/conversations/search?q=
// ---------------------------------------------------------------------------

export const CloudConversationSearchQuery = Schema.Struct({
  q: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
  cursor: Schema.optionalKey(TrimmedNonEmptyString),
});
export type CloudConversationSearchQuery = typeof CloudConversationSearchQuery.Type;

export const CloudConversationSearchHit = Schema.Struct({
  conversation: CloudConversation,
  /** The best-matching message, or null when only the title matched. */
  messageId: Schema.NullOr(CloudMessageId),
  /** Plain text around the match; clients highlight it themselves. */
  snippet: Schema.String,
});
export type CloudConversationSearchHit = typeof CloudConversationSearchHit.Type;

export const CloudConversationSearchResponse = Schema.Struct({
  results: Schema.Array(CloudConversationSearchHit),
  nextCursor: Schema.NullOr(TrimmedNonEmptyString),
});
export type CloudConversationSearchResponse = typeof CloudConversationSearchResponse.Type;

// ---------------------------------------------------------------------------
// POST /v1/conversations/{id}/messages (the reply is a run, see runs.ts)
// POST /v1/conversations/{id}/messages/{messageId}/regenerate
// ---------------------------------------------------------------------------

export const CloudRunMode = Schema.Literals(["chat", "task"]);
export type CloudRunMode = typeof CloudRunMode.Type;

export const CloudSendMessageInput = Schema.Struct({
  /** Client-generated; resending the same id returns the original message and run. */
  clientMessageId: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
  /** The message this one replies to; null starts the conversation. Editing = a new sibling. */
  parentId: Schema.NullOr(CloudMessageId),
  parts: Schema.Array(CloudUserMessagePart).check(Schema.isMinLength(1), Schema.isMaxLength(20)),
  model: TrimmedNonEmptyString,
  mode: CloudRunMode,
});
export type CloudSendMessageInput = typeof CloudSendMessageInput.Type;

export const CloudRegenerateInput = Schema.Struct({
  model: Schema.optionalKey(TrimmedNonEmptyString),
});
export type CloudRegenerateInput = typeof CloudRegenerateInput.Type;
