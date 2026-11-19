import { Schema } from "effect";

export const CloudSocialTrackingLinkInput = Schema.Struct({
  url: Schema.String,
  campaignId: Schema.String,
  threadId: Schema.String,
  contentRevision: Schema.Int,
  expiresInDays: Schema.Literals([7, 30, 90]),
  disclosureAccepted: Schema.Boolean,
});
export type CloudSocialTrackingLinkInput = typeof CloudSocialTrackingLinkInput.Type;
export const CloudSocialTrackingLink = Schema.Struct({
  id: Schema.String,
  publicPath: Schema.String,
  trackingUrl: Schema.optional(Schema.String),
  targetUrl: Schema.String,
  campaignId: Schema.String,
  threadId: Schema.String,
  contentRevision: Schema.Int,
  createdAt: Schema.String,
  expiresAt: Schema.String,
  revokedAt: Schema.NullOr(Schema.String),
  linkOpens: Schema.Int,
  daily: Schema.Array(Schema.Struct({ day: Schema.String, linkOpens: Schema.Int })),
  measurement: Schema.Literal("link_opens"),
  notice: Schema.String,
});
export type CloudSocialTrackingLink = typeof CloudSocialTrackingLink.Type;
export const CloudSocialTrackingLinkCreated = Schema.Struct({
  link: CloudSocialTrackingLink,
  publicPath: Schema.String,
  trackingUrl: Schema.optional(Schema.String),
});
export type CloudSocialTrackingLinkCreated = typeof CloudSocialTrackingLinkCreated.Type;
