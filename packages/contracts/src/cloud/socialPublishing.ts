import { Schema } from "effect";
export const CloudSocialDraftInput = Schema.Struct({
  threadId: Schema.String,
  caption: Schema.String,
  captions: Schema.Record(Schema.String, Schema.String),
  tiktokOptions: Schema.optional(
    Schema.Struct({
      privacyLevel: Schema.String,
      disableDuet: Schema.Boolean,
      disableStitch: Schema.Boolean,
      disableComment: Schema.Boolean,
      brandContent: Schema.Boolean,
      brandOrganic: Schema.Boolean,
      isAigc: Schema.Boolean,
      musicUsageConfirmed: Schema.Boolean,
    }),
  ),
  mediaFileIds: Schema.Array(Schema.String),
  accountIds: Schema.Array(Schema.String),
  scheduledAt: Schema.String,
  timezone: Schema.String,
});
export type CloudSocialDraftInput = typeof CloudSocialDraftInput.Type;
export const CloudSocialDraftEdit = Schema.Struct({
  ...CloudSocialDraftInput.fields,
  revision: Schema.Number,
});
export const CloudSocialRevisionInput = Schema.Struct({ revision: Schema.Number });
export const CloudSocialTaskAction = Schema.Struct({
  revision: Schema.Number,
  action: Schema.Literals(["cancel", "retry"]),
});
export const CloudSocialPublishTask = Schema.Struct({
  id: Schema.String,
  draftId: Schema.String,
  orgId: Schema.String,
  userId: Schema.String,
  revision: Schema.Number,
  accountId: Schema.String,
  state: Schema.Literals([
    "queued",
    "publishing",
    "reconciling",
    "published",
    "failed",
    "uncertain",
    "cancelled",
  ]),
  dueAt: Schema.String,
  postId: Schema.NullOr(Schema.String),
  errorCode: Schema.NullOr(Schema.String),
  publishStartedAt: Schema.NullOr(Schema.String),
  updatedAt: Schema.String,
});
export type CloudSocialPublishTask = typeof CloudSocialPublishTask.Type;
export const CloudSocialDraft = Schema.Struct({
  id: Schema.String,
  orgId: Schema.String,
  userId: Schema.String,
  threadId: Schema.String,
  revision: Schema.Number,
  content: Schema.Struct({
    caption: Schema.String,
    captions: Schema.Record(Schema.String, Schema.String),
    mediaFileIds: Schema.Array(Schema.String),
    accountIds: Schema.Array(Schema.String),
    scheduledAt: Schema.String,
    timezone: Schema.String,
    tiktokOptions: CloudSocialDraftInput.fields.tiktokOptions,
  }),
  confirmedAt: Schema.NullOr(Schema.String),
  updatedAt: Schema.String,
  tasks: Schema.Array(CloudSocialPublishTask),
});
export type CloudSocialDraft = typeof CloudSocialDraft.Type;
export const CloudSocialMetricsResponse = Schema.Struct({
  postUrl: Schema.NullOr(Schema.String),
  metrics: Schema.Struct({
    views: Schema.NullOr(Schema.Number),
    likes: Schema.NullOr(Schema.Number),
    comments: Schema.NullOr(Schema.Number),
    shares: Schema.NullOr(Schema.Number),
  }),
});
export type CloudSocialMetricsResponse = typeof CloudSocialMetricsResponse.Type;
