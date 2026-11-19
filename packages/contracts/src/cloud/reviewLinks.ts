import { Schema } from "effect";

export const CloudSocialReviewLinkInput = Schema.Struct({
  revision: Schema.Int,
  expiresInHours: Schema.Literals([24, 72, 168]),
  disclosureAccepted: Schema.Boolean,
});
export type CloudSocialReviewLinkInput = typeof CloudSocialReviewLinkInput.Type;
export const CloudSocialReviewFeedbackInput = Schema.Struct({
  reviewerName: Schema.String,
  comment: Schema.String,
  decision: Schema.Literals(["comment", "approved", "changes_requested"]),
});
export type CloudSocialReviewFeedbackInput = typeof CloudSocialReviewFeedbackInput.Type;
export const CloudSocialReviewFeedback = Schema.Struct({
  id: Schema.String,
  reviewerName: Schema.String,
  identityVerified: Schema.Literal(false),
  comment: Schema.String,
  decision: CloudSocialReviewFeedbackInput.fields.decision,
  createdAt: Schema.String,
});
export type CloudSocialReviewFeedback = typeof CloudSocialReviewFeedback.Type;
export const CloudSocialReviewLink = Schema.Struct({
  id: Schema.String,
  draftId: Schema.String,
  revision: Schema.Int,
  createdAt: Schema.String,
  expiresAt: Schema.String,
  revokedAt: Schema.NullOr(Schema.String),
  isCurrent: Schema.Boolean,
  feedback: Schema.Array(CloudSocialReviewFeedback),
});
export type CloudSocialReviewLink = typeof CloudSocialReviewLink.Type;
export const CloudSocialReviewLinkCreated = Schema.Struct({
  link: CloudSocialReviewLink,
  token: Schema.String,
  reviewPath: Schema.String,
  reviewUrl: Schema.optional(Schema.String),
});
export type CloudSocialReviewLinkCreated = typeof CloudSocialReviewLinkCreated.Type;
export const CloudSocialPublicReview = Schema.Struct({
  revision: Schema.Int,
  isCurrent: Schema.Boolean,
  expiresAt: Schema.String,
  caption: Schema.String,
  targets: Schema.Array(Schema.Struct({ provider: Schema.String, caption: Schema.String })),
  media: Schema.Array(Schema.Struct({ index: Schema.Int, mimeType: Schema.String })),
  publicationMode: Schema.Literals(["now", "scheduled"]),
  scheduledAt: Schema.String,
  timezone: Schema.String,
});
export type CloudSocialPublicReview = typeof CloudSocialPublicReview.Type;
