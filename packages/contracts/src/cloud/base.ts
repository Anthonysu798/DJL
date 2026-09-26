/**
 * DJL Cloud public API contract.
 *
 * These schemas describe the JSON exchanged between the clients (desktop, web,
 * iOS) and the DJL Cloud control plane in `cloud/` at https://api.slcor.com/v1.
 * The cloud apps import them as `@synara/contracts/cloud` from this workspace,
 * so a change here is an API change. Authentication routes under /v1/auth/*
 * are served by Better Auth and are not described here; everything else is.
 *
 * Money: credits are the user-facing unit (100 credits = 1 USD). The wire
 * format carries microcredits (1 credit = 1,000,000 microcredits) as decimal
 * strings so no client ever rounds a balance.
 */
import { Schema } from "effect";

import { TrimmedNonEmptyString } from "../baseSchemas";

export const DJL_CLOUD_API_VERSION = "v1";
export const DJL_CLOUD_HOSTS = {
  global: "https://api.slcor.com",
  asia: "https://api-asia.slcor.com",
} as const;

/** Decimal string of microcredits. May be negative only inside ledger entries. */
export const Microcredits = Schema.String.check(Schema.isPattern(/^-?\d+$/));
export type Microcredits = typeof Microcredits.Type;

export const CloudUserId = TrimmedNonEmptyString.pipe(Schema.brand("CloudUserId"));
export type CloudUserId = typeof CloudUserId.Type;
export const CloudOrgId = TrimmedNonEmptyString.pipe(Schema.brand("CloudOrgId"));
export type CloudOrgId = typeof CloudOrgId.Type;
export const CloudDeviceId = TrimmedNonEmptyString.pipe(Schema.brand("CloudDeviceId"));
export type CloudDeviceId = typeof CloudDeviceId.Type;
export const CloudConversationId = TrimmedNonEmptyString.pipe(Schema.brand("CloudConversationId"));
export type CloudConversationId = typeof CloudConversationId.Type;
export const CloudMessageId = TrimmedNonEmptyString.pipe(Schema.brand("CloudMessageId"));
export type CloudMessageId = typeof CloudMessageId.Type;
export const CloudRunId = TrimmedNonEmptyString.pipe(Schema.brand("CloudRunId"));
export type CloudRunId = typeof CloudRunId.Type;
export const CloudFileId = TrimmedNonEmptyString.pipe(Schema.brand("CloudFileId"));
export type CloudFileId = typeof CloudFileId.Type;
export const CloudShareId = TrimmedNonEmptyString.pipe(Schema.brand("CloudShareId"));
export type CloudShareId = typeof CloudShareId.Type;

export const CloudOrgRole = Schema.Literals(["owner", "admin", "member", "billing"]);
export type CloudOrgRole = typeof CloudOrgRole.Type;

export const CloudPlanId = Schema.Literals(["free", "trial", "starter", "business", "autopilot"]);
export type CloudPlanId = typeof CloudPlanId.Type;

/** Uniform error envelope. `code` is stable and meant for programmatic handling. */
export const CloudApiError = Schema.Struct({
  error: Schema.Struct({
    code: TrimmedNonEmptyString,
    message: Schema.String,
    traceId: TrimmedNonEmptyString,
    /** Set with `usage_window_exhausted`: when the exhausted window frees up again. */
    resetsAt: Schema.optionalKey(Schema.String),
    /** Set with `usage_window_exhausted`: which window is full. */
    window: Schema.optionalKey(Schema.Literals(["five_hour", "week"])),
  }),
});
export type CloudApiError = typeof CloudApiError.Type;

export const CloudApiErrorCode = Schema.Literals([
  "unauthorized",
  "forbidden",
  "suspended",
  "not_a_member",
  "not_found",
  "bad_request",
  "bad_json",
  "payload_too_large",
  "insufficient_credits",
  "billing_paused",
  "billing_error",
  "already_subscribed",
  "bad_amount",
  "bad_plan",
  "plan_unavailable",
  "phone_required",
  "phone_already_used",
  "rate_limited",
  "overloaded",
  "usage_window_exhausted",
  /** A stream was cut mid-response because a usage window filled. */
  "usage_window_cut",
  "no_reset_bank",
  "gateway_paused",
  "sync_paused",
  "internal",
]);
export type CloudApiErrorCode = typeof CloudApiErrorCode.Type;
