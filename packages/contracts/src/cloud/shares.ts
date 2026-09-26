/**
 * Read-only share links. A share is a snapshot of one branch of a
 * conversation taken when the link is created; later messages are not shared.
 * Only a hash of the link token is stored, so the URL is returned once.
 */
import { Schema } from "effect";

import { TrimmedNonEmptyString } from "../baseSchemas";
import { CloudConversationId, CloudMessageId, CloudShareId } from "./base";
import { CloudMessagePart, CloudMessageRole } from "./chat";

export const CloudShare = Schema.Struct({
  id: CloudShareId,
  conversationId: CloudConversationId,
  title: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  revokedAt: Schema.NullOr(Schema.String),
});
export type CloudShare = typeof CloudShare.Type;

// POST /v1/shares
export const CloudCreateShareInput = Schema.Struct({
  conversationId: CloudConversationId,
  /** Last message of the branch to snapshot. */
  messageId: CloudMessageId,
});
export type CloudCreateShareInput = typeof CloudCreateShareInput.Type;

export const CloudCreateShareResponse = Schema.Struct({
  share: CloudShare,
  /** Public URL carrying the token. Shown once; it cannot be recovered later. */
  url: TrimmedNonEmptyString,
});
export type CloudCreateShareResponse = typeof CloudCreateShareResponse.Type;

// GET /v1/shares → list; DELETE /v1/shares/{id} → revoke
export const CloudShareListResponse = Schema.Struct({ shares: Schema.Array(CloudShare) });
export type CloudShareListResponse = typeof CloudShareListResponse.Type;

// GET /v1/public/shares/{token} (no auth)
export const CloudSharedMessage = Schema.Struct({
  role: CloudMessageRole,
  parts: Schema.Array(CloudMessagePart),
  createdAt: Schema.String,
});
export type CloudSharedMessage = typeof CloudSharedMessage.Type;

export const CloudPublicShareResponse = Schema.Struct({
  title: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  messages: Schema.Array(CloudSharedMessage),
});
export type CloudPublicShareResponse = typeof CloudPublicShareResponse.Type;
