import { Schema } from "effect";
import { CloudConversationId, CloudFileId, CloudMessageId } from "./base";
import { TrimmedNonEmptyString } from "../baseSchemas";

export const CloudCreateImageInput = Schema.Struct({
  clientMessageId: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
  prompt: TrimmedNonEmptyString.check(Schema.isMaxLength(4000)),
  aspectRatio: Schema.Literals(["1:1", "4:3", "3:4"]),
});
export type CloudCreateImageInput = typeof CloudCreateImageInput.Type;
export const CloudGalleryImage = Schema.Struct({
  fileId: CloudFileId,
  conversationId: CloudConversationId,
  messageId: CloudMessageId,
  prompt: Schema.String,
  mimeType: Schema.String,
  size: Schema.Number,
  width: Schema.NullOr(Schema.Number),
  height: Schema.NullOr(Schema.Number),
  createdAt: Schema.String,
});
export const CloudImagesResponse = Schema.Struct({
  images: Schema.Array(CloudGalleryImage),
  nextCursor: Schema.NullOr(TrimmedNonEmptyString),
});
export const CloudImagesQuery = Schema.Struct({
  cursor: Schema.optionalKey(TrimmedNonEmptyString),
});
