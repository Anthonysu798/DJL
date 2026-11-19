import { Schema } from "effect";

export const CloudSocialReportScheduleInput = Schema.Struct({
  enabled: Schema.Boolean,
  timezone: Schema.String,
  /** Sunday=0. The first valid local minute at/after the chosen time is used during a DST gap. */
  weekday: Schema.Int,
  hour: Schema.Int,
  minute: Schema.Int,
});
export type CloudSocialReportScheduleInput = typeof CloudSocialReportScheduleInput.Type;
export const CloudSocialReportSchedule = Schema.Struct({
  ...CloudSocialReportScheduleInput.fields,
  id: Schema.NullOr(Schema.String),
  draftId: Schema.String,
  threadId: Schema.String,
  nextRunAt: Schema.NullOr(Schema.String),
});
export type CloudSocialReportSchedule = typeof CloudSocialReportSchedule.Type;
const Metrics = Schema.Struct({
  views: Schema.NullOr(Schema.Number),
  likes: Schema.NullOr(Schema.Number),
  comments: Schema.NullOr(Schema.Number),
  shares: Schema.NullOr(Schema.Number),
});
const Provider = Schema.Literals(["instagram", "tiktok", "unknown"]);
export const CloudSocialWeeklyReport = Schema.Struct({
  id: Schema.String,
  threadId: Schema.String,
  periodStart: Schema.String,
  periodEnd: Schema.String,
  retrievedAt: Schema.String,
  publishedPosts: Schema.Int,
  inspectedPosts: Schema.Int,
  truncated: Schema.Boolean,
  partial: Schema.Boolean,
  providers: Schema.Array(
    Schema.Struct({
      provider: Provider,
      publishedPosts: Schema.Int,
      /** A total is null if any post in this provider's period lacks that metric. */
      metrics: Metrics,
    }),
  ),
  posts: Schema.Array(
    Schema.Struct({
      taskId: Schema.String,
      provider: Provider,
      postUrl: Schema.NullOr(Schema.String),
      /** Time DJL recorded the published state, not a claimed provider publication timestamp. */
      recordedAt: Schema.String,
      retrievedAt: Schema.String,
      metrics: Metrics,
    }),
  ),
});
export type CloudSocialWeeklyReport = typeof CloudSocialWeeklyReport.Type;
export const CloudSocialReportsResponse = Schema.Struct({
  schedule: CloudSocialReportSchedule,
  reports: Schema.Array(CloudSocialWeeklyReport),
});
export type CloudSocialReportsResponse = typeof CloudSocialReportsResponse.Type;
