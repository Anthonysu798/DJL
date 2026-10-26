import { Schema } from "effect";

const UUID = Schema.String.check(Schema.isPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i));
const Timestamp = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/));
export const AnalyticsPlatform = Schema.Literals(["desktop", "ios", "web"]);
export type AnalyticsPlatform = typeof AnalyticsPlatform.Type;
export const AnalyticsChannel = Schema.Literals(["stable", "beta", "development", "test"]);
export type AnalyticsChannel = typeof AnalyticsChannel.Type;
export const AnalyticsFeature = Schema.Literals(["cloud_chat", "local_task", "remote_control", "voice", "images"]);
export type AnalyticsFeature = typeof AnalyticsFeature.Type;

const fields = { eventId: UUID, sessionId: UUID, occurredAt: Timestamp };
export const AnalyticsEvent = Schema.Union([
  Schema.Struct({ ...fields, kind: Schema.Literals(["first_open", "foreground", "session_end"]) }),
  Schema.Struct({ ...fields, kind: Schema.Literals(["feature_used"]), feature: AnalyticsFeature }),
]);
export type AnalyticsEvent = typeof AnalyticsEvent.Type;
export const AnalyticsBatch = Schema.Struct({
  events: Schema.Array(AnalyticsEvent).check(Schema.isMinLength(1), Schema.isMaxLength(20)),
});
export type AnalyticsBatch = typeof AnalyticsBatch.Type;
export const AnalyticsInstallation = Schema.Struct({
  installationId: UUID,
  platform: AnalyticsPlatform,
  appVersion: Schema.String.check(Schema.isMaxLength(64), Schema.isPattern(/^\d+(?:\.\d+){0,3}(?:[-+][a-zA-Z0-9.-]+)?$/)),
  osVersion: Schema.String.check(Schema.isMaxLength(64), Schema.isPattern(/^(?:\d+(?:\.\d+){0,3}|unknown)$/)),
  channel: AnalyticsChannel,
});
export type AnalyticsInstallation = typeof AnalyticsInstallation.Type;

/** Reject extra fields instead of silently stripping private or fabricated data. */
export const parseAnalyticsBatch = (input: unknown): AnalyticsBatch =>
  Schema.decodeUnknownSync(AnalyticsBatch)(input, { onExcessProperty: "error" });
export const parseAnalyticsInstallation = (input: unknown): AnalyticsInstallation =>
  Schema.decodeUnknownSync(AnalyticsInstallation)(input, { onExcessProperty: "error" });

export type AnalyticsRange = "day" | "week" | "month" | "year";
export interface AnalyticsSourceHealth {
  readonly id: "stats-worker" | "github" | "app-store";
  readonly status: "connected" | "stale" | "disconnected" | "error";
  readonly lastObservedAt: string | null;
  readonly lastAttemptAt: string | null;
  readonly coverageStartedAt: string | null;
  readonly visibility: "public" | "private" | null;
}
export interface AnalyticsReport {
  readonly environment: "local" | "test" | "staging" | "production";
  readonly range: AnalyticsRange;
  readonly since: string;
  readonly asOf: string;
  readonly platform: AnalyticsPlatform | null;
  readonly includeTest: boolean;
  readonly accounts: { readonly registered: number; readonly organizations: number; readonly paidOrganizations: number };
  readonly activity: {
    readonly activeAccounts: number; readonly activeInstallations: number;
    readonly recentlyActiveInstallations: number; readonly reportingInstallations: number;
    readonly reportingStartedAt: string | null;
  };
  readonly cloud: {
    readonly requests: number; readonly successful: number; readonly failed: number; readonly pending: number;
    readonly inputTokens: string; readonly outputTokens: string; readonly creditsMicro: string;
    readonly revenueUsdCents: string; readonly unattributedRequests: number;
  };
  readonly history: readonly { readonly day: string; readonly activeAccounts: number; readonly activeInstallations: number }[];
  readonly platforms: readonly { readonly platform: string; readonly activeAccounts: number; readonly activeInstallations: number }[];
  readonly versions: readonly { readonly platform: string; readonly appVersion: string; readonly activeInstallations: number }[];
  readonly features: readonly { readonly feature: string; readonly actions: number; readonly activeAccounts: number }[];
  readonly cohorts: readonly { readonly day: string; readonly installations: number; readonly retainedDay1: number | null; readonly retainedDay7: number | null }[];
  readonly sources: readonly AnalyticsSourceHealth[];
  readonly downloadHistory: readonly { readonly day: string; readonly source: string; readonly downloads: string }[];
  readonly downloads: readonly { readonly source: string; readonly dimension: string; readonly count: string; readonly observedAt: string; readonly platform: string | null; readonly version: string | null; readonly assetType: string | null; readonly name: string | null }[];
}

export interface AnalyticsAccountActivity {
  readonly since: string;
  readonly platforms: readonly { readonly platform: string; readonly installations: number; readonly lastSeenAt: string }[];
  readonly features: readonly { readonly feature: string; readonly actions: number }[];
}
